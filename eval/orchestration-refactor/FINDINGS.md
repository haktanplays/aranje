# 2L-R — Workspace orkestrasyon ayrıştırması: bulgular

## Sorumluluk haritası (önce → sonra)

| Sorumluluk | Önce | Sonra |
|---|---|---|
| Görünüm/track/bar odağı/scroll hedefleri | Workspace içinde 6 state | `use-workspace-navigation` |
| Zaman + ölçü seçimi, panolar, staged komutlar, sheet'leri | Workspace içinde ~10 state/handler kümesi | `use-selection-session` |
| Edit modu, hücre, fret hedefi, onset grubu | Workspace içinde 5 state | `use-note-editing` |
| Üst düzey sheet'ler | 5 bağımsız boolean | `use-workspace-overlays` (typed enum) |
| Düzen/Tab yüzeyi | Workspace JSX | `WorkspaceSurface` |
| Bütün sheet'ler + arrange formu | Workspace JSX + form state | `WorkspaceOverlays` |
| Aksiyon şeritleri + transform sheet | Workspace JSX | `SelectionActionArea` |
| Arrangement hücreleri/tutamaç/rAF | ArrangementCanvas içinde | `arrangement/` altında 3 modül |

Ölçümler: Workspace 1543 → 416 satır (useState 18 → **0**, useCallback 26 → 10,
useMemo 17 → 5, JSX event prop 71 → 17*); ArrangementCanvas 881 → 470.
(*event prop'ların çoğu artık sahip bileşenlerde.)

## Kökte kalanların gerekçesi

- `resetEditSurfaces` + undo/redo: iki sahibin (seçim oturumu + not editörü)
  ve Copilot'un aynı anda yere bırakılması — birden çok sahibi ilgilendiren
  zamk, kökün işi.
- `prepareForProjectApply`: playback + seçimler + panolar + navigation'ı tek
  sırada zemine indirir.
- Copilot kapıları (`previewOpen`/`arrangeOpen`/`canEdit`): birden çok
  yüzeyin paylaştığı türetilmiş kapılar; state değil.
- `timeline`/`arrangement` memoları: saf model kurucularının çağrısı;
  algoritma değil.

## Parite kanıtı

- `PARITY-BEFORE.json` / `PARITY-AFTER.json` / `COMPARISON.json`: iki
  viewport'ta bounds **piksel-eş**; scroller 1, taşma 0, hedefler 44px;
  AudioContext 1, ~60 rAF/s, üç görünüm geçişinde çalma sürüyor; süreler eşit
  veya daha iyi (ör. 390×844 boot median 287→249 ms, tab'a geçiş 75→57 ms).
  Masaüstü Chromium ölçümü; fiziksel telefon kanıtı değildir.
- Yeni regresyon paketi: 20 senaryo × 2 viewport = **40/40** (Copilot demo
  döngüsü dahil; demo `NEXT_PUBLIC_ARANJE_COPILOT_DEMO=true` build'i ister —
  bayrak build'e gömülüdür ve script başlığı bunu söyler).
- Konsolide harness sonrası: storage **50/50**, project-file **52/52**.

## Dürüstlük kayıtları

1. **bar-ops 23/29 ve history 22/36 — refactor'dan önce de böyleydi.**
   Baseline commit (`2061840`) ayrı bir worktree'de kuruldu, kendi (rewire
   öncesi) harness'ları kendi build'ine karşı koşuldu: düşen senaryolar
   birebir aynı liste. Kök neden 2K-B: `aranje.song` artık zarf taşıyor
   (suite'lerin `JSON.parse(...).sections` okuyuşu patlıyor) ve undo/redo
   artık diske yazıyor ("writes +3" beklentileri). Bu checkpoint kapsam
   gereği onarmadı; bakım borcu olarak kayda geçti.
2. **Arrange formu bilinçli olarak sheet'in taslağı.** Form, mount olduğu
   şarkıya göre başlar (hydration'da örnek şarkı) — refactor öncesi davranış
   birebir buydu; regresyon senaryosu bu yüzden bölüm + hedef çipine okuyucu
   gibi dokunur.
3. **Playwright'ta `Sheet` backdrop'u köşeden tıklanır** — merkezi panelin
   altında kaldığından actionability beklemesine takılıyor; harness bunu
   `{position:{x:8,y:8}}` ile çözüyor (uygulama davranışı değil, harness
   ayrıntısı).

## Vacuity

16 probe (12 unit `probes.sh` + 4 tarayıcı `browser-probes.sh`), 16/16
kırmızı; probe 13, grep'e dönüşün masum bir Tailwind sınıfını suçladığını
bizzat gösteriyor.
