# Faz 2U-B — teslim raporu

Yalnız bu turun deltası. `a807502` üzerindeki canlı founder koşumunda çıkan
altı FAIL kapatıldı; kapatılırken iki kusur daha bulundu ve o da yazıldı.

---

## 1. Başlangıç/final SHA ve commit zinciri

| | |
|---|---|
| Başlangıç | `a807502` |
| Commit'ler | `3ee647c` → `da0a039` → `48334a8` → `<c4>` |

- `3ee647c` — modelin zaten sunduğu fiilleri çiz (pano, kapsam fiilleri, «Yerine koy»)
- `da0a039` — parmağın bir ölçüyü tutup komşularına uzanması
- `48334a8` — kabul route'unun kanıtlamadığı adımı geçmesini durdur
- `<c4>` — dört viewport kabulü, 32 probe, teslim artefaktları

## 2. Clipboard neden kayboluyordu

Kaybolmuyordu. **Hiç çizilmiyordu.** `selectionCapabilities` boş bir seçim +
range pano için baştan beri `available` diyordu — `paste` dalı, "seçimde nota
yok" kuralından *önce*, kasıtlı olarak. Fakat compact drawer `DRAWER_VERBS`
listesini çiziyor ve o listede `paste` girdisi yoktu. Kopyalama çalıştı,
bildirim geldi, onu kullanacak tek fiil menüde değildi.

Mevcut test "her drawer girdisi gerçek bir fiil mi" diye soruyordu ve
geçiyordu. Tersini kimse sormamıştı. Şimdi soruyor: donmuş satır + drawer,
bir aralık seçimine sunulan **her** fiile ulaşabilmeli.

İkinci yol da eklendi: seçili olana yapıştırma. "Nereye yapıştırayım" sorusu
hedef zaten seçiliyken tekrar sorulmuyor.

## 3. Paste cancel / apply / undo / redo fingerprint sonuçları

Dört viewport'ta, gerçek pointer'la, tab'ın çizdiği müziğin fingerprint'i
üzerinden (adım 2–7):

| Ölçüm | Sonuç |
|---|---|
| Kopyalama şarkıyı değiştirmiyor | before === after, 4/4 viewport |
| Seçim değişince pano duruyor | «Yapıştır» çizili ve basılabilir, 4/4 |
| Önizleme yazmıyor, «Vazgeç» temiz | preview görünür, before === after, 4/4 |
| «Uygula» müziği değiştiriyor | after ≠ before, 4/4 |
| Tek «Geri al» paste öncesine byte-eş dönüyor | equal=true, 4/4 |
| Tek «İleri al» paste sonrasına byte-eş dönüyor | equal=true, 4/4 |

## 4. Eski undo/redo false positive'inin nedeni

Paste hiç uygulanmayınca, paste'in iki yanında işaretlenen bayt dizileri
**aynı şarkıydı**. «Geri al» hiçbir şey yapmadı ve "şarkı beforePaste'e
döndü" cümlesi yine de doğru çıktı — çünkü zaten oradaydı. Yalan yoktu;
ölçüm boştu.

Üç bağ eklendi: adım `pasteApplied`'ı gerektiriyor, `returns_to` ikinci bir
işaretle **farklı** olmayı şart koşuyor, ve karşılanmamış bir bağımlılık
adımı kendi hesabına düşürüyor. Bir bağımlılığın `null` olması da `false`
kadar engelliyor: "bakmadık" çalıştığının kanıtı değil.

## 5. Geçerli ve geçersiz tel taşıma

Rehber yanlış ölçüyü gösteriyordu. 1. ölçü **boş alt Mi** ile açılıyor:
E2'yi verebilecek daha ince tel yok (La telinin boş sesi üç yarım ton
yukarıda), daha kalın tel de yok. Uygulama iki yönü de haklı olarak
reddetti; istenen hareket klavyede yoktu.

- **Pozitif** — 3. ölçü, boyun ortası: ince tel `restring-1` uygulandı,
  kalın tel `restring--1` uygulandı, her ikisi de tek «Geri al» ile
  byte-eş geri geldi (4/4 viewport).
- **Negatif** — 1. ölçünün akoru: «Bu şekil mevcut akort ve capo ile
  çalınamıyor.», «Uygula» kapalı, fingerprint değişmedi (4/4 viewport).

Hangi ölçünün ne yapabildiği yorumla değil, `applyTransform` çağrılarak
fixture'ın kendi testinde ölçülüyor.

## 6. Seçim kapsam modeli

Üç kapsam, üç fiil kümesi:

| Kapsam | Sunulan | Sunulmayan |
|---|---|---|
| nota / aralık | Kopyala, Kes, **Yapıştır**, Çoğalt, Tekrarla, Sil, Bağla, Taşı, Devam | ölçü fiilleri (hidden) |
| tek enstrümanın ölçüsü | İçeriği sil / çoğalt / taşı, Kopyala, Kes, Tekrarla, (pano varsa) Buraya yapıştır | Ölçü ekle, Ölçü ve ritim — «Bu işlem için ölçünün tamamı seçilmeli.» |
| bütün enstrümanların ölçüsü | Ölçüyü kaldır / çoğalt / taşı, Ölçü ve ritim, Önüne/Arkasına ölçü ekle, kopyalanan ölçüleri ekle | — |

Kapsam artık *hangi jestin seçtiğiyle* değil, ekranda duran iki radyo
düğmesiyle belirleniyor. Önceden tab'dan bütün-ölçü kapsamına geçmek mümkün
değildi, dolayısıyla tab'dan ölçü eklemek de mümkün değildi.

## 7. Boş ölçü diyaloğunun nedeni

Sheet'in her girdisi `full` veya `canPaste` ile kapılıydı; kapıyı çizen
düğme hiçbir şeyle kapılı değildi. Tek enstrümanın ölçüsü + boş pano =
başlıklı, bomboş bir diyalog.

Hata eksik bir kapı koşulu değildi: kapı ve sheet **iki ayrı listeydi**, biri
boşken diğeri dolu sanıyordu. Artık ikisi de `bar-menu.ts`'teki tek listeyi
okuyor; "arkasında bir şey var mı" sorusu `length > 0`.

## 8. «Yerine koy» no-op'unun nedeni ve sonucu

`canReplace` yalnız hata koduna bakıyordu. `target_occupied` üç ayrı çakışmayı
anlatıyordu ve çekirdek yalnız birini onurlandırıyordu:

| Çakışma | Eskiden | Şimdi |
|---|---|---|
| `paste_bar_contents` | replace çalışıyordu | değişmedi |
| `duplicate_bars` / `repeat_bars` (track) | mesaj «Yerine koy» vaat ediyordu, bayrak yoktu | bayrak var, üzerine yazıyor, kaynak korunuyor |
| `move_bars_left/right` (track) | «Yerine koy» sunuluyordu, komut aynen tekrar reddediyordu | kendi kodu (`move_target_occupied`), düğme hiç çizilmiyor |

Taşımanın üzerine yazması kasıtlı olarak yok: dürtme gibi okunan bir jestle
bir ölçü müzik kaybedilmemeli. Onurlandırılamayacak bir replace istemek artık
sessizce dönmüyor, atıyor — sessiz dönüş bu turun kaldırdığı şeyin ta kendisi.

Ölçüm (adım 17–18, 4/4 viewport): dolu komşuya taşıma reddediliyor,
`[data-bar-replace]` çizilmiyor, fingerprint değişmiyor; boş komşuya taşıma
uygulanıyor ve tek «Geri al» ile byte-eş geri geliyor.

## 9. Long-press drag pointer ownership sözleşmesi

Ownership presten önce karara bağlanamaz: parmak indiği anda "ölçü seç" ile
"tab'ı kaydır" aynı olaydır. Üç durum:

1. **pressing** — hiçbir şey sahiplenilmiyor, hiçbir şey engellenmiyor,
   tarayıcı jesti istediği an alabilir.
2. **owning** — eşik, parmak tolerans içinde kalarak doldu. Parmak
   kımıldamadığına göre kaydırma başlamamıştır; sekans hiçbir kaydırmayı
   kesmeden alınabilir.
3. **idle** — uçuşta bir şey yok.

`touch-action` bunu ifade edemez: jest *başlarken* okunur. Sonradan
ayarlamak hiçbir şey değiştirmez, baştan ayarlamak ise ölçü numarasından
sayfayı kaydırmayı yasaklardı — §8'in tam tersi. Bunun yerine, drag pointer'a
sahip olduğu sürece her `touchmove` `{ passive: false }` bir dinleyiciyle
reddediliyor; dinleyici `document` üzerinde, çünkü parmak başladığı ölçüyü
terk ediyor — jestin kendisi bu.

`pointercancel` ve `pointerup` aynı bırakmayı çalıştırıyor; yalnız
`pointerup`'ta temizlenen bir kurulum, platform bir drag'i her kestiğinde
sayfayı kaydırılamaz bırakırdı.

Parmağın altındaki ölçü `elementFromPoint` ile bulunuyor: pointer capture
sonraki bütün olayları yakalanan elemana yönlendirdiği için `event.target`
bütün drag boyunca başlangıç ölçüsünü gösterir. Bölüm kimliği de indeksle
birlikte taşınıyor — her bölüm ölçülerini sıfırdan numaralar.

`pointerOwner` sıralaması: `bar_range` > `duration` > `measure` > `pen` >
`selection` > `none`. `stopsPageScroll` yalnız ilk ikisi için true.

**Bulunan ek kusur:** seçim tutamakları (44px, `top-0`) band'ın ölçü başlığı
şeridini kaplıyor ve ölçü jestine gidecek presleri alıyordu. Tutamaklar
`BAR_HEADER_HEIGHT` kadar aşağı indi; band görünüşü değişmedi (zaten
`pointer-events-none`).

## 10. Android scroll delta sonucu

Drag sırasında `document.scrollingElement.scrollTop` deltası dört viewport'ta
da **0** (adım 20). Jest bittikten sonra tab yatayda normal kayıyor: 120px
istendi, 120px hareket etti (adım 22). Hiçbir yere global `touch-action: none`
konmadı.

412×915 Android Chrome UA ile koşuluyor; **bu tek başına fiziksel cihaz
kanıtı değildir** ve öyle sayılmadı.

## 11. İki bitişik ölçü selection kanıtı

Adım 19, dört viewport: ölçü başlığına basılı tutup parmağı sağa sürüklemek
seçim özetini «… · 2 ölçü» yapıyor. Telefonda komşu ölçü ekranda yok — 1/16
bir ölçü 544px, ekran 320px — bu yüzden görünüm parmağı takip ediyor
(kenar bandı 44px, 12px/16ms). Kaydırma sırasında sabit duran parmağın
altındaki ölçü her tick'te yeniden okunuyor; yoksa resim kayar, seçim yerinde
kalırdı.

## 12. Multi-repeat / history / undo sonucu

Adım 21, dört viewport: gerçekten iki ölçü tutulduğu doğrulandıktan sonra
«Tekrarla → 2 kez» uygulanıyor, fingerprint değişiyor ve **tek** «Geri al»
byte-eş geri getiriyor.

Bir düzeltme: ilk denemede adım track kapsamında tekrarlıyordu ve uygulama
«Bu yönde bölüm içinde yer yok.» dedi — haklıydı. Track tekrarı var olan
ölçülere yazar; iki ölçünün iki kopyası dört boş ölçü ister, fixture toplam
dört ölçü. Adım bütün-ölçü kapsamına taşındı, orada tekrar *ekler*.

## 13. Nota / ölçü / bütün-ölçü capability tablosu

Ölçülen (adım 12–15, her biri görünürlük **ve** basılabilirlik):

| Ölçüm | Sonuç |
|---|---|
| nota seçimi pano fiillerini sunuyor | Kopyala + Yapıştır çizili ve açık |
| nota seçimi ölçü fiili sunmuyor | eşleşme yok |
| tek-track ölçü seçimi | `scope=track`, «İçeriği sil» var, «Ölçüyü kaldır» yok |
| tek-track + boş pano | «Daha fazla» kapısı hiç çizilmiyor |
| bütün-ölçü seçimi | `scope=full`, özet «Tüm enstrümanlar · 1 ölçü» |
| bütün-ölçü «Arkasına ölçü ekle» | çizili **ve** basılabilir |
| ölçü ekleme | şarkı 4 → 5 ölçü, tek «Geri al» byte-eş |

Rapordaki «Nota/ölçü ayrımı» satırı artık sekiz kontrol okuyor; hiçbiri "—"
kalamıyor çünkü her birinin kendi ekranı var.

## 14. Dört viewport kabulü

`node eval/editor-2ub/verify.mjs` — 27 ölçüm × 4 context = **108/108**,
40 ekran görüntüsü.

Context'ler: 320×700, 390×844, 412×915 (Android Chrome UA), 1363×936
(`touch=0`). Masaüstünde `hasTouch` kapalı, jestler mouse ile; üçünde CDP
touch. Böylece koşum aynı dalı dört kez ölçmüyor.

Her ölçüm gerçek DOM/pointer akışıyla: iç komut çağrısı yok, hook'a uzanma
yok. "Bir yazma" iddiası da müzikten okunuyor — fingerprint değişti, tek
«Geri al» eskisini byte-eş getirdi, tek «İleri al» yenisini.

## 15. Mutation sonuçları

`./eval/editor-2ub/probes.sh` — **32 kırmızı, 0 vacuous, 0 invalid.**

Runner sıfır test koşan bir mutasyonu INVALID sayar (sözdizimi hatasına puan
vermez), timeout'u bulgu saymaz, ve yeşil kalan mutasyonu adıyla VACUOUS
listeler — asla toplamaz.

İlk koşumda **dört vacuous** çıktı ve dördü de gerçek boşluktu; hiçbiri
iddia zayıflatılarak değil, test güçlendirilerek kapatıldı:

| Vacuous | Neydi | Ne eklendi |
|---|---|---|
| 02 | boş seçimde paste gizlense kimse fark etmiyordu | boş hedefte paste açık, komşuları greyed testi |
| 04 | adım listesinin "yazmaz" sözü test edilmiyordu | her adımın `no_write`/`one_write` sözü doğrulanıyor |
| 15 | iki ölçü kapsamının farkı test edilmiyordu | track kapsamı yapısal fiilleri reddediyor testi |
| 16 | probe, kararın yaşamadığı bir suite'e bakıyordu | karar `bar-transform.ts`'e taşındı ve doğrudan test edildi |

## 16. Değişen dosyalar ve satır bütçeleri

Yeni: `bar-menu.ts`, `bar-range-drag.ts`, `use-bar-range-drag.ts` (+ testleri),
`eval/editor-2ub/*`.

Değişen: `selection-capability`, `selection-descriptor` (—), `bar-transform`,
`bar-messages`, `use-bar-transform`, `measure-gesture`, `pointer-ownership`,
`selection-verbs`, `use-selection-session`, `BarActionBar`, `SelectionToolbar`,
`SelectionActionArea`, `FrettedBarBlock`, `DrumBarBlock`, `TabCanvas`,
`WorkspaceSurface`, `TimeSelectionBand`, `editor-fixture`, `editor-steps`,
`editor-report`, `useEditorWatch`, `EditorAcceptance`.

Bütçeler **yükseltilmedi**:

| Dosya | Sınır | Şimdi |
|---|---|---|
| `Workspace.tsx` | 379 | 377 |
| `TabCanvas.tsx` | 480 | 459 |
| `ArrangementCanvas.tsx` | 470 | 470 |
| `MultiTrackCanvas.tsx` | 500 | 340 |

## 17. Final komutlar

Final HEAD üzerinde taze koşuldu; sonuçlar §21'in altında.

## 18. Temiz diff ve push

Çalışma ağacı temiz, bütün commit'ler `claude/proje-yorumları-n06wen`
dalına push edildi.

## 19. Fiziksel Android acceptance hâlâ açık

Bu turda hiçbir fiziksel cihaz kullanılmadı. 412×915 + Android Chrome UA bir
emülasyondur; dokunmatik olaylar CDP ile üretildi. **"Physical PASS"
yazılmadı ve yazılamaz.**

## 20. Founder verdict

Sayfa hâlâ kendi başına founder kabulü yazmıyor; son satır sabit. Bu turun
kapattığı şey otomatik ölçümdür — editörü kullanan insan hâlâ gerekiyor.

**Founder verdict: Haktan onayı bekliyor.**

## 21. Kapsam dışı bırakılanlar

UI Contract v1 değişmedi. Yeni articulation, audio motoru, Copilot, APK,
analytics, release hardening yok; K-59 açılmadı. Kullanıcının kendi
verisine yazılmadı — kabul koşumu sonunda `aranje.project.1` byte-eş
(adım 27, 4/4 viewport).
