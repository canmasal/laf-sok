# Laf Sok

Konuşmayı veya ekran görüntüsünü alıp seçilen tonda 3 cevap üreten site.

## Yayına alma (Vercel)
1. Bu klasörü Vercel'e yükle (yeni proje, framework: Other).
2. Settings → Environment Variables: `ANTHROPIC_API_KEY` = console.anthropic.com'dan aldığın anahtar.
   İsteğe bağlı: `ANTHROPIC_MODEL` (varsayılan claude-sonnet-5-5; daha ucuz/hızlı için claude-haiku-5-5).
3. Redeploy. Kendi alan adın için Settings → Domains.

## Dosyalar
- `index.html` — arayüz
- `api/laf.js` — sunucu fonksiyonu; anahtar yalnızca burada kullanılır, IP başına dakikada 8 istek sınırı vardır.
