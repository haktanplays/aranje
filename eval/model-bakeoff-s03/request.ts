/**
 * What the musician actually asked for, in their own words (spec §21).
 *
 * Both candidates get exactly this, byte for byte, and nothing else about the
 * brief. It is kept in one file so there is no way for the two runs to be
 * given different inputs by accident, and so a reader can check what was
 * asked without reading the harness.
 *
 * Artist names stay here because this is raw user data (spec 11.8). They do
 * not survive into a blueprint: the model is told to convert them into
 * feature-based targets, and a blueprint that carries a name back is a
 * finding, not something the harness edits out.
 */

/** Turn one: the original request. */
export const RAW_REQUEST =
  "Pantera tarzı, şu ana kadar gitar tarafında eklediğimiz bütün " +
  "özellikleri kullanabildiğimiz, sert bir break, bridge ve sololu 1 " +
  "dakikalık bir şey yapabilir mi? Baterisi de zengin olsun; bassı " +
  "paslayabilirsin. Sonuna da temiz, sadece akustik bir Opeth bridge/outro " +
  "istiyorum. Davul yok, elektrik gitar yok; sadece akustik gitar olacak. " +
  "Pasajlar birbirine otursun.";

/**
 * Turn two: what the musician said after listening to the previous attempt.
 *
 * Musical goals and negative examples, deliberately not note-level
 * instructions. Nothing here names a pitch, a bar or a slot.
 */
export const SECOND_ROUND_FEEDBACK =
  "Break doğal gelmedi; aşırı progresif ve additive duyulmasın. Sert ve " +
  "senkoplu olabilir ama temel 4/4 groove hissi kaybolmasın. Bridge, " +
  "Break'in kopyası olmasın; motifi tanınabilir biçimde geliştirsin ve " +
  "Solo'ya gerçek bir gerilim bıraksın. Slide merkezî bir numara olmasın " +
  "çünkü şu an bend gibi duyuluyor. Solo müzikal olsun ama fazla " +
  "frenlenmesin; cümleler nefes alırken potansiyeli de kesilmesin. " +
  "Solo'dan acoustic bölüme geçiş ve acoustic bölümün karanlık, açık telli " +
  "karakteri korunabilir. Davul yalnız daha fazla hit çalmasın; farklı " +
  "groove rolleri, kick/snare ilişkisi ve geçiş fill'leriyle gerçekten " +
  "varlık göstersin. 138'den 69'a ani yarılama gibi fren etkisi istemiyorum.";

/**
 * Turn two, second paragraph: the guitar-vocabulary note.
 *
 * Added after the same listening session. It asks for one advanced phrase
 * idea, not for all of them, and it says plainly that a technique the output
 * contract cannot express must not be faked or claimed.
 */
export const GUITAR_VOCABULARY_FEEDBACK =
  "Parçada boşlukların groove'a katkısını ve Solo altındaki seyrek backing " +
  "fikrini koru; bunlar işe yaradı. Ancak gitar yazımı başlangıç seviyesinde " +
  "kalmasın. Uygun bir yerde kısa ama belirgin bir scale-run veya melodic " +
  "sequence, daha gelişmiş bir arpej fikri, register değişimi ya da geniş " +
  "aralıklı bir slide kullanılabilir. Bunları teknik kutu doldurmak için " +
  "yığma. Sweep picking mevcut çıktı sözleşmesinde gerçekten ifade " +
  "edilemiyorsa taklit etme veya varmış gibi açıklama. Solo backing'i " +
  "lead'i örtmeden duyulabilir bırak.";

/** The whole brief, in the order the musician said it. */
export const FULL_BRIEF = [
  RAW_REQUEST,
  "",
  "Dinledikten sonra:",
  SECOND_ROUND_FEEDBACK,
  "",
  GUITAR_VOCABULARY_FEEDBACK,
].join("\n");
