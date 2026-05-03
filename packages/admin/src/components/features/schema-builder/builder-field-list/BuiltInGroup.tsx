// Why: built-in (system) fields are non-reorderable, locked, and grouped at
// the top of the field list. We always show title + slug because they're
// part of the user's mental model (real columns in record lists, drive
// URLs). The infrastructure ones (id, createdAt, updatedAt) are
// SYNTHESIZED here as informational rows — they're not real entries in
// builder.fields, so we don't filter them out, we generate them.
//
// The "Show / Hide system fields" toggle persists the user's choice in
// localStorage so the preference sticks across sessions. Per the audit
// the synthesized rows are display-only — clicking them is a no-op
// because they're managed by the runtime (id from primary-key, timestamps
// from the timestamps toggle in BuilderSettingsModal).
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
  const [showInternals, setShowInternals] = useState(false);

  useEffect(() => {
    setShowInternals(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const toggle = () => {
    const next = !showInternals;
    setShowInternals(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Built in
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

      {showInternals && (
        <>
          {INTERNAL_ROWS.map(row => (
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
        </>
      )}

      <button
        type="button"
        onClick={toggle}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        {showInternals ? "▾ Hide" : "▸ Show"} system fields (
        {INTERNAL_ROWS.length})
      </button>
    </div>
  );
}
