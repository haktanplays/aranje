/**
 * Everything the export surface says, in one place (spec 13.19, 2M-A §12).
 *
 * A raw exception, a Tone diagnostic or a browser error string never reaches
 * the screen: a person who asked for a file needs to know what happened and
 * what to do, and "DOMException: The operation failed" is neither.
 */
import { BRAND_NAME } from "@/lib/brand";

export type ExportErrorCode =
  | "render_failed"
  | "encode_failed"
  | "midi_failed"
  | "project_failed"
  | "busy";

export const EXPORT_MESSAGES: Readonly<Record<ExportErrorCode, string>> = {
  render_failed: "Dışa aktarma tamamlanamadı. Şarkı işlenirken bir sorun çıktı.",
  encode_failed: "Dışa aktarma tamamlanamadı. Ses dosyası yazılamadı.",
  midi_failed: "Dışa aktarma tamamlanamadı. MIDI dosyası yazılamadı.",
  project_failed:
    "Proje dosyası oluşturulamadı. Şarkıda dışa aktarmayı engelleyen bir hata var.",
  busy: "Bir dışa aktarma zaten sürüyor. Bitmesini bekle.",
};

/** What the state machine is doing, said plainly. */
export const EXPORT_STATUS_TEXT = {
  preparing: "Sesler hazırlanıyor",
  renderingWav: "Şarkı işleniyor",
  encodingWav: "WAV hazırlanıyor",
  encodingMidi: "MIDI hazırlanıyor",
  encodingProject: "Proje dosyası hazırlanıyor",
  ready: "İndirmeye hazır",
} as const;

/** What each format is for, in the words someone choosing between them needs. */
export const EXPORT_FORMAT_TEXT = {
  project: {
    label: `${BRAND_NAME} projesi`,
    hint: `Şarkıyı daha sonra ${BRAND_NAME}'de düzenlemek için.`,
  },
  wav: {
    label: "Ses dosyası",
    hint: `Dinlemek ve paylaşmak için; mevcut ${BRAND_NAME} enstrüman seslerini kullanır.`,
  },
  midi: {
    label: "MIDI",
    hint:
      "Başka müzik programlarında notaları ve zamanlamayı düzenlemek için; " +
      `${BRAND_NAME}'nin enstrüman sesi ve bazı çalım teknikleri taşınmaz.`,
  },
} as const;

/** The two WAV content choices, and what each one means for the audio. */
export const WAV_SCOPE_TEXT = {
  all: {
    label: "Tüm track'ler",
    hint: "Sustur ve tek dinle yok sayılır; şarkının kendi ses ve stereo ayarları kullanılır.",
  },
  audible: {
    label: "Şu anda duyduklarım",
    hint: "Mikser'de sustur ve tek dinle ile seçtiğin dinleme durumu bu dosyaya uygulanır.",
  },
} as const;

/**
 * The MIDI honesty note.
 *
 * Not a disclaimer bolted on at the end: it is the difference between a file
 * that carries notes and a file that pretends to carry a performance.
 */
export const MIDI_ARTICULATION_NOTE =
  "MIDI notaları ve zamanlamayı taşır. Bend, slide, vibrato ve bazı gitar " +
  "teknikleri başka programlarda aynı duyulmayabilir.";

/** Playback is paused, deliberately and visibly, and does not resume itself. */
export const EXPORT_PLAYBACK_NOTE =
  "Dışa aktarma başlarken çalma duraklatılır. Playhead bulunduğu yerde kalır " +
  "ve dosya hazır olduğunda çalma kendiliğinden devam etmez.";

/** Said where storage is closed, so the reader knows what still works. */
export const EXPORT_READ_ONLY_NOTE =
  "Bu oturumda değişiklikler kaydedilemiyor, ama dışa aktarma çalışır.";

export const WAV_LICENSE_NOTE =
  `WAV, ${BRAND_NAME}'nin FluidR3 tabanlı enstrüman örnekleriyle üretilir. ` +
  "Dosyayı paylaşırken aşağıdaki atfı da taşı.";

/** MIDI carries no sample audio, so it does not carry the sample obligation. */
export const MIDI_LICENSE_NOTE =
  "MIDI dosyası ses örneği içermez; bu atıf yalnız WAV için gereklidir.";
