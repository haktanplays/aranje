/**
 * What can go wrong with a project file, and the one sentence each gets
 * (spec 13.15, 2L-A).
 *
 * A closed set of codes and a single Turkish table, for the same reason the
 * recovery banner has one: whatever actually failed — a parser, a schema, a
 * validator — the musician reads a sentence about their project, never a
 * diagnostic. There is no code path from an exception message, a schema path
 * or a file's raw content to any of these strings.
 */
import { BRAND_NAME } from "@/lib/brand";

export type ProjectFileErrorCode =
  | "file_too_large"
  | "file_read_failed"
  | "invalid_json"
  | "invalid_project"
  | "unsupported_project_version"
  | "song_invalid"
  | "storage_unavailable"
  | "import_no_change"
  | "internal_error";

/*
 * `invalid_json` and `invalid_project` share a sentence on purpose. The
 * difference between "the text would not parse" and "the text parsed into
 * something that is not a project" matters to a test and to nobody holding a
 * phone: both mean this file is not an Aranje project.
 */
const NOT_A_PROJECT = `Bu dosya geçerli bir ${BRAND_NAME} projesi değil.`;

export const PROJECT_FILE_MESSAGES: Readonly<
  Record<ProjectFileErrorCode, string>
> = {
  file_too_large: "Bu proje dosyası desteklenen boyuttan büyük.",
  file_read_failed: "Dosya okunamadı. Dosyayı yeniden seçmeyi dene.",
  invalid_json: NOT_A_PROJECT,
  invalid_project: NOT_A_PROJECT,
  unsupported_project_version: `Bu proje daha yeni bir ${BRAND_NAME} sürümüyle oluşturulmuş. Bu sürüm dosyayı açamıyor.`,
  song_invalid:
    "Projede çalınabilirlik hataları bulundu; mevcut şarkın değiştirilmedi.",
  storage_unavailable: "Cihazda kayıt açılamadığı için proje açılamıyor.",
  import_no_change: "Bu proje, açık olan şarkıyla zaten aynı.",
  internal_error: "Beklenmeyen bir sorun oldu. Yeniden dene.",
};

/**
 * The sentence shown when an *export* is refused because the current song
 * carries validator errors. Not an import code: nothing was read, nothing was
 * at risk — the file was simply not produced.
 */
export const EXPORT_BLOCKED_MESSAGE =
  "Şarkıda düzeltilmesi gereken hatalar var; proje dosyası oluşturulamadı.";
