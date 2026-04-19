# Deployment Notes (Coolify-ready)

## Services
- `public-web` -> `app.domain.com`
- `admin-web` -> `admin.domain.com`
- `api` -> internal or `api.domain.com`
- `worker` -> no public ingress
- `postgres`
- `redis`

## Core environment variables
- `DATABASE_URL`
- `SUPABASE_DB_DIRECT_URL` (Supabase pooler kullaniliyorsa migration icin zorunlu)
- `REDIS_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `FOOTBALL_DATA_API_KEY`
- `BACKUP_MODE`
- `BACKUP_READ_URL`

## Routing rule
- Public ingress must route only `app.domain.com` to `public-web`.
- Admin ingress must route only `admin.domain.com` to `admin-web`.
- Do not expose admin-web through public host.

## Worker role split
- Build image once.
- Start two containers with same image:
  - `TARGET=api`
  - `TARGET=worker`

## Backup-readiness
- If `BACKUP_MODE=readonly`, API can add read-only replica query path using `BACKUP_READ_URL`.
- V1 keeps this configuration-ready, execution in V2.
