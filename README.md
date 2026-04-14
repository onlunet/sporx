# SporX Analytics Platform V1

Production-grade monorepo skeleton for football analytics and match probability prediction.

## Apps
- `apps/public-web`: Public analytics UI (no admin entrypoints)
- `apps/admin-web`: Admin panel under `/admin/*`
- `apps/api`: NestJS backend, Prisma, BullMQ ingestion and historical import pipeline

## Packages
- `packages/shared-types`: shared domain types
- `packages/shared-config`: env schema and config
- `packages/ui`: shared UI primitives
- `packages/api-contract`: zod contracts (`public.*`, `admin.*`)

## Quick start
1. Copy `.env.example` to `.env`.
2. Install dependencies:
   - `npm install`
3. Start infra:
   - `docker compose up -d postgres redis`
4. Generate Prisma client and migrate:
   - `npm run -w @sporx/api prisma:generate`
   - `npm run -w @sporx/api prisma:migrate`
5. Seed:
   - `npm run -w @sporx/api prisma:seed`
6. Start services:
   - API: `npm run dev:api`
   - Worker: `npm run dev:worker`
   - Public web: `npm run dev:public`
   - Admin web: `npm run dev:admin`

## Historical import
Use admin API:
- `POST /api/v1/admin/import/historical`

Example payload:
```json
{
  "matchesPath": "D:/Futbol verileri 2000-2025/Matches.csv",
  "eloPath": "D:/Futbol verileri 2000-2025/EloRatings.csv"
}
```

## Deployment
`docker-compose.yml` and `infrastructure/docker/Dockerfile` are Coolify-compatible.

Netlify + Supabase deployment runbook:
- `docs/deployment/netlify-supabase.md`
- Netlify templates:
  - `infrastructure/netlify/public-web.toml`
  - `infrastructure/netlify/admin-web.toml`

App-specific env templates:
- `apps/public-web/.env.example`
- `apps/admin-web/.env.example`
- `apps/api/.env.example`

## Backup readiness
- `BACKUP_MODE=disabled|readonly`
- `BACKUP_READ_URL` for future Supabase read-only fallback.

## Runtime verification
Tek komutta ortam doğrulaması:
- Local:
  - `npm run ops:verify`
- Production profile:
  - `npm run ops:verify:prod`

Script kontrol eder:
- DB hedefi (host/port/db)
- kritik env anahtarları
- API/Public/Admin temel HTTP erişimi

## HTTPS API ayarı (public-web)
Mixed-content hatasını önlemek için production ortamında:
- `INTERNAL_API_URL=https://<api-domain>`
- `NEXT_PUBLIC_API_URL=` (boş bırak)
