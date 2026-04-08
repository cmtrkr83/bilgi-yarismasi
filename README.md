# Bilgi Yarismasi (Electron + SQLite3)

Bu proje, Kahoot benzeri tema ile gelistirilmis bir bilgi yarismasi uygulamasinin temel surumudur.

## Ozellikler

- Yonetim ekrani:
  - Quiz olusturma
  - Acik uclu ve coktan secmeli soru ekleme
  - Quiz editorde Excel (.xlsx/.xls) ile toplu soru ice aktarma
  - Excel soru sablonu indirme
  - Sure ve puan belirleme
  - Quiz yayina alma
  - Katilimci onaylama
- Katilimci ekrani:
  - Rastgele kodla oturuma giris
  - Yonetici onayi bekleme
  - Soru geldiginde cevaplama
  - Soru yoksa bekleme ekrani
- Sunum ekrani:
  - Salona yansitilacak soru/bekleme durumu
  - Anlik puan tablosu
- Veritabani:
  - SQLite3 ile quiz, soru, oturum, katilimci ve cevap kayitlari

## Kurulum

```bash
npm install
```

## Calistirma

```bash
npm start
```

Uygulama acildiginda:

- `Yonetim Ekrani` penceresi acilir
- `Sunum Ekrani` penceresi acilir
- Ayni agdaki cihazlar icin, yonetim ekraninda listelenen LAN adresi kullanilir.

## Notlar

- Katilimcilarin sorulari gorebilmesi icin yonetici onayi gereklidir.
- Yonetici soru gondermedigi surece katilimci ve sunum ekranlarinda bekleme durumu gorunur.
- Bu temel surum, internet uzerinden erisim icin ters proxy veya port yonlendirme (or. ngrok/VPS) ile genisletilebilir.
