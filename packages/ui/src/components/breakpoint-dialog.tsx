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
  /**
   * Stable across edits so React keeps focus while a field is retyped, and
   * stable across REMOVALS because it is stored with the row rather than
   * recomputed from its index.
   */
  key: string;
  id: string;
  label: string;
  width: string;
  /**
   * Whether this row was added in this session.
   *
   * A saved breakpoint's id is the key every stored style is filed under, and
   * `onSave` carries only the breakpoint set — so renaming one here would
   * detach every style on every page that uses it, with nothing to report it.
   */
  isNew: boolean;
}

/**
 * Seeds the draft with keys derived from the position a row was loaded at.
 *
 * Deterministic rather than drawn from a counter: a module-level counter is
 * shared by every render on a server and starts again at zero in the browser,
 * so the same row would be keyed `row-9` in prerendered markup and `row-0` on
 * hydration — and these keys reach the DOM through the field ids.
 */
function toDraft(axis: BreakpointAxis, defs: BreakpointDef[]): DraftRow[] {
  return defs.map((def, index) => ({
    key: `${axis}-${index}`,
    id: def.id,
    label: def.label,
    width: def.maxWidth === undefined ? "" : String(def.maxWidth),
    isNew: false,
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
    // A SAVED id is passed through byte for byte. The engine uses it verbatim
    // as the key stored styles are filed under, so trimming one that arrived
    // with surrounding whitespace would re-key it on an unrelated width edit
    // and detach those styles — the loss the field being read-only exists to
    // prevent, reintroduced underneath it. A row added here has no styles
    // behind it yet, so trimming what was just typed is safe and expected.
    id: row.isNew ? row.id.trim() : row.id,
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
      viewport: toDraft("viewport", value.viewport),
      container: toDraft("container", value.container),
    })
  );
  // Scoped to this instance, so nothing about a key depends on how many times
  // the module has been rendered.
  const addedRows = React.useRef(0);
  const wasOpen = React.useRef(open);

  // Re-seeded on the CLOSED-to-OPEN transition only. Depending on `value`
  // itself would reseed on any parent render that rebuilt it — a background
  // settings refresh, a parent re-render with a fresh object literal — and
  // discard an edit in progress while the dialog is still on screen.
  React.useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opening) return;
    addedRows.current = 0;
    setDraft({
      viewport: toDraft("viewport", value.viewport),
      container: toDraft("container", value.container),
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
        {
          key: `${axis}-added-${addedRows.current++}`,
          id: "",
          label: "",
          width: "",
          isNew: true,
        },
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
                        // Stacked until there is room for four columns. At a
                        // phone width the fixed grid left Name and Id about
                        // 48px each, which is unreadable for an existing id and
                        // unusable for typing a new one.
                        className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[1fr_1fr_7rem_auto]"
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
                          // Fixed once saved. The id is the key every stored
                          // style is filed under, and saving carries only the
                          // breakpoint set — so a rename here would detach
                          // every style on every page that uses it, silently.
                          // Removing the breakpoint and adding a new one is
                          // the same operation with the loss made visible.
                          readOnly={!row.isNew}
                          hint={
                            row.isNew
                              ? undefined
                              : "Fixed once saved — styles are filed under it."
                          }
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
                          className={cn(
                            "justify-self-end",
                            index === 0 && "sm:mt-6"
                          )}
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
  readOnly,
  hint,
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
  readOnly?: boolean;
  hint?: string;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
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
          readOnly={readOnly}
          aria-invalid={error !== undefined}
          // Only ever names elements that EXIST. Pointing at an absent id
          // leaves the control described by nothing, which reads to a screen
          // reader as no error and no hint at all.
          // Names only elements that are actually RENDERED. The hint is
          // suppressed while an error is showing, so listing its id then would
          // point assistive technology at nothing.
          aria-describedby={
            [
              error !== undefined ? errorId : null,
              hint && error === undefined ? hintId : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={cn(
            suffix && "pr-8",
            readOnly && "text-muted-foreground bg-muted/50",
            className
          )}
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
      {hint && !error && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
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
