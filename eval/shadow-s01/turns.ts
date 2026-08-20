/**
 * The eight turns, in the order the eval fixes them.
 *
 * The instruction text is the same musical brief every time, carried in the
 * request's `instruction` field — which is the data layer, fenced and read as
 * content, never as an instruction to the model about how to behave. Each turn
 * adds what *this* section and *this* track are for, because the model is only
 * ever shown one section and one track.
 *
 * A note on the skill: the public contract has three (`drums`, `bass`,
 * `harmony`) and every guitar turn here has to use `harmony`, because that is
 * the only skill whose family is "guitar". Its skill card describes a second
 * guitar written around a main one, which is not what the Break's rhythm part
 * or the acoustic outro is. That gap is reported rather than papered over: no
 * skill was added for the eval.
 */
import { SECTION_IDS, TRACK_IDS } from "./seed";
import type { TurnSpec } from "./harness";

/** The musician's brief, byte-identical in every turn (eval section 6). */
export const BRIEF =
  "Yaklasik bir dakikalik ozgun bir enstrumantal duzenleme olustur. Sert " +
  "bolumlerde dusuk akortlu, groove merkezli, syncopated ve stop-start metal " +
  "riffleri kullan. Ritim agir ve saldirgan olsun; kromatik gerilim, palm " +
  "mute ve belirgin aksanlar bulunsun. Davul gitar ritmini desteklesin fakat " +
  "birebir kopyalamasin; guclu half-time omurga, kontrollu double-kick, " +
  "crash gecisleri ve zengin ama olculu fill'ler kullansin. Solo, D minor ve " +
  "blues-minor renkleri etrafinda motif gelistirerek ilerlesin; bend, " +
  "vibrato, slide, hammer-on ve pull-off dogal cumlelerin icinde yer alsin. " +
  "Son bolumde butun elektrik gitarlar ve davul tamamen sussun; yalniz " +
  "karanlik, acik telli ve arpejli akustik gitar kalsin. Akustik kapanis solo " +
  "bolumunun son notasini veya motifini devralarak onceki pasajlarla dogal " +
  "bicimde baglansin. Mevcut bir sanatcinin veya sarkinin melodisini taklit " +
  "etme.";

const turn = (
  index: number,
  label: string,
  sectionId: string,
  targetTrackId: string,
  skill: TurnSpec["skill"],
  local: string,
): TurnSpec => ({
  index,
  label,
  sectionId,
  targetTrackId,
  skill,
  instruction: `${BRIEF}\n\nBu tur: ${local}`,
});

export const TURNS: readonly TurnSpec[] = [
  turn(
    1,
    "Break / Rhythm Guitar",
    SECTION_IDS.break,
    TRACK_IDS.rhythm,
    "harmony",
    "Parcanin acilis riff'i. Bu bolumde baska gitar yok, bu yuzden ana riff " +
      "sensin: ikinci bir gitar gibi geri cekilme. Drop D dusuk telinde D " +
      "pedal uzerine syncopated, dur-kalk bir groove yaz. Bol sus birak; her " +
      "slotu doldurma. Palm mute ile bogulmus D pedal ve accent'li ana " +
      "vurgular kullan. Kromatik yaklasim notasi (Eb) olculu kullanilabilir " +
      "ama bar'in cogunlugu D minor cekirdeginde kalmali. Bu riff sonraki " +
      "bolumde gelistirilecek bir motif olmali.",
  ),
  turn(
    2,
    "Break / Drums",
    SECTION_IDS.break,
    TRACK_IDS.drums,
    "drums",
    "Guclu half-time omurga: snare 3. vurusta. Kick gitar aksanlarini " +
      "desteklesin ama her onset'i kopyalamasin. Crash yalniz bolum basinda " +
      "ve donuslerde. Suslari koru; groove'un nefes almasi gerekiyor.",
  ),
  turn(
    3,
    "Heavy Bridge / Rhythm Guitar",
    SECTION_IDS.bridge,
    TRACK_IDS.rhythm,
    "harmony",
    "Onceki bolumun riff'ini GELISTIR; yeni ve ilgisiz bir riff gibi " +
      "baslama. " +
      "Gelistirilecek motif -- onceki bolum bu promptta gorunmuyor (sozlesme " +
      "tek bolum tasir), bu yuzden burada tarif ediliyor: 16'lik izgarada " +
      "vurus noktalari 0, 3, 6, 10, 12, aradaki slotlar bos; accent 0, 6 ve " +
      "12'de, aralar palm mute; cevap cumlesinde F-Eb-D kromatik inis. " +
      "Ayni ritmik hucreyi taniyacak sekilde koru ama ritim " +
      "yogunlugunu artir. Kromatik inis veya tritone (Ab) gerilimi " +
      "kullanilabilir. En az bir slide baglam icinde ve olculu kullan: " +
      "slide'in hedef notasi, kendinden onceki notayla ayni telde ve arada " +
      "gercek sus olmadan gelmeli. Son bar Solo'ya acik bir gerilim/landing " +
      "hazirlasin.",
  ),
  turn(
    4,
    "Heavy Bridge / Drums",
    SECTION_IDS.bridge,
    TRACK_IDS.drums,
    "drums",
    "Break'ten daha yogun. Daha zengin fill ve cymbal hareketi kullan ama " +
      "her bosluga fill koyma. Son bar Solo'ya gecisi acik bir crash ve fill " +
      "ile hazirlasin.",
  ),
  turn(
    5,
    "Solo / Rhythm Guitar",
    SECTION_IDS.solo,
    TRACK_IDS.rhythm,
    "harmony",
    "Onceki motifin SADELESTIRILMIS backing versiyonu. " +
      "Gelistirilecek motif -- onceki bolum bu promptta gorunmuyor (sozlesme " +
      "tek bolum tasir), bu yuzden burada tarif ediliyor: 16'lik izgarada " +
      "vurus noktalari 0, 3, 6, 10, 12, aradaki slotlar bos; accent 0, 6 ve " +
      "12'de, aralar palm mute; cevap cumlesinde F-Eb-D kromatik inis. " +
      "Lead gitara yer " +
      "acmak icin seyrek yaz: uzun palm mute pedal notalari ve bar basi " +
      "aksanlari yeterli. Enerji davulla korunsun ama lead'i bogma.",
  ),
  turn(
    6,
    "Solo / Lead Guitar",
    SECTION_IDS.solo,
    TRACK_IDS.lead,
    "harmony",
    "Solo cizgisi. D minor / blues-minor cekirdegi, motif gelistirerek " +
      "ilerleyen cumleler; rastgele scale run yazma. Cumleler arasinda nefes " +
      "birak. En az bir yarim bend, bir tam bend, bir vibrato, bir slide, " +
      "bir hammer-on, bir pull-off, bir sustain ve bir accent dogal yerlerde " +
      "bulunsun. slide/hammer_on/pull_off yazdigin her nota, kendinden " +
      "onceki nota ile AYNI telde ve arada gercek sus olmadan gelmeli; " +
      "hammer_on yalniz yukari, pull_off yalniz asagi yonde. Solonun son " +
      "hedef notasi D olsun: akustik kapanis bu notayi devralacak.",
  ),
  turn(
    7,
    "Solo / Drums",
    SECTION_IDS.solo,
    TRACK_IDS.drums,
    "drums",
    "Break ve Bridge'den daha hareketli; lead cumlelerini destekle. Her " +
      "boslugu fill ile doldurma. Son olcude akustik kapanisa yer acmak icin " +
      "kontrollu sekilde cekil: son bar'in ikinci yarisinda davul sussun.",
  ),
  turn(
    8,
    "Acoustic Outro / Acoustic Guitar",
    SECTION_IDS.outro,
    TRACK_IDS.acoustic,
    "harmony",
    "Bu bolumde baska hicbir track yok: yalniz akustik gitar. Ikinci bir " +
      "gitar gibi geri cekilme, bolumun tamami sensin. Solonun son notasi D " +
      "idi; bunu ilk akorda veya ust seste devral. Acik tel pedal ve arpej " +
      "kullan; Dm(add9) / Dsus2 gibi karanlik ama tonal olarak bagli renkler " +
      "uygun. Onceki sert motifin -- 16'lik izgarada 0, 3, 6 vurus noktalari, " +
      "aralar bos -- ritmik kucuk bir golgesi bulunsun; tamamen baska bir sarki baslamis gibi olmasin. Son bar " +
      "cozulmus fakat asiri mutlu olmayan bir kapanis versin.",
  ),
];
