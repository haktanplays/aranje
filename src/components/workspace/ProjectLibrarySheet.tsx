"use client";

/**
 * Every project on the device (spec 13.21 §17, 2O-A).
 *
 * A list and two doors out of it: a new project, or one restored from a
 * backup file. Each row is the project's own name and shape, read from its
 * song — never a stored summary, and never an id. A reader has no use for
 * `project-3`, and a project id in an accessible name is a storage detail
 * escaping into a screen reader.
 *
 * The sheet holds no state of its own beyond which row is expanded. Opening,
 * duplicating, deleting and importing are the controller's, and the controller
 * hands them to the pure commands — this file cannot reach storage, a parser,
 * an envelope or the history even if it wanted to.
 *
 * Destructive confirmation is a separate sheet, so it cannot vanish with the
 * row that opened it.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  projectName,
  projectRowLabel,
  projectShape,
  projectWhen,
} from "@/lib/projects/project-copy";
import type { ProjectSummary } from "@/lib/projects/project-summary";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { ProjectLibraryHandle } from "@/lib/workspace/use-project-library";

const ROW_ACTION =
  "border-line text-text flex-1 rounded-lg border px-2 text-xs disabled:opacity-40";

export function ProjectLibrarySheet({
  library,
  templates,
  onNew,
  onImport,
  onBackup,
  now,
}: {
  library: ProjectLibraryHandle;
  /** The three song templates, so "Yeni proje" offers the same three. */
  templates: readonly { readonly id: string; readonly label: string }[];
  onNew: (templateId: string) => void;
  onImport: () => void;
  onBackup: (projectId: string) => void;
  /** Injected, so a row's "Bugün" is decided by the caller's clock. */
  now: number;
}) {
  const [expandedId, setExpanded] = useState<string | null>(null);
  const [choosingTemplate, setChoosingTemplate] = useState(false);

  return (
    <Sheet
      open
      title="Projeler"
      onClose={library.close}
      labelledBy="project-library-title"
      footer={
        <div className="flex gap-2">
          <SheetButton
            data-testid="project-new"
            tone="primary"
            disabled={!library.canModify}
            onClick={() => setChoosingTemplate((value) => !value)}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Yeni proje
          </SheetButton>
          <SheetButton
            data-testid="project-import"
            disabled={!library.canModify}
            onClick={onImport}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Yedekten yeni proje ekle
          </SheetButton>
        </div>
      }
    >
      {/*
        A refusal is one sentence about the reader's music. The controller
        chose it from the one message table; nothing is assembled here.
      */}
      {library.error ? (
        <p
          data-testid="project-error"
          role="alert"
          className="border-reject/50 text-reject mb-3 rounded-lg border px-3 py-2 text-sm"
        >
          {library.error}
        </p>
      ) : null}

      {choosingTemplate ? (
        <div data-testid="project-templates" className="mb-3 flex flex-col gap-2">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              data-project-template={template.id}
              onClick={() => {
                setChoosingTemplate(false);
                onNew(template.id);
              }}
              className="border-line text-text rounded-lg border px-3 text-left text-sm"
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              {template.label}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        A library with nothing in it is not a normal state — it means the
        device could not be read or could not be written, and the song on
        screen is whatever could still be recovered. Saying so is the whole
        difference between "you have no projects" and "this phone cannot save
        right now", and a reader looking at a blank list has no way to tell
        those apart.
      */}
      {library.projects.length === 0 ? (
        <p data-testid="project-list-empty" className="text-muted text-sm">
          Bu cihazda kayıtlı proje listesi açılamadı. Ekrandaki şarkıyı
          dinleyebilir ve yedekleyebilirsin.
        </p>
      ) : null}

      <ul data-testid="project-list" className="flex flex-col gap-2">
        {library.projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            expanded={expandedId === project.id}
            onToggle={() =>
              setExpanded((value) => (value === project.id ? null : project.id))
            }
            library={library}
            onBackup={onBackup}
            now={now}
          />
        ))}
      </ul>
    </Sheet>
  );
}

function ProjectRow({
  project,
  expanded,
  onToggle,
  library,
  onBackup,
  now,
}: {
  project: ProjectSummary;
  expanded: boolean;
  onToggle: () => void;
  library: ProjectLibraryHandle;
  onBackup: (projectId: string) => void;
  now: number;
}) {
  const when = projectWhen(project, now);
  const readable = project.health === "ok";

  return (
    <li data-project-row={project.id} className="border-line rounded-lg border">
      <button
        type="button"
        data-project-open={project.id}
        aria-label={projectRowLabel(project)}
        onClick={onToggle}
        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left"
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        <span className="flex w-full items-center gap-2">
          <span className="text-text truncate text-sm">{projectName(project)}</span>
          {project.isActive ? (
            <span
              data-testid="project-active"
              className="border-accept text-accept shrink-0 rounded border px-1 text-[10px]"
            >
              Açık
            </span>
          ) : null}
        </span>
        <span className="text-muted text-xs">{projectShape(project)}</span>
        {when ? <span className="text-muted text-[11px]">{when}</span> : null}
      </button>

      {expanded ? (
        <div data-project-actions={project.id} className="flex gap-1 px-2 pb-2">
          <button
            type="button"
            data-project-action="open"
            disabled={!readable || project.isActive || !library.canModify}
            onClick={() => library.openProject(project.id)}
            className={ROW_ACTION}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Aç
          </button>
          <button
            type="button"
            data-project-action="duplicate"
            disabled={!readable || !library.canModify}
            onClick={() => library.duplicate(project.id)}
            className={ROW_ACTION}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Çoğalt
          </button>
          <button
            type="button"
            data-project-action="backup"
            disabled={!readable}
            onClick={() => onBackup(project.id)}
            className={ROW_ACTION}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Yedekle
          </button>
          <button
            type="button"
            data-project-action="delete"
            disabled={!library.canModify || library.projects.length <= 1}
            onClick={() => library.askDelete(project.id)}
            className={`${ROW_ACTION} border-reject/60 text-reject`}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Sil
          </button>
        </div>
      ) : null}
    </li>
  );
}
