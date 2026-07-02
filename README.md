# Sağlık Uygulaması

Bu proje, kullanıcıların sağlıkla ilgili sorularını işleyen bir Node.js tabanlı AI asistanıdır. Sunucu tarafı Express ile çalışır ve Groq ile Google Gemini üzerinden yanıt üretir.

## Özellikler
- Kullanıcı dostu web arayüzü
- AI destekli sağlık asistanı yanıtları
- Firebase entegrasyonu
- Rate limiting ve güvenlik başlıkları

## Kurulum
1. Bağımlılıkları kurun:
   ```bash
   npm install
   ```
2. Ortam değişkenlerini ayarlayın:
   - `.env` dosyası oluşturun
   - gerekli API anahtarlarını ekleyin
3. Sunucuyu başlatın:
   ```bash
   npm start
   ```

## Geliştirme
```bash
npm run dev
```

## Not
Hassas bilgiler için `.env`, `firebase-key.json` ve benzeri dosyalar Git'e eklenmemelidir.
