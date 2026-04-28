# Coolify Runtime Checklist

## Services
- `sporx-api`
- `sporx-worker`
- `sporx-public-web`
- `sporx-admin-web`

## Build Args
- `sporx-api`: `TARGET=api`
- `sporx-worker`: `TARGET=worker`
- `sporx-public-web`: `TARGET=public-web`
- `sporx-admin-web`: `TARGET=admin-web`

## Ports
- `sporx-api`: `4000`
- `sporx-public-web`: `3000`
- `sporx-admin-web`: `3100`
- `sporx-worker`: public ingress kapali

## Env Files
- `apps/api/.env.coolify`
- `apps/api/.env.coolify.worker`
- `apps/public-web/.env.coolify`
- `apps/admin-web/.env.coolify`

## Domains
- Public: `re1oz35delag2o3sgromqlmf.104.238.176.73.sslip.io`
- Admin: `g1n8ykcoyj32pb84vq3b7dms.104.238.176.73.sslip.io`
- API: `q7hn0ohc20ng48s8xmfjvi4e.104.238.176.73.sslip.io`

## Required Assertions
- API domain yalnizca `sporx-api` servisine gitmeli
- Worker'a public domain verilmemeli
- Public host yalnizca `sporx-public-web` servisine gitmeli
- Admin host yalnizca `sporx-admin-web` servisine gitmeli
- `NEXT_PUBLIC_API_URL` public-web tarafinda bos kalmali
- `GET /api/v1/health` JSON donmeli ve `status: ok`, `service: api` icermeli
