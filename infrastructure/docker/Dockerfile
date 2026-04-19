# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json .env.example ./
COPY apps/api/package.json apps/api/package.json
COPY apps/public-web/package.json apps/public-web/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-config/package.json packages/shared-config/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY apps ./apps
COPY packages ./packages

FROM base AS builder
ARG TARGET=api
RUN npm run -w @sporx/shared-types build && npm run -w @sporx/shared-config build && npm run -w @sporx/api-contract build && npm run -w @sporx/ui build
RUN if [ "$TARGET" = "api" ] || [ "$TARGET" = "worker" ]; then npm run -w @sporx/api prisma:generate && npm run -w @sporx/api build; elif [ "$TARGET" = "public-web" ]; then npm run -w @sporx/public-web build; else npm run -w @sporx/admin-web build; fi

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY package.json tsconfig.base.json .
ARG TARGET=api
ENV TARGET=${TARGET}
CMD ["sh", "-c", "if [ \"$TARGET\" = \"api\" ]; then npm run -w @sporx/api prisma:migrate:deploy:safe && node apps/api/dist/apps/api/src/main.js; elif [ \"$TARGET\" = \"worker\" ]; then node apps/api/dist/apps/api/src/worker.js; elif [ \"$TARGET\" = \"public-web\" ]; then npm run -w @sporx/public-web start; else npm run -w @sporx/admin-web start; fi"]
