/**
 * The eight turns of S-02, in order.
 *
 * The instruction carries the musician's own words and what *this* turn is
 * for. It deliberately does **not** describe the previous section's motif:
 * S-01 had to, because the prompt could not show it, and that workaround is
 * what the arrangement context replaced. If a turn cannot tell what to
 * develop from what it is shown, that is a finding, not something to paper
 * over here.
 */
import type { TurnSpec } from "./harness";

/** The musician's own words, verbatim, artist names included. */
export const RAW_REQUEST =
  "Pantera tarzı, şu ana kadar gitar tarafında eklediğimiz bütün " +
  "özellikleri kullanabildiğimiz, sert bir break, bridge ve sololu 1 " +
  "dakikalık bir şey yapabilir mi? Baterisi de zengin olsun; bassı " +
  "paslayabilirsin. Sonuna da temiz, sadece akustik bir Opeth bridge/outro " +
  "istiyorum. Davul yok, elektrik gitar yok; sadece akustik gitar olacak. " +
  "Pasajlar birbirine otursun.";

const turn = (
  index: number,
  label: string,
  sectionId: string,
  targetTrackId: string,
  role: TurnSpec["role"],
  local: string,
): TurnSpec => ({
  index,
  label,
  sectionId,
  targetTrackId,
  role,
  instruction: `${RAW_REQUEST}\n\nBu tur: ${local}`,
});

export const TURNS: readonly TurnSpec[] = [
  turn(1, "Break / rhythm", "sec-1", "rhythm_guitar", "rhythm_guitar",
    "Parcanin acilis riff'ini yaz. Sonraki bolumlerde gelistirilecek ritmik " +
    "hucreyi burada kur; sus hucrenin parcasi olsun."),
  turn(2, "Break / drums", "sec-1", "drums", "drums",
    "Half-time omurga kur. Kick gitarin aksanlarini desteklesin, her onset'i " +
    "kopyalamasin. Crash yalniz bolum basinda ve donuste."),
  turn(3, "Bridge / rhythm", "sec-2", "rhythm_guitar", "rhythm_guitar",
    "Onceki bolumun hucresini gelistir; yeni bir riff gibi baslama. Yogunlugu " +
    "artir, kromatik gerilim ekle, en az bir slide baglam icinde kullan. Son " +
    "bar cozulmemis bir gerilimle Solo'ya birak."),
  turn(4, "Bridge / drums", "sec-2", "drums", "drums",
    "Break'ten daha yogun. Daha zengin fill ve cymbal hareketi, ama her " +
    "boslugu doldurma. Son bar Solo'ya gecisi hazirlasin."),
  turn(5, "Solo / rhythm", "sec-3", "rhythm_guitar", "rhythm_guitar",
    "Ayni hucrenin sadelestirilmis backing hali. Lead'e yer ac; nabzi tut ama " +
    "solonun register'ini bos birak."),
  turn(6, "Solo / lead", "sec-3", "lead_guitar", "lead_guitar",
    "Solo cizgisi. Motif gelistirerek ilerle, scale run yazma, cumleler " +
    "arasinda nefes birak. Son hedef nota tonik olsun; akustik bolum onu " +
    "devralacak."),
  turn(7, "Solo / drums", "sec-3", "drums", "drums",
    "En hareketli davul; lead cumlelerini destekle. Son olcude akustik " +
    "kapanisa yer acmak icin kontrollu sekilde cekil."),
  turn(8, "Coda / acoustic", "sec-4", "acoustic_guitar", "acoustic_guitar",
    "Bu bolumde baska hicbir track yok. Onceki bolumun biraktigi notayi " +
    "devral, acik tel pedal ve arpej kullan, kapanis cozulmus ama asiri " +
    "mutlu olmasin."),
];
