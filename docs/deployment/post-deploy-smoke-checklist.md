# Post-Deploy Smoke Checklist

Bu dosya deploy sonrasi hizli canli kontrol icindir.

## Tek komut (default canli URL'ler)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/ops/smoke-live.ps1
```

## Farkli URL ile calistirma

```powershell
powershell -ExecutionPolicy Bypass -File scripts/ops/smoke-live.ps1 `
  -AdminBaseUrl "https://admin.example.com" `
  -PublicBaseUrl "https://app.example.com" `
  -ApiBaseUrl "https://api.example.com"
```

## Script neyi kontrol eder

- Admin root, health, login ve kritik route durum kodlari
- Public panel ve futbol/basketbol tahminler route durum kodlari
- API health endpoint
- API health sadece `200` degil, JSON payload olarak `status: "ok"` ve `service: "api"` donmeli
- Public proxy uzerinden `/api/v1/matches` ve `/api/v1/predictions` timeout/404 vermemeli
- Public predictions envelope (`success`) ve veri sayisi
- Takim isimlerinin bos olup olmadigi
- "gecici tahmin" fallback gorunurlugu (uyari olarak)

## Exit kodlari

- `0`: Basarili (fatal hata yok)
- `1`: En az bir kritik smoke hatasi var
- `2`: `-Strict` kullanildi ve hata bulundu

## Not

SSL/TLS zinciri ortamlara gore degisebilir. Script default olarak HTTPS kontrollerinde `-k` benzeri guvensiz TLS tolere eder (`-InsecureTls`).
