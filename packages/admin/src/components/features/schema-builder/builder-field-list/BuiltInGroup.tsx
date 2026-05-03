// Why: built-in (system) fields are non-reorderable, locked, and grouped at
// the top of the field list. We always show title + slug because they're
// part of the user's mental model (real columns in record lists, drive
// URLs). The infrastructure ones (id, createdAt, updatedAt) are
// SYNTHESIZED here as informational rows -- they're not real entries in
// builder.fields, so we don't filter them out, we generate them.
//
// PR B (2026-05-03): default visible = true. Inline X dismiss button
// next to the "Built in" label hides them without opening Settings. The
// Settings modal's "Show system fields" switch flips the same
// localStorage key, and dispatches a window event so this component
// stays in sync without a refresh.
import { useEffect, useState } from "react";

import type { BuilderField } from "../types";

type Props = {
  /** The system fields actually present in builder.fields (typically title + slug). */
  systemFields: readonly BuilderField[];
  /** Click handler for editable system rows. Locked rows ignore it. */
  onEditField: (id: string) => void;
};

const STORAGE_KEY = "builder.showSystemInternals";

const INTERNAL_ROWS: ReadonlyArray<{
  name: string;
  type: string;
  hint: string;
}> = [
  { name: "id", type: "uuid", hint: "Primary key" },
  { name: "createdAt", type: "timestamp", hint: "When the row was created" },
  { name: "updatedAt", type: "timestamp", hint: "Last update time" },
];

export function BuiltInGroup({ systemFields, onEditField }: Props) {
  // Why: default true per Mobeen 2026-05-03. localStorage === "false"
  // honors an explicit user dismissal across sessions.
  const [showInternals, setShowInternals] = useState(true);

  useEffect(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    setShowInternals(v === null ? true : v === "true");
  }, []);

  // Listen for the Settings modal's "Show system fields" switch flipping
  // the same key so we update without a refresh.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const next = (e as CustomEvent<boolean>).detail;
      setShowInternals(next === true);
    };
    window.addEventListener("builder:show-system-fields", onUpdate);
    return () =>
      window.removeEventListener("builder:show-system-fields", onUpdate);
  }, []);

  const setVisible = (next: boolean) => {
    setShowInternals(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Built in
        </div>
        {showInternals && (
          // Why: tiny inline dismiss so the user can hide system internals
          // without opening Settings. Mirrors the toggle in
          // BuilderSettingsModal Advanced > Show system fields.
          <button
            type="button"
            aria-label="Hide system fields"
            className="text-[10px] text-muted-foreground hover:text-foreground leading-none"
            onClick={() => setVisible(false)}
            title="Hide system internals (id, createdAt, updatedAt)"
          >
            ×
          </button>
        )}
      </div>

      {systemFields.map(f => (
        <button
          key={f.id}
          type="button"
          data-row-id={`system-${f.id}`}
          onClick={() => onEditField(f.id)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-muted/40 text-left text-sm text-muted-foreground hover:bg-muted/60"
        >
          <span className="font-medium">{f.name}</span>
          <span className="text-xs">{f.type}</span>
          <span className="ml-auto text-[10px] border border-current rounded-sm px-1 py-0.5 opacity-60">
            LOCKED
          </span>
        </button>
      ))}

      {showInternals &&
        INTERNAL_ROWS.map(row => (
          <div
            key={row.name}
            data-row-id={`system-${row.name}`}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border bg-muted/20 text-sm text-muted-foreground cursor-default"
            title={row.hint}
          >
            <span className="font-medium">{row.name}</span>
            <span className="text-xs">{row.type}</span>
            <span className="ml-auto text-[10px] border border-current rounded-sm px-1 py-0.5 opacity-50">
              MANAGED
            </span>
          </div>
        ))}

      {!showInternals && (
        <button
          type="button"
          onClick={() => setVisible(true)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ▸ Show system fields ({INTERNAL_ROWS.length})
        </button>
      )}
    </div>
  );
}
