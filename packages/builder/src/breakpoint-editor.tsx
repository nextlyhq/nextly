"use client";

import { Button, Input, Label } from "@nextlyhq/ui";
import { cn } from "@nextlyhq/ui/utils";
import { Plus, Trash2, TriangleAlert } from "lucide-react";
import * as React from "react";

import {
  BASE_BREAKPOINT,
  BREAKPOINT_AXES,
  storedLimitFor,
  validateBreakpoints,
  type BreakpointAxis,
  type BreakpointDef,
  type BreakpointIssue,
  type BreakpointSet,
} from "./breakpoints";

/** What the container axis is called, where a site uses it. */
const CONTAINER_TITLE = "Container widths";

/** A new breakpoint's id, made from its name: styles are filed under it. */
function idFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** An id not already taken, numbered after the first that is. */
function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Where a breakpoint applies, in the device buttons' words: from just above
 * the next narrower breakpoint up to its own width.
 */
function rangeOf(rows: readonly DraftRow[], row: DraftRow): string {
  const width = Number(row.width);
  if (row.width.trim() === "" || !Number.isFinite(width) || width <= 0) {
    return "";
  }
  const narrower = rows
    .map(other => Number(other.width))
    .filter(other => Number.isFinite(other) && other > 0 && other < width);
  if (narrower.length === 0) return `up to ${width}px`;
  const below = Math.max(...narrower);
  // A whole pixel more is where the range starts only between whole widths:
  // a fractional width hands over just above itself, so "481.5" after 480.5
  // would leave out a real stretch the wider breakpoint already covers.
  return Number.isInteger(below) && Number.isInteger(width)
    ? `${below + 1}–${width}px`
    : `above ${below}px, up to ${width}px`;
}

/**
 * Props for BreakpointEditor.
 * @experimental
 */
export interface BreakpointEditorProps {
  /** The site's saved breakpoints. Treated as the starting point, never mutated. */
  value: BreakpointSet;
  /**
   * Leave editing: after a save that succeeded, or on Cancel. Never while a
   * save is in flight, so a draft cannot be dropped with its write unanswered.
   */
  onClose: () => void;
  /**
   * Told when a save starts and settles, so a host that could take the editor
   * away (closing a dialog, switching a tab) holds off until the write answers.
   */
  onSavingChange?: (saving: boolean) => void;
  /**
   * Called with the edited set when the author saves.
   *
   * Only ever called with a set that produces no issues, so a host does not
   * have to re-validate before storing it.
   *
   * **A promise is awaited, and the editor stays open until it settles.** A host
   * that persists over the network resolves with a message when the write was
   * refused, and the draft is still on screen to retry or copy from. Closing on
   * the click instead — which this did — threw away a set the author had just
   * built by hand the moment a save failed, with nothing left to recover it
   * from: the editor was gone, the draft with it, and the site's breakpoints
   * unchanged.
   *
   * Resolving with `undefined`, or returning nothing at all, means saved. A
   * synchronous host needs no change.
   *
   * Resolving with `null` means nothing was saved and there is nothing to
   * say: the author went back from a step the host showed before saving (a
   * confirmation, say), so the draft stays open as it was, with no refusal.
   */
  onSave: (next: BreakpointSet) => void | Promise<string | null | undefined>;
  /**
   * Why the set cannot be saved right now, when the host learns one while the
   * editor is open (a removal started elsewhere, say): Save is disabled and
   * the reason shown, and the draft stays on screen to save once it clears.
   */
  blocked?: string;
}

/**
 * Whether a value can be awaited, without asking which realm made it.
 *
 * `instanceof Promise` is a check about one global constructor, and the values
 * this has to recognise may not come from it.
 */
function isThenable(
  value: unknown
): value is PromiseLike<string | null | undefined> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
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
 * Drawn in place, as the section it edits, rather than in a dialog of its
 * own: it lives in Settings, and a dialog over a dialog splits focus and
 * Escape between two layers. The draft is seeded once, when editing starts.
 *
 * @example
 * ```tsx
 * {editing ? (
 *   <BreakpointEditor
 *     value={site.breakpoints}
 *     onSave={next => saveSettings({ breakpoints: next })}
 *     onClose={() => setEditing(false)}
 *   />
 * ) : null}
 * ```
 */
export function BreakpointEditor({
  value,
  onSave,
  onClose,
  onSavingChange,
  blocked,
}: BreakpointEditorProps): React.JSX.Element {
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
  /*
   * Whether a save is in flight, and why the last one was refused.
   *
   * Derived here rather than taken as props. A `saving` prop can disagree with
   * the promise this component is actually awaiting — a host that forgets to
   * clear it leaves the editor permanently disabled with no way to close the
   * loop — and the only thing that knows when THIS save settled is the promise
   * returned to THIS click.
   */
  const [saving, setSavingState] = React.useState(false);
  const setSaving = (next: boolean): void => {
    setSavingState(next);
    onSavingChange?.(next);
  };
  const [refusal, setRefusal] = React.useState<string | undefined>(undefined);

  const issues = React.useMemo(
    () => validateBreakpoints(toSet(draft)),
    [draft]
  );

  /*
   * Every edit is refused while a save is in flight, and the fields say so.
   *
   * The request carries the draft as it was at the click. Left editable, a
   * change made in the window before the promise settles is not in that
   * request AND is discarded by the close that follows it — the author watches
   * their own edit vanish into a save that reported success. Freezing the form
   * is what makes "the set that was submitted" and "the set on screen" the same
   * thing at every moment the editor is open.
   */
  const updateRow = (
    axis: BreakpointAxis,
    key: string,
    patch: Partial<DraftRow>
  ): void => {
    if (saving) return;
    setDraft(current => ({
      ...current,
      [axis]: current[axis].map(row =>
        row.key === key ? { ...row, ...patch } : row
      ),
    }));
  };

  /**
   * A new name, and for a row added in this session the id made from it.
   * Unique across both axes and never the base's, with a fallback for a name
   * that makes no id (one with no Latin letters or digits), so any name the
   * engine would accept can be saved without the author ever seeing the id.
   */
  const renameRow = (
    axis: BreakpointAxis,
    key: string,
    label: string
  ): void => {
    if (saving) return;
    setDraft(current => {
      const taken = new Set(
        BREAKPOINT_AXES.flatMap(other =>
          current[other].filter(row => row.key !== key).map(row => row.id)
        )
      );
      taken.add(BASE_BREAKPOINT);
      return {
        ...current,
        [axis]: current[axis].map(row =>
          row.key !== key
            ? row
            : {
                ...row,
                label,
                ...(row.isNew
                  ? { id: uniqueId(idFromName(label) || "breakpoint", taken) }
                  : {}),
              }
        ),
      };
    });
  };

  const addRow = (axis: BreakpointAxis): void => {
    if (saving) return;
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
    if (saving) return;
    setDraft(current => ({
      ...current,
      [axis]: current[axis].filter(row => row.key !== key),
    }));
  };

  const save = (): void => {
    if (issues.length > 0 || saving || blocked !== undefined) return;
    setRefusal(undefined);
    const outcome = onSave(toSet(draft));
    /*
     * A THENABLE, not an `instanceof Promise`.
     *
     * The contract accepts a promise, and `instanceof` answers about one realm:
     * a promise from another window or iframe, or a conforming implementation
     * that is not the global constructor, fails the test. The editor would then
     * close as though the write were synchronous, and a refusal or rejection
     * arriving afterwards would be neither shown nor handled — the exact loss
     * the await exists to prevent, restored by the check meant to detect it.
     *
     * A synchronous host is still finished here, and awaiting its `undefined`
     * would cost a microtask — long enough to paint a disabled button with
     * nothing to wait for.
     */
    if (!isThenable(outcome)) {
      onClose();
      return;
    }
    setSaving(true);
    void Promise.resolve(outcome)
      .then(message => {
        if (message === undefined) {
          onClose();
          return;
        }
        // Kept: not saved, and nothing to report beside the draft.
        if (message === null) return;
        setRefusal(message);
      })
      .catch((reason: unknown) => {
        /*
         * A rejection is a refusal too, and the editor must not close on one.
         * A host that throws rather than resolving is not following the
         * contract, but the author's draft is not the place to make that point.
         */
        setRefusal(
          reason instanceof Error
            ? reason.message
            : "These breakpoints could not be saved."
        );
      })
      .finally(() => {
        setSaving(false);
      });
  };

  /*
   * Leaving is refused while a save is in flight, for the reason the frozen
   * fields are: taken during a pending write, the editor unmounts with the
   * draft, a refusal that lands afterwards has nowhere to be shown, and
   * editing again seeds from a read that has not caught up, so submitting
   * that draft overwrites the write still in flight.
   */
  const cancel = (): void => {
    if (saving) return;
    onClose();
  };

  return (
    <div className="space-y-4" data-breakpoint-editor="">
      <div className="space-y-6">
        {BREAKPOINT_AXES.filter(
          // The container axis only on a site that already uses it: most
          // sites style by the window's width alone.
          axis => axis === "viewport" || draft[axis].length > 0
        ).map(axis => {
          const rows = draft[axis];
          const left = storedLimitFor(axis) - rows.length;
          return (
            <section key={axis} className="space-y-2">
              {axis === "container" ? (
                <h4 className="text-sm font-medium">{CONTAINER_TITLE}</h4>
              ) : null}
              <div className="divide-y divide-border rounded-md border border-border">
                {axis === "viewport" ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="font-medium">Desktop</span>
                    <span className="text-muted-foreground">
                      the base, always applies
                    </span>
                  </div>
                ) : null}
                {rows.map((row, index) => {
                  const rowIssues = issuesForRow(issues, axis, index);
                  return (
                    <div
                      key={row.key}
                      className="grid grid-cols-[1fr_8rem_7rem_auto] items-start gap-2 px-3 py-2"
                    >
                      <Field
                        id={`${fieldId}-${row.key}-label`}
                        readOnly={saving}
                        label="Name"
                        hideLabel
                        value={row.label}
                        placeholder="Tablet"
                        // The id is the name's, and shown nowhere: a clash is
                        // said about the name, in plain words.
                        error={rowIssues.label ?? rowIssues.id}
                        onChange={label => renameRow(axis, row.key, label)}
                      />
                      <Field
                        id={`${fieldId}-${row.key}-width`}
                        readOnly={saving}
                        label="Up to"
                        hideLabel
                        value={row.width}
                        placeholder={axis === "container" ? "any" : "991"}
                        inputMode="numeric"
                        suffix="px"
                        error={rowIssues.maxWidth}
                        onChange={width => updateRow(axis, row.key, { width })}
                      />
                      <span className="pt-2 text-sm text-muted-foreground tabular-nums">
                        {rangeOf(rows, row)}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.label.trim() || "breakpoint"}`}
                        disabled={saving}
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
                  disabled={left <= 0 || saving}
                  onClick={() => addRow(axis)}
                >
                  <Plus className="size-4" />
                  Add breakpoint
                </Button>
                <span className="text-xs text-muted-foreground">
                  {left <= 0
                    ? "That is as many as a site can have."
                    : `You can add up to ${left} more.`}
                </span>
              </div>
            </section>
          );
        })}
        {draft.container.length === 0 ? (
          // The first container width has to start somewhere: a site that has
          // none sees this in place of the section.
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => addRow("container")}
          >
            <Plus className="size-4" />
            Add a container width
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className={cn(
            "text-xs",
            issues.length > 0 || refusal !== undefined
              ? "text-destructive"
              : "text-muted-foreground"
          )}
          // Announced rather than only coloured, so the reason Save is
          // unavailable reaches a screen reader too.
          role="status"
        >
          {/*
           * A REFUSAL outranks the issue count, because they answer different
           * questions and only one of them is news. The count says what the
           * author must fix before saving; a refusal says the save they just
           * made did not happen. A silent line beside a failed write would
           * read as confirmation.
           */}
          {/* Silent while every breakpoint is usable: the line speaks only
              when something is wrong. Kept mounted, so what it then says is
              announced. */}
          {/* The host's reason next: it holds every save, a problem or not. */}
          {refusal ??
            blocked ??
            (issues.length === 0
              ? ""
              : `${issues.length} ${issues.length === 1 ? "problem" : "problems"} to fix before saving.`)}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={issues.length > 0 || saving || blocked !== undefined}
            onClick={save}
          >
            {saving ? "Saving…" : "Save breakpoints"}
          </Button>
        </div>
      </div>
    </div>
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
