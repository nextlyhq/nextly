"use client";

/**
 * Per-entry editor-mode toggle, contributed via
 * `contributes.admin.entryFormToolbarSlot` and rendered in the entry/single form
 * header toolbar. Presentational only — the admin owns react-hook-form and hands
 * this component `{ value, onChange }` for the mode field, so the plugin never
 * needs its own react-hook-form instance.
 *
 * `Normal` → the entity's own fields; `Page Builder` → the visual canvas (the
 * takeover layout hides the other fields). Renders nothing when the collection
 * has no page-builder field (no `controllerField`).
 */
import { Button } from "@nextlyhq/ui";

interface Props {
  controllerField?: string;
  value?: unknown;
  onChange?: (next: unknown) => void;
}

export function PageBuilderModeToggle({
  controllerField,
  value,
  onChange,
}: Props) {
  if (!controllerField) return null;
  const isBuilder = value === "builder";
  return (
    <div
      role="group"
      aria-label="Editor mode"
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      <Button
        type="button"
        size="sm"
        variant={isBuilder ? "ghost" : "default"}
        aria-pressed={!isBuilder}
        onClick={() => onChange?.("default")}
      >
        Normal
      </Button>
      <Button
        type="button"
        size="sm"
        variant={isBuilder ? "default" : "ghost"}
        aria-pressed={isBuilder}
        onClick={() => onChange?.("builder")}
      >
        Page Builder
      </Button>
    </div>
  );
}
