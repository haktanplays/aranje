# eval/editor-completion — 2V-B.4

İki koşucu, iki soru.

**`inventory.mjs`** — §3'ün ölçüm matrisi. Altı viewport × iki jest (bir hücreye
dokunuş, bir uzun basış) ve on iki ölçümün her biri için aynı sorular: grid'in
görünür yüksekliği, grid'in merkezi hit testine cevap veriyor mu, shelf ne kadar
yer alıyor, kaç tam ekran örtü var, kaç birincil eylem var, aynı adı taşıyan iki
kontrol var mı, ilk yüzeyde jargon geçiyor mu, aynı uyarı tekrarlanıyor mu.

Nokta ekran görüntüleri değil: «grid kahramandır», «tek birincil eylem»,
«bir iş için tek tasarım» ve «müziğin üstü kapanmaz» piksel hakkında
iddialardır, ve bunları değiştiren bir tur sayıları önce ve sonra
gösterebilmelidir.

```
SHA=$(git rev-parse HEAD) LABEL=before node eval/editor-completion/inventory.mjs
```

**`fast-sequence.mjs`** — §5/§7/§20'nin akışı, gerçek UI'da yürünmüş. Editörü
açar, bir pozisyona dokunur, `Ritim → Hızlı dizi → sayı → Bağlı → Dinle →
Uygula → geri al` yolunu yürür ve her adımda grid'in hâlâ ekranda olduğunu,
`Uygula`'dan önce hiçbir şey yazılmadığını, ölçünün uzamadığını ve tek undo'nun
bütün koşuyu geri aldığını ölçer.

```
SHA=$(git rev-parse HEAD) node eval/editor-completion/fast-sequence.mjs
```

İkisi de `npm run build` + `eval/editor-2vb1/serve.sh` ister: SHA `next.config.ts`
tarafından **build zamanında** gömülür, yani commit'ten sonra yeniden build
edilmemiş bir sunucu doğru davranışla reddeder.

Sonuçlar: `artifacts/INVENTORY-{before,after}.json`,
`artifacts/FAST-SEQUENCE.json`, ekran görüntüleri ve `REPORT-2V-B4.md`.
