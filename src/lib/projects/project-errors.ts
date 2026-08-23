/**
 * Everything the project library can refuse, and the one sentence for each
 * (spec 13.21 §22, 2O-A).
 *
 * A closed union and a total table. The table is typed as a `Record` over the
 * union rather than a lookup with a fallback, so adding a code without adding
 * its sentence is a **compile error** — not a runtime `undefined` that reaches
 * a musician as an empty banner.
 *
 * The sentences say what happened to the *music*. No storage key, no Zod
 * issue, no exception name, no project id: a reader whose device is full needs
 * to know their work is safe, and "QuotaExceededError on aranje.project-3"
 * tells them nothing they can act on.
 */
import { BRAND_NAME } from "@/lib/brand";

export type ProjectErrorCode =
  /** The catalog names a project whose payload is not there. */
  | "project_not_found"
  /** The payload is there and is not a project record this version knows. */
  | "project_slot_invalid"
  | "project_catalog_invalid"
  /** A newer Aranje wrote the catalog. Not ours to touch. */
  | "project_catalog_future_version"
  | "project_future_version"
  /** Both slots of a project's record are unreadable. */
  | "project_corrupt"
  | "project_recovery_failed"
  | "project_storage_unavailable"
  | "project_storage_write_failed"
  | "project_storage_quota_exceeded"
  | "project_migration_failed"
  /** A multi-step operation stopped half way and could not be settled. */
  | "project_operation_incomplete"
  /** Another tab moved this project on while this one was holding it. */
  | "project_changed_elsewhere"
  | "project_name_invalid"
  | "project_no_change"
  | "cannot_delete_last_project"
  | "cannot_delete_active_without_survivor"
  | "project_import_invalid"
  | "project_import_no_change"
  | "project_validation_failed";

export const PROJECT_MESSAGES: Readonly<Record<ProjectErrorCode, string>> = {
  project_not_found: "Bu proje artık cihazında bulunamıyor.",
  project_slot_invalid: "Bu proje açılamadı; kaydı okunamıyor.",
  project_catalog_invalid:
    "Proje listesi okunamadı. Projelerinin kayıtları silinmedi.",
  // The brand is interpolated rather than typed: source files stay ASCII and
  // the reader still sees the real name (spec 1.4).
  project_catalog_future_version:
    `Proje listen ${BRAND_NAME}'nin daha yeni bir sürümüyle kaydedilmiş. ` +
    "Üzerine yazılmadı.",
  project_future_version:
    `Bu proje ${BRAND_NAME}'nin daha yeni bir sürümüyle kaydedilmiş. ` +
    "Üzerine yazılmadı.",
  project_corrupt: "Bu projenin kaydı açılamadı. Verisi olduğu gibi korundu.",
  project_recovery_failed:
    "Bu proje kurtarılamadı. Hiçbir şeyin üzerine yazılmadı.",
  project_storage_unavailable:
    "Cihazda kayıt açılamadı. Projelerini dinleyebilir ve yedekleyebilirsin, " +
    "ama yeni kayıt yapılamıyor.",
  project_storage_write_failed:
    "Proje kaydedilemedi. Mevcut çalışman değiştirilmedi.",
  project_storage_quota_exceeded:
    "Cihazda bu proje için yeterli kayıt alanı açılamadı. " +
    "Mevcut projelerin değiştirilmedi.",
  project_migration_failed:
    "Şarkın proje kütüphanesine taşınamadı. Eski kaydın olduğu gibi duruyor.",
  project_operation_incomplete:
    "İşlem tamamlanamadı. Projelerin olduğu gibi duruyor.",
  project_changed_elsewhere:
    "Bu proje başka bir sekmede değişti. Çalışmanı ezmemek için düzenleme " +
    "kapatıldı; son sürümü açmak için sayfayı yenile.",
  project_name_invalid: "Proje adı boş olamaz.",
  project_no_change: "Bu proje zaten böyle.",
  cannot_delete_last_project:
    "Son proje silinemez. Önce yeni bir proje oluştur, sonra bunu silebilirsin.",
  cannot_delete_active_without_survivor:
    "Bu proje silinemedi; açılacak başka bir proje bulunamadı.",
  project_import_invalid: "Bu dosya açılamadı.",
  project_import_no_change: "Bu dosyadaki müzik zaten açık projende var.",
  project_validation_failed:
    "Bu değişiklik kontrollerden geçmedi ve uygulanmadı.",
};

export type ProjectFailure = {
  readonly code: ProjectErrorCode;
  readonly message: string;
};

export function projectFail(code: ProjectErrorCode): { ok: false; error: ProjectFailure } {
  return { ok: false, error: { code, message: PROJECT_MESSAGES[code] } };
}
