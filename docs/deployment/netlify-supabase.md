# Netlify + Supabase Deployment Guide (SporX)

Bu proje monorepo olduğu için **public-web** ve **admin-web** ayrı Netlify site olarak kurulmalıdır.

## 1) Mimari
- Netlify Site 1: `apps/public-web` (public uygulama)
- Netlify Site 2: `apps/admin-web` (admin uygulama)
- API + Worker: uzun çalışan süreçler olduğu için ayrı servis (Coolify/Render/Railway/Fly)
- Veritabanı: Supabase Postgres
- Cache/Queue: Redis (Upstash veya managed Redis)

Not: BullMQ worker nedeniyle API/worker'ı Netlify üzerinde çalıştırmak doğru model değildir.

## 2) Netlify Build Template
- Public template: `infrastructure/netlify/public-web.toml`
- Admin template: `infrastructure/netlify/admin-web.toml`

Her site için GitHub repo aynı kalır, sadece build command farklı olur.

## 3) Ortam Değişkenleri

### public-web (Netlify)
- `NEXT_PUBLIC_API_URL=` (boş bırak; mixed-content riskini önler)
- `INTERNAL_API_URL=https://<api-domain>`
- `NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`

### admin-web (Netlify)
- `NEXT_PUBLIC_API_URL=https://<api-domain>`
- `INTERNAL_API_URL=https://<api-domain>`
- `JWT_ACCESS_SECRET=<api ile aynı secret>`
- `NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>`

### api + worker (Sunucu)
- `DATABASE_URL=<supabase pooler url>`
- `REDIS_URL=<redis url>`
- `JWT_ACCESS_SECRET=<secret>`
- `JWT_REFRESH_SECRET=<secret>`
- `BACKUP_MODE=readonly`
- `BACKUP_READ_URL=<supabase read-only url (opsiyonel)>`
- `SUPABASE_DB_POOLER_URL=<supabase pooler>`
- `SUPABASE_DB_DIRECT_URL=<supabase direct>`
- `SUPABASE_ANON_KEY=<anon key>`
- `SUPABASE_SERVICE_ROLE_KEY=<service role key>`
- provider API key'leri (`FOOTBALL_DATA_API_KEY`, vb.)

## 4) Supabase Geçiş Adımları
1. Supabase projesinde bağlantı stringlerini alın (pooler + direct).
2. API sunucusunda `DATABASE_URL` değerini pooler ile set edin.
3. Migration çalıştırın:
   - `npm run -w @sporx/api prisma:generate`
   - `npm run -w @sporx/api prisma:migrate`
4. Seed çalıştırın:
   - `npm run -w @sporx/api prisma:seed`
5. Worker'ı `SERVICE_ROLE=worker` ile ayrı process başlatın.

## 5) GitHub Entegrasyonu
- Repo: `sporx`
- Netlify'da aynı repo üzerinden iki ayrı site bağlanır (public/admin).
- Branch strategy: `main` production, `staging` preview önerilir.

## 6) Güvenlik
- API key/token/secret değerlerini repoya commit etmeyin.
- Sadece deploy ortam değişkeni olarak tanımlayın.
- Eğer token veya key açık kanala yazıldıysa **rotate** edin.
