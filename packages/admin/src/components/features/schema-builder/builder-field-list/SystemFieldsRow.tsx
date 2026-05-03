// Why: PR D collapses the 2-row "Built in" group into a single compact
// horizontal row labeled "System Fields" containing all 5 reserved
// names. They're rendered as inert chips -- not clickable, no per-row
// badges, no editor opens. The "Show / Hide system fields" pref still
// lives in localStorage and stays in sync with the BuilderSettingsModal
// switch via the existing `builder:show-system-fields` window event.
//
// Caller (BuilderFieldList) owns the localStorage state + window-event
// listener; this component just renders what it's told and emits an
// onSetVisible callback for its own dismiss / show button. The button
// also broadcasts via the window event so the Settings modal switch
// reflects the change without a refresh.
import type { BuilderField } from "../types";

const STORAGE_KEY = "builder.showSystemInternals";

type Props = {
  /** The system fields actually present in builder.fields (typically title + slug). */
  systemFields: readonly BuilderField[];
  /** Whether to render the 3 synthesized internals (id, createdAt, updatedAt). */
  showInternals: boolean;
  onSetVisible: (next: boolean) => void;
};

const INTERNAL_NAMES = ["id", "createdAt", "updatedAt"] as const;

export function SystemFieldsRow({
  systemFields,
  showInternals,
  onSetVisible,
}: Props) {
  const setVisible = (next: boolean) => {
    onSetVisible(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(
        new CustomEvent("builder:show-system-fields", { detail: next })
      );
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          System Fields
        </div>
        {showInternals && (
          <button
            type="button"
            aria-label="Hide system fields"
            className="text-[10px] text-muted-foreground hover:text-foreground leading-none"
            onClick={() => setVisible(false)}
            title="Hide system fields"
          >
            ×
          </button>
        )}
      </div>

      {/* Why: single horizontal row of inert chips, fully locked. Wraps
          on narrow viewports. */}
      <div className="flex flex-wrap gap-1.5">
        {systemFields.map(f => (
          <SystemChip key={f.id} name={f.name} type={f.type} />
        ))}
        {showInternals &&
          INTERNAL_NAMES.map(n => <SystemChip key={n} name={n} type="" />)}
      </div>

      {!showInternals && (
        <button
          type="button"
          onClick={() => setVisible(true)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ▸ Show system fields ({INTERNAL_NAMES.length})
        </button>
      )}
    </div>
  );
}

function SystemChip({ name, type }: { name: string; type: string }) {
  return (
    <div
      data-row-id={`system-${name}`}
      // Why: cursor-default + no onClick so the chip reads as
      // informational, not actionable.
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-dashed border-border bg-muted/30 text-xs text-muted-foreground cursor-default"
    >
      <span className="font-medium">{name}</span>
      {type && <span className="opacity-60">{type}</span>}
    </div>
  );
}
