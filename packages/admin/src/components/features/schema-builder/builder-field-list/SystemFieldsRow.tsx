// Why: PR D introduced a single compact horizontal row labeled "System
// Fields" containing all 5 reserved names. PR G (feedback 2) wraps the
// chips in a bordered dashed box with an alert-style "Hide" button
// positioned top-right inside the box. The "Show / Hide system fields"
// pref still lives in localStorage and stays in sync with the
// BuilderSettingsModal switch via the existing
// `builder:show-system-fields` window event.
//
// Caller (BuilderFieldList) owns the localStorage state + window-event
// listener; this component just renders what it's told and emits an
// onSetVisible(false) callback when the user clicks Hide. The button
// also broadcasts via the window event so the Settings modal switch
// reflects the change without a refresh.
//
// All 5 names always render together (PR G dropped the partial "show
// 3 internals only" state). When the user wants the box back, they
// re-enable it from the Settings modal.
import type { BuilderField } from "../types";

const STORAGE_KEY = "builder.showSystemInternals";
const INTERNAL_NAMES = ["id", "createdAt", "updatedAt"] as const;

type Props = {
  /** The system fields actually present in builder.fields (typically title + slug). */
  systemFields: readonly BuilderField[];
  onSetVisible: (next: boolean) => void;
};

export function SystemFieldsRow({ systemFields, onSetVisible }: Props) {
  const handleHide = () => {
    onSetVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "false");
      window.dispatchEvent(
        new CustomEvent("builder:show-system-fields", { detail: false })
      );
    }
  };

  return (
    <div className="space-y-1">
      {/* PR G: label sits OUTSIDE the box per feedback 2. */}
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        System Fields
      </div>

      {/* PR G: dashed bordered box containing all 5 chips + alert-style
          Hide button positioned top-right inside the box. */}
      <div className="relative border border-dashed border-border bg-white rounded-md p-3">
        <button
          type="button"
          onClick={handleHide}
          className="absolute top-1/2 -translate-y-1/2 right-2 text-[10px] text-muted-foreground hover:text-foreground hover-subtle-row px-1.5 py-0.5 rounded-sm cursor-pointer"
          title="Hide system fields. Re-enable from Settings."
        >
          Hide
        </button>

        <div className="flex flex-wrap gap-1.5 pr-12">
          {systemFields.map(f => (
            <SystemChip key={f.id} name={f.name} type={f.type} />
          ))}
          {INTERNAL_NAMES.map(n => (
            <SystemChip key={n} name={n} type="" />
          ))}
        </div>
      </div>
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
