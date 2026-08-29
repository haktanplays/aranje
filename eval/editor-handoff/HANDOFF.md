# Faz 2U-A — Founder Editor Acceptance · Teslim

Bu dosya Haktan'ın telefondan yapacağı testin nasıl açılacağını ve neyin
eksik olduğunu söyler. **Founder kabulü verilmemiştir ve bu dosya vermez.**

---

## Route

    /eval/editor-acceptance?sha=<commit>

- Production navigation'a eklenmedi, hiçbir yerden link verilmiyor.
- `robots: index: false, follow: false`.
- Gerçek `Workspace`, iki track'li sabit bir fixture, sayfanın kendi belleğe
  yazan deposu. **Gerçek proje değişmiyor** ve bu ekranda yazılı.
- `?sha=` taşımayan bir açılış da çalışır; sonuç bloğu «beklenen sürüm
  verilmedi» der. Yanlış `sha` testi **başlatmaz**.

## Yerelde açmak

    PORT=3104 ./eval/chord-audio/serve.sh
    # http://127.0.0.1:3104/eval/editor-acceptance?sha=<commit>

## Telefondan açmak — **açık blocker**

Public bir URL üretilemedi. Uydurulmuş bir adres yazmak yerine engelin ne
olduğu:

| Soru | Cevap |
|---|---|
| Hangi servis | Vercel (spec §14: «Normal Next.js deployment, yalnız `/api/*` → Vercel») |
| Neden yapılamadı | Bu ortamda Vercel CLI yok, `~/.vercel` yok, `vercel.json` yok, `VERCEL_*` ortam değişkeni yok, repoda bağlı bir proje kaydı yok |
| Yetki | Vercel projesinin oluşturulması spec §16'da **sahip aksiyonu** olarak listeli — Claude Code yapamaz |
| Branch push edildi mi | Evet: `claude/proje-yorumları-n06wen` |
| Bilinen production/preview URL | Hayır. Repoda, spec'te ve dokümanlarda kayıtlı bir Aranjé URL'si yok |

**Haktan'ın yapacağı tek kısa işlem:** Vercel'de bu repoyu bir projeye bağla
(ya da mevcut projeye bu branch'i preview olarak aldır). Vercel branch
deploy'unu otomatik üretir.

**Deploy sonrası beklenen adres:**

    https://<preview-host>/eval/editor-acceptance?sha=<final-commit>

`sha` parametresi bu turun final commit'i olmalı. Sayfa açıldığında üstte
kısa SHA görünür; görünen SHA `sha` parametresiyle uyuşmuyorsa route testi
başlatmaz ve «Yanlış sürüm: beklenen X, açılan Y» der. Eski bir deploy bu
yüzden yanlışlıkla kabul edilemez.

QR üretilmedi: QR yalnız gerçek, telefondan açılabilen bir HTTPS adresi
içerebilir ve öyle bir adres henüz yok.

## Test bittiğinde

Son ekranda **«Sonucu kopyala»** var; kopyalanamayan bir tarayıcıda aynı
metin seçilebilir bir alanda duruyor. Blok şunu içerir:

- Build SHA ve sürümün doğrulanıp doğrulanmadığı
- On satırlık işlem tablosu (hangi kontrol kırıldıysa **adıyla**)
- `User storage unchanged` ve `Console errors`
- Üç founder sorusunun cevabı ve serbest not
- `Automated verdict: PASS | PARTIAL | FAIL`
- `Founder verdict: Haktan doldurmadı`

Son satır sabittir. Otomatik ölçüm tertemiz olsa bile sayfa founder kabulü
yazmaz; bunu dışarıda Haktan verir.

`Automated verdict` ne demek:

- **FAIL** — ölçülen bir şey kırıldı, ya da gerçek depo oynadı, ya da sayfa hata attı.
- **PARTIAL** — ölçümler temiz ama ulaşılmamış bir adım veya cevaplanmamış bir soru var.
- **PASS** — ölçülebilir her şey geçti ve her soru cevaplandı. Yine de bu
  yalnız **makinenin yarısı** hakkında bir cümledir.

## Ne test edilmedi

Route'un kendisi dört viewport'ta 84/84 geçiyor. Ama route testi **editörü**
test etmez — onu bu turda kimse kullanmadı. Yedi adımın içindeki işlemleri
yapan bir insan gerekiyor; bu paketin varlık sebebi tam olarak budur.

Fiziksel Android/iOS kabulü hâlâ açık ve bu paket onu kapatmaz.
