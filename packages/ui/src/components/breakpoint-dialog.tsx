"use client";

import { Plus, Trash2, TriangleAlert } from "lucide-react";
import * as React from "react";

import {
  BASE_BREAKPOINT_ID,
  BREAKPOINT_AXES,
  inCascadeOrder,
  storedLimitFor,
  validateBreakpoints,
  type BreakpointAxis,
  type BreakpointDef,
  type BreakpointIssue,
  type BreakpointSet,
} from "../lib/breakpoints";
import { cn } from "../lib/utils";

import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";
import { Label } from "./label";

/** What each axis is called and what it responds to, in the author's terms. */
const AXIS_COPY: Record<BreakpointAxis, { title: string; hint: string }> = {
  viewport: {
    title: "Viewport",
    hint: "Responds to the width of the browser window.",
  },
  container: {
    title: "Container",
    hint: "Responds to the width of the element a block sits in, so one block can adapt wherever it is placed.",
  },
};

/**
 * Props for BreakpointDialog.
 * @experimental
 */
export interface BreakpointDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The site's saved breakpoints. Treated as the starting point, never mutated. */
  value: BreakpointSet;
  /**
   * Called with the edited set when the author saves.
   *
   * Only ever called with a set that produces no issues, so a host does not
   * have to re-validate before storing it.
   */
  onSave: (next: BreakpointSet) => void;
}

/** A draft row. Width is held as TEXT while editing. */
interface DraftRow {
  /** Stable across edits so React keeps focus while the id field is retyped. */
  key: string;
  id: string;
  label: string;
  width: string;
}

let nextRowKey = 0;

function toDraft(defs: BreakpointDef[]): DraftRow[] {
  return defs.map(def => ({
    key: `row-${nextRowKey++}`,
    id: def.id,
    label: def.label,
    width: def.maxWidth === undefined ? "" : String(def.maxWidth),
  }));
}

/**
 * A draft row as a definition.
 *
 * An empty width field means "no bound", which the container axis has a use
 * for. A field holding something unparseable becomes `NaN` rather than
 * `undefined`: the two are different mistakes and validation reports them
 * differently, so collapsing them here would tell the author the wrong thing.
 */
function toDef(row: DraftRow): BreakpointDef {
  const width = row.width.trim();
  return {
    id: row.id.trim(),
    label: row.label.trim(),
    ...(width === "" ? {} : { maxWidth: Number(width) }),
  };
}

function toSet(draft: Record<BreakpointAxis, DraftRow[]>): BreakpointSet {
  return {
    viewport: draft.viewport.map(toDef),
    container: draft.container.map(toDef),
  };
}

/** The issues for one row, keyed by the field they belong to. */
function issuesForRow(
  issues: BreakpointIssue[],
  axis: BreakpointAxis,
  index: number
): Partial<Record<BreakpointIssue["field"], string>> {
  const byField: Partial<Record<BreakpointIssue["field"], string>> = {};
  for (const issue of issues) {
    if (issue.axis !== axis || issue.index !== index) continue;
    byField[issue.field] ??= issue.message;
  }
  return byField;
}

/**
 * Edit the breakpoints a site's styles may respond to.
 *
 * Editing is held locally and committed on save, so a half-typed width never
 * reaches the host. Save is refused while any definition would be discarded at
 * compile time — the failure mode this exists to prevent is silent: a
 * breakpoint the compiler cannot use simply stops existing, and the styles
 * saved against it surface as stale much later.
 *
 * @experimental
 *
 * @example
 * ```tsx
 * <BreakpointDialog
 *   open={open}
 *   onOpenChange={setOpen}
 *   value={site.breakpoints}
 *   onSave={next => saveSettings({ breakpoints: next })}
 * />
 * ```
 */
export function BreakpointDialog({
  open,
  onOpenChange,
  value,
  onSave,
}: BreakpointDialogProps) {
  const fieldId = React.useId();
  const [draft, setDraft] = React.useState<Record<BreakpointAxis, DraftRow[]>>(
    () => ({
      viewport: toDraft(value.viewport),
      container: toDraft(value.container),
    })
  );

  // Re-seeded whenever the dialog is opened rather than on every change to
  // `value`, so a save that round-trips through the host does not wipe an edit
  // in progress, and re-opening always starts from what is stored.
  React.useEffect(() => {
    if (!open) return;
    setDraft({
      viewport: toDraft(value.viewport),
      container: toDraft(value.container),
    });
  }, [open, value]);

  const issues = React.useMemo(
    () => validateBreakpoints(toSet(draft)),
    [draft]
  );

  const updateRow = (
    axis: BreakpointAxis,
    key: string,
    patch: Partial<DraftRow>
  ): void => {
    setDraft(current => ({
      ...current,
      [axis]: current[axis].map(row =>
        row.key === key ? { ...row, ...patch } : row
      ),
    }));
  };

  const addRow = (axis: BreakpointAxis): void => {
    setDraft(current => ({
      ...current,
      [axis]: [
        ...current[axis],
        { key: `row-${nextRowKey++}`, id: "", label: "", width: "" },
      ],
    }));
  };

  const removeRow = (axis: BreakpointAxis, key: string): void => {
    setDraft(current => ({
      ...current,
      [axis]: current[axis].filter(row => row.key !== key),
    }));
  };

  const save = (): void => {
    if (issues.length > 0) return;
    onSave(toSet(draft));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Breakpoints</DialogTitle>
          <DialogDescription>
            The widths your styles can respond to. Each one is an upper bound,
            so a style set at a breakpoint applies at that width and below.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-8 overflow-y-auto pr-1">
          {BREAKPOINT_AXES.map(axis => {
            const rows = draft[axis];
            const limit = storedLimitFor(axis);
            const atLimit = rows.length >= limit;

            return (
              <section key={axis} className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">
                    {AXIS_COPY[axis].title}
                  </h3>
                  <p className="text-muted-foreground text-xs">
                    {AXIS_COPY[axis].hint}
                  </p>
                </div>

                {axis === "viewport" && (
                  <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-2 text-xs">
                    <span className="font-mono">{BASE_BREAKPOINT_ID}</span> is
                    built in and always applies. It uses one of this
                    axis&rsquo;s {limit + 1} slots, leaving {limit}.
                  </p>
                )}

                <div className="space-y-2">
                  {rows.map((row, index) => {
                    const rowIssues = issuesForRow(issues, axis, index);
                    return (
                      <div
                        key={row.key}
                        className="grid grid-cols-[1fr_1fr_7rem_auto] items-start gap-2"
                      >
                        <Field
                          id={`${fieldId}-${row.key}-label`}
                          label="Name"
                          hideLabel={index > 0}
                          value={row.label}
                          placeholder="Tablet"
                          error={rowIssues.label}
                          onChange={label =>
                            updateRow(axis, row.key, { label })
                          }
                        />
                        <Field
                          id={`${fieldId}-${row.key}-id`}
                          label="Id"
                          hideLabel={index > 0}
                          value={row.id}
                          placeholder="tablet"
                          error={rowIssues.id}
                          className="font-mono"
                          onChange={id => updateRow(axis, row.key, { id })}
                        />
                        <Field
                          id={`${fieldId}-${row.key}-width`}
                          label="Up to"
                          hideLabel={index > 0}
                          value={row.width}
                          placeholder={axis === "container" ? "any" : "991"}
                          inputMode="numeric"
                          suffix="px"
                          error={rowIssues.maxWidth}
                          onChange={width =>
                            updateRow(axis, row.key, { width })
                          }
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(index === 0 && "mt-6")}
                          aria-label={`Remove ${row.label.trim() || "breakpoint"}`}
                          onClick={() => removeRow(axis, row.key)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={atLimit}
                    onClick={() => addRow(axis)}
                  >
                    <Plus className="size-4" />
                    Add breakpoint
                  </Button>
                  {atLimit && (
                    <span className="text-muted-foreground text-xs">
                      {limit} is the most this axis can hold.
                    </span>
                  )}
                </div>

                <CascadePreview rows={rows} />
              </section>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p
            className={cn(
              "text-xs",
              issues.length > 0 ? "text-destructive" : "text-muted-foreground"
            )}
            // Announced rather than only coloured, so the reason Save is
            // unavailable reaches a screen reader too.
            role="status"
          >
            {issues.length === 0
              ? "Every breakpoint is usable."
              : `${issues.length} ${issues.length === 1 ? "problem" : "problems"} to fix before saving.`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={issues.length > 0} onClick={save}>
              Save breakpoints
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One labelled field with its error, associated for assistive technology. */
function Field({
  id,
  label,
  hideLabel,
  value,
  placeholder,
  error,
  className,
  inputMode,
  suffix,
  onChange,
}: {
  id: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  placeholder?: string;
  error?: string;
  className?: string;
  inputMode?: "numeric";
  suffix?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className={cn("text-xs", hideLabel && "sr-only")}>
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-invalid={error !== undefined}
          // Only referenced when a message exists: pointing at an absent
          // element leaves a control described by nothing.
          aria-describedby={error === undefined ? undefined : errorId}
          className={cn(suffix && "pr-8", className)}
          onChange={event => onChange(event.target.value)}
        />
        {suffix && (
          <span
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs"
          >
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-destructive flex gap-1 text-xs">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The order the compiler will apply these in.
 *
 * Stored order is not application order — the compiler sorts widest first — so
 * an author reading the list top to bottom would otherwise infer a cascade that
 * runs the other way.
 */
function CascadePreview({ rows }: { rows: DraftRow[] }) {
  const named = rows.filter(row => row.label.trim() !== "");
  if (named.length < 2) return null;

  const ordered = inCascadeOrder(named.map(toDef));
  return (
    <p className="text-muted-foreground text-xs">
      Applied in this order:{" "}
      {ordered.map((def, index) => (
        <React.Fragment key={`${def.id}-${index}`}>
          {index > 0 && " → "}
          <span className="text-foreground">{def.label}</span>
        </React.Fragment>
      ))}
    </p>
  );
}
