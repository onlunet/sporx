# Auth + Session Hardening (Phase 1)

Bu faz ile JWT tabanlı mevcut auth akışı korunarak sunucu tarafında session/state katmanı eklendi.

## Yeni Akış

1. `POST /api/v1/auth/login`
- Kullanıcı doğrulanır.
- `auth_sessions` kaydı açılır.
- `refresh_token_families` kaydı açılır.
- Refresh token rotate-safe şekilde (`jti`, `family`, `session`) üretilir.
- `refresh_token_events` tablosuna `ISSUED` yazılır.

2. `POST /api/v1/auth/refresh`
- Token doğrulanır.
- Eski token tek-kullanımlık kabul edilir ve rotate edilir.
- Reuse tespit edilirse family/session revoke edilir, `auth_risk_events` yazılır.

3. `POST /api/v1/auth/logout`
- Tek session veya `allSessions=true` ile kullanıcı scope’unda tüm sessionlar revoke edilir.

## Güvenlik Katmanları

- Server-side session inventory
- Refresh token family + rotation event zinciri
- Refresh reuse detection
- Login brute-force lockout (admin/public farklı eşikler)
- Admin IP allowlist hook
- Admin step-up challenge endpointleri
- Audit/risk event kaydı

## Yeni Admin Endpointleri

- `GET /api/v1/auth/admin/sessions`
- `GET /api/v1/auth/admin/login-attempts`
- `GET /api/v1/auth/admin/risk-events`
- `GET /api/v1/auth/admin/refresh-events`
- `POST /api/v1/auth/admin/sessions/revoke`
- `POST /api/v1/auth/admin/step-up/challenge`
- `POST /api/v1/auth/admin/step-up/verify`

## Ortam Değişkenleri (Özet)

- `STRICT_ADMIN_AUTH_ENABLED`
- `REFRESH_REUSE_DETECTION_ENABLED`
- `AUTH_LOCKOUT_ENABLED`
- `ADMIN_STEP_UP_AUTH_ENABLED`
- `ADMIN_IP_RESTRICTION_ENABLED`
- `ADMIN_IP_ALLOWLIST`
- `JWT_ACCESS_TTL_ADMIN`
- `JWT_REFRESH_TTL_ADMIN`
- `JWT_REFRESH_SECRET_ADMIN`

## Not

Bu fazda canlı bahis/finansal karar akışına dokunulmadı; sadece auth/session güvenliği sıkılaştırıldı.
