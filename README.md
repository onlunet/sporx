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

## Point-in-time prediction flow (football)
Yeni akış immutable ve replay-safe olacak şekilde aşağıdaki sırayı izler:
1. `ingestRaw`
2. `canonicalMerge`
3. `featureSnapshot`
4. `oddsSnapshot`
5. `lineupSnapshot`
6. `eventEnrichment`
7. `marketConsensus`
8. `predictionRun`
9. `metaModelRefine`
10. `calibrateScore`
11. `candidateBuild`
12. `selectionScore`
13. `abstainFilter`
14. `conflictResolution`
15. `publishDecision`
16. `publicPublish`
17. `invalidateCache`

`prediction_runs` immutable tutulur, public taraf sadece `published_predictions` pointer kaynağından okunur.

## Publish Selection Engine (v1 deterministic)
- Amaç: model olasılığı ile public yayını ayırmak, düşük kaliteli tahminleri açıklanabilir şekilde abstain etmek.
- Strategy profilleri:
  - `CONSERVATIVE`
  - `BALANCED`
  - `AGGRESSIVE`
- Temel ayarlar (`system_settings`):
  - `selection_engine_enabled`
  - `selection_engine_shadow_mode`
  - `strategy_profile_default`
  - `selection_engine_emergency_rollback`

### Karar kayıtları
- `prediction_candidates`: immutable aday satırları
- `publish_decisions`: nihai karar (`APPROVED`, `ABSTAINED`, `SUPPRESSED`, `BLOCKED`, `MANUALLY_FORCED`)
- `abstain_reason_logs`: deterministik gerekçeler
- `manual_publish_overrides`: force/block override kayıtları
- `policy_evaluation_snapshots`: policy değerlendirme izi

### Public davranış
- Public API varsayılan olarak sadece:
  - `APPROVED`
  - `MANUALLY_FORCED`
  kararına bağlı yayımları döner.
- Shadow mode açıkken selector kararı loglanır; üretim akışı kesintisiz devam eder.
