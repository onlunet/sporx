$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5433/sporx"
$env:REDIS_URL = "redis://localhost:6380"
$env:JWT_ACCESS_SECRET = "change_me_access"
$env:JWT_REFRESH_SECRET = "change_me_refresh"
$env:JWT_ACCESS_TTL = "15m"
$env:JWT_REFRESH_TTL = "30d"
$env:CORS_ORIGINS = "http://localhost:3000,http://localhost:3100"

npx ts-node src/main.ts
