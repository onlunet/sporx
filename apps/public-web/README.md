# Public Web Route Map

Bu uygulama public-safe yüzey için tasarlanmıştır ve sadece son yayınlanan tahmin çıktılarını gösterir.

## Türkçe Bilgi Mimarisi

- `/panel`
- `/futbol/maclar`
- `/futbol/tahminler`
- `/futbol/sonuclar`
- `/futbol/lig-performansi`
- `/futbol/karsilastir`
- `/futbol/canli`
- `/basketbol/maclar`
- `/basketbol/tahminler`
- `/basketbol/sonuclar`
- `/basketbol/lig-performansi`
- `/basketbol/karsilastir`
- `/basketbol/canli`
- `/ligler`
- `/takimlar`
- `/rehber`
- `/hesap`

## Uyum Notu

Mevcut İngilizce path'lerle geriye dönük uyumluluk korunur. `next.config.ts` içindeki rewrites ile Türkçe URL'ler mevcut sayfalara yönlendirilir.

## Güvenlik Sınırı

Public proxy (`app/api/v1/[...path]/route.ts`) admin/security/compliance/internal path'lerini engeller.
