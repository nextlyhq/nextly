/**
 * A reader's own arrangement of the dashboard: what it stores, and what it
 * refuses to store.
 *
 * ## The stored layout is a THIRD reader of the widget contract
 *
 * The registry and the plugin channel are the other two. This one is different
 * in a way that decides most of the file: it holds data THIS core wrote, about
 * widgets it did not.
 *
 * That distinction is why the validation here is SHAPE ONLY, and why applying
 * `validateWidgetDefinition` to a stored row would be a defect rather than a
 * reuse. A placement's `size` is seeded from a widget's `defaultSize`, and that
 * widget may come from a plugin built against a NEWER core -- so a stored
 * layout can legitimately contain a size value this core has never heard of.
 * A closed-vocabulary check on read would throw on it and take the reader's
 * ENTIRE saved dashboard down, when the admin that draws it already survives
 * the same value by falling back to `full` (`admin/.../widgets/sizes.ts`:
 * "a value outside the enum is a shape the admin has to survive").
 *
 * So: `size` and `height` are checked as STRINGS, never against
 * `WIDGET_SIZES`/`WIDGET_HEIGHTS`, and they are TYPED as strings here for the
 * same reason -- a narrower type would be a promise this module cannot keep.
 * The one closed vocabulary in the file is {@link LAYOUT_SCHEMA_VERSION}, which
 * is the single field this core wrote itself and therefore the single field it
 * is entitled to have an opinion about.
 *
 * ## What a placement deliberately does NOT hold
 *
 * 🔴 No `requiredPermission`, and no other copy of anything the definition
 * owns. A placement stores an identity and a position. Every question about
 * whether this reader may SEE the widget is asked of the live registry on every
 * read -- so a permission tightened after a layout was saved takes effect
 * immediately. A copy here would be a permission decision frozen at save time,
 * which is drift in the one place where drift is a security bug.
 *
 * ## Why a placement id is not a widget id
 *
 * Placements are a full snapshot with their own identity, so one widget can
 * appear twice with different `config`. Keying by `widgetId` -- the WordPress
 * model -- makes every widget a singleton and cannot express that at all.
 * The DEFAULT set names each placement after its widget, because that is the
 * one arrangement where the two are genuinely one-to-one and a stable id keeps
 * repeated reads idempotent; a copy made later gets a generated one.
 *
 * @module domains/widgets/layout
 */

import { createHash } from "node:crypto";

import { NextlyError } from "../../errors/nextly-error";

import type { WidgetDefinition } from "./definition";

/**
 * The shape this core writes and understands.
 *
 * Bumped only when the payload's structure changes, alongside a migrator that
 * carries the older shape forward. A row naming a version this core does not
 * have is a DOWNGRADE -- the row was written by a newer core -- and that is
 * refused rather than guessed at, because guessing would silently discard the
 * fields this core cannot see.
 */
export const LAYOUT_SCHEMA_VERSION = 1;

/**
 * One card, at one position, for one reader.
 *
 * `size` and `height` are `string`, not `WidgetSize`/`WidgetHeight`, and that
 * is load-bearing rather than lazy -- see the module docblock.
 */
export interface WidgetPlacement {
  /** Opaque and unique WITHIN a layout. Not a widget id, except by default. */
  id: string;
  /** Which registry entry this draws. Resolved live on every read. */
  widgetId: string;
  /** Ascending. Finite, so it survives a JSON round trip. */
  order: number;
  /** Hidden placements are RETURNED, so the reader can put them back. */
  hidden: boolean;
  size?: string;
  height?: string;
  /** Per-placement settings. Opaque to core; the widget's own vocabulary. */
  config?: Record<string, unknown>;
}

/** The decoded contents of one `nextly_widget_layout.layout` column. */
export interface StoredLayout {
  schemaVersion: number;
  placements: WidgetPlacement[];
}

/** How far apart default placements sit, so one can be inserted between two. */
const DEFAULT_ORDER_STEP = 10;

function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `undefined`, or a string with real text in it. */
function optionalTextProblem(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string"
    ? undefined
    : `"${field}", when given, must be a string`;
}

/**
 * The rules a placement must satisfy, as a LIST rather than a ladder.
 *
 * A list because the ladder form put every rule in one function and tripped the
 * repository's complexity gate; the same shape `plugins/validate-admin-widgets`
 * uses, and for the same reason. Each rule answers about one field and says so
 * in words the reader of a rejected PUT can act on.
 *
 * Every rule here is a SHAPE rule. There is deliberately no rule asking whether
 * `size` is one of five, or whether `widgetId` names a widget that exists --
 * the first would refuse a newer plugin's size, and the second is a question
 * about the live registry, which is asked on every read rather than frozen here.
 */
const PLACEMENT_RULES: ReadonlyArray<
  (placement: Record<string, unknown>) => string | undefined
> = [
  p => (isUsableText(p.id) ? undefined : 'a placement needs a non-empty "id"'),
  p =>
    isUsableText(p.widgetId)
      ? undefined
      : 'a placement needs a non-empty "widgetId"',
  // `Number.isFinite`, not `typeof === "number"`: `NaN` and both infinities are
  // numbers that JSON cannot carry -- each serializes to `null` and comes back
  // failing this same rule, so accepting one here would write a row that could
  // never be read.
  p =>
    Number.isFinite(p.order) ? undefined : '"order" must be a finite number',
  p =>
    typeof p.hidden === "boolean" ? undefined : '"hidden" must be a boolean',
  p => optionalTextProblem(p.size, "size"),
  p => optionalTextProblem(p.height, "height"),
  p =>
    p.config === undefined || isPlainObject(p.config)
      ? undefined
      : '"config", when given, must be an object',
  p =>
    p.config !== undefined && exceedsDepth(p.config, MAX_CONFIG_DEPTH)
      ? `"config" may nest at most ${MAX_CONFIG_DEPTH} levels`
      : undefined,
];

/**
 * Whether a value nests deeper than `limit`.
 *
 * Iterative rather than recursive, deliberately: a recursive walk overflows the
 * stack on exactly the input this exists to reject, so the guard would fail the
 * same way the bug does. The traversal stops at the first violation, so a
 * pathological payload costs `limit` levels of work rather than all of them.
 */
function exceedsDepth(value: unknown, limit: number): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const { value: current, depth } = stack.pop() as {
      value: unknown;
      depth: number;
    };
    if (current === null || typeof current !== "object") continue;
    if (depth > limit) return true;
    for (const child of Array.isArray(current)
      ? current
      : Object.values(current)) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return false;
}

/**
 * Why this value cannot be a placement, or `undefined`.
 *
 * Exported so the endpoint that accepts a PUT and the reader that decodes a
 * stored row ask the identical question. They used to be able to disagree, and
 * a shape one accepted and the other refused is a row that can be written and
 * never read.
 */
export function placementProblem(value: unknown): string | undefined {
  if (!isPlainObject(value)) return "a placement must be an object";
  for (const rule of PLACEMENT_RULES) {
    const problem = rule(value);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** A placement, with only the fields this core stores, in a stable order. */
function toPlacement(value: Record<string, unknown>): WidgetPlacement {
  return {
    id: value.id as string,
    widgetId: value.widgetId as string,
    order: value.order as number,
    hidden: value.hidden as boolean,
    ...(value.size === undefined ? {} : { size: value.size as string }),
    ...(value.height === undefined ? {} : { height: value.height as string }),
    ...(value.config === undefined
      ? {}
      : { config: value.config as Record<string, unknown> }),
  };
}

/**
 * Reads the caller-or-column supplied placement array, or says why it cannot.
 *
 * Rebuilds each placement from the fields this core knows rather than passing
 * the decoded object through. A row round-tripped verbatim would carry back
 * whatever else was in it -- including, on a PUT, anything a client chose to
 * add -- and the next reader would have no way to tell core's vocabulary from
 * a stranger's.
 */
export function readPlacements(value: unknown): WidgetPlacement[] {
  if (!Array.isArray(value)) {
    throw NextlyError.invalidInput({
      message: 'Invalid dashboard layout: "placements" must be an array.',
    });
  }
  return value.map((entry, index) => {
    const problem = placementProblem(entry);
    if (problem !== undefined) {
      throw NextlyError.invalidInput({
        message: `Invalid dashboard layout: placements[${index}] ${problem}.`,
      });
    }
    return toPlacement(entry as Record<string, unknown>);
  });
}

/**
 * Decodes one stored `layout` column.
 *
 * THROWS on anything it cannot read, rather than quietly resetting to the
 * default. A server-persisted record vanishing with no signal is the worse
 * failure here: the reader would see their arrangement gone and nothing
 * anywhere would say why. The caller decides what to do with the throw -- the
 * service logs it and falls back so the dashboard still draws, and marks the
 * response as coming from the default so the admin never claims the row was
 * honoured.
 */
export function readStoredLayout(raw: string): StoredLayout {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw NextlyError.internal({
      ...(cause instanceof Error ? { cause } : {}),
      logContext: { reason: "stored dashboard layout is not valid JSON" },
    });
  }

  if (!isPlainObject(decoded)) {
    throw NextlyError.internal({
      logContext: { reason: "stored dashboard layout is not an object" },
    });
  }

  // The ONE vocabulary check in this module, and it is legitimate precisely
  // because this core wrote the value. A version above ours means the row came
  // from a NEWER core and holds fields we would silently drop on the next
  // write; a version below ours means a migrator is missing. Neither is a
  // shape to guess at. When v2 arrives this is where `migrateLayout` runs.
  if (decoded.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    throw NextlyError.internal({
      logContext: {
        reason: "stored dashboard layout names an unknown schema version",
        found: String(decoded.schemaVersion),
        expected: LAYOUT_SCHEMA_VERSION,
      },
    });
  }

  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    placements: readPlacements(decoded.placements),
  };
}

/** The payload written into the `layout` column. */
export function serializeLayout(
  placements: readonly WidgetPlacement[]
): string {
  return JSON.stringify({
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    placements,
  });
}

/**
 * The declared order, as the admin's own comparator reads it: a widget with no
 * `defaultOrder` sits after every widget that states one.
 *
 * `POSITIVE_INFINITY` rather than a large finite sentinel, because there is no
 * largest finite number a declaration could not legally name -- `Number.MAX_VALUE`
 * as the sentinel sorted a widget declaring it BELOW the unstated ones.
 * Two unstated widgets compare as `NaN`, which `Array.prototype.sort` treats as
 * "leave them alone", so they keep registration order.
 */
function byDeclaredOrder(a: WidgetDefinition, b: WidgetDefinition): number {
  return (
    (a.defaultOrder ?? Number.POSITIVE_INFINITY) -
    (b.defaultOrder ?? Number.POSITIVE_INFINITY)
  );
}

/**
 * What a reader who has never arranged anything sees.
 *
 * The declared order, MATERIALIZED into finite positions -- `defaultOrder`
 * itself is never copied into a placement, because `POSITIVE_INFINITY` is not
 * JSON and a widget's declaration may change under a stored row that quoted it.
 * The step leaves room to insert between two neighbours without renumbering.
 *
 * The placement id is the widget id here, and only here. It makes repeated
 * reads of an unsaved dashboard return identical ids, which is what lets the
 * admin treat the default set as real placements rather than as a preview it
 * has to re-key on every fetch.
 */
export function defaultPlacements(
  widgets: readonly WidgetDefinition[]
): WidgetPlacement[] {
  return [...widgets].sort(byDeclaredOrder).map((widget, index) => ({
    id: widget.id,
    widgetId: widget.id,
    order: index * DEFAULT_ORDER_STEP,
    hidden: false,
    // The declared geometry travels WITH the placement, rather than being left
    // for a reader to look up. A placement is a persisted arrangement, and an
    // arrangement that omits its own size is not one: the first save would
    // store a row with no `size`, so a later change to the plugin's
    // `defaultSize` would silently resize what the reader was told is their
    // saved layout. Copied as strings, because a newer plugin's value is a
    // shape this core has to survive rather than a vocabulary it can check.
    size: widget.defaultSize,
    ...(widget.defaultHeight === undefined
      ? {}
      : { height: widget.defaultHeight }),
  }));
}

/**
 * Splits a stored layout by what this reader is allowed to know exists.
 *
 * BOTH halves are returned, and the second one is the point. A placement whose
 * widget no longer resolves, or whose `requiredPermission` this caller lacks,
 * is dropped from the response -- never drawn as an empty slot, never drawn as
 * a "you may not see this" card, both of which disclose that it is there.
 *
 * 🔴 But it must not be dropped from the ROW. The wire contract is a whole
 * snapshot: the admin sends back what it was given. A caller who was shown a
 * filtered list and PUTs it back would otherwise DELETE every placement the
 * filter hid -- so a user opening the dashboard once, while a permission of
 * theirs was temporarily narrowed, would silently lose those cards forever.
 * The `invisible` half is what the writer merges back in, and it is why this is
 * one function returning two lists rather than a filter used twice.
 */
export function partitionPlacements(
  placements: readonly WidgetPlacement[],
  visibleWidgetIds: ReadonlySet<string>
): { visible: WidgetPlacement[]; invisible: WidgetPlacement[] } {
  const visible: WidgetPlacement[] = [];
  const invisible: WidgetPlacement[] = [];
  for (const placement of placements) {
    if (visibleWidgetIds.has(placement.widgetId)) visible.push(placement);
    else invisible.push(placement);
  }
  visible.sort((a, b) => a.order - b.order);
  return { visible, invisible };
}

/** A fresh, opaque placement id. Used when a copy of a widget is placed. */
export function newPlacementId(): string {
  return crypto.randomUUID();
}

/**
 * The array a write stores: what this caller submitted, plus what they were
 * never shown.
 *
 * 🔴 A carried placement whose id collides with a submitted one is RE-KEYED,
 * never refused. Refusing would answer differently depending on whether a
 * hidden placement happens to hold that id -- which is an oracle for the
 * existence of a card this caller is not allowed to know about, and hiding the
 * card was the entire point of filtering it. Re-keying is safe because a
 * placement id is opaque and everything hung off it, `config` included, travels
 * on the placement itself.
 *
 * Collisions are not expected: default ids are widget ids, and a submitted
 * placement can only name a VISIBLE widget while a carried one names a widget
 * this caller cannot see. It is guarded anyway because the ids a client may
 * mint are unconstrained, and the failure it prevents -- two placements sharing
 * an id in a stored row -- is one the next reader could not untangle.
 */
export function mergePreservingHidden(
  submitted: readonly WidgetPlacement[],
  invisible: readonly WidgetPlacement[]
): WidgetPlacement[] {
  const taken = new Set(submitted.map(placement => placement.id));
  const carried = invisible.map(placement => {
    if (!taken.has(placement.id)) {
      taken.add(placement.id);
      return placement;
    }
    let fresh = newPlacementId();
    while (taken.has(fresh)) fresh = newPlacementId();
    taken.add(fresh);
    return { ...placement, id: fresh };
  });
  return [...submitted, ...carried];
}

/**
 * How many placements one layout may hold, and how large its payload may be.
 *
 * MySQL's `TEXT` is 65535 BYTES, and the other two dialects are effectively
 * unbounded — so without a cap the same PUT stores cleanly on two dialects and,
 * on the third, either errors or (under a permissive `sql_mode`) TRUNCATES,
 * leaving JSON the next read cannot parse. That failure destroys the whole
 * saved dashboard, and it destroys it on one deployment only.
 *
 * The ceiling is on the SERIALIZED payload rather than on `config` alone,
 * because `config` is opaque to core — the widget owns its vocabulary — so
 * there is nothing here to measure except the bytes actually stored. 32 KiB is
 * half MySQL's limit, which leaves room for multi-byte characters to expand
 * without any caller ever meeting the dialect's own edge.
 */
export const MAX_PLACEMENTS = 200;
export const MAX_LAYOUT_BYTES = 32 * 1024;

/**
 * How deep a `config` object may nest.
 *
 * `JSON.parse` accepts a structure thousands of levels deep and
 * `JSON.stringify` throws `RangeError: Maximum call stack size exceeded` on the
 * same value, so a syntactically valid body under every byte and count limit
 * turned a write into an internal 500 on the way back out. Bounded here, where
 * it becomes an ordinary validation refusal naming the field.
 *
 * 16 is far past anything a widget's settings need and far short of a stack.
 */
export const MAX_CONFIG_DEPTH = 16;

/**
 * Why the caller's OWN submission cannot be stored, or `undefined`.
 *
 * 🔴 Measures only what the caller sent, and that scope is the point rather
 * than an omission. A budget that also weighed the placements carried back on
 * the caller's behalf would make ACCEPTANCE ITSELF depend on data the caller
 * cannot see — so a caller who had lost access to a widget could grow one
 * visible placement until the refusal appeared and read the boundary as the
 * size of configuration they are not allowed to see. Omitting the byte count
 * from the message does not fix that: the pass/fail edge is the oracle, not the
 * number.
 *
 * So there is no merged check at all. The stored column is `mediumtext` on the
 * narrowest dialect, which no accumulation of 200 placements built from
 * submissions this size can reach — the ceiling was removed rather than
 * policed, which is a boundary the system cannot cross instead of a check that
 * looks for crossings.
 */
export function layoutSizeProblem(
  placements: readonly WidgetPlacement[]
): string | undefined {
  if (placements.length > MAX_PLACEMENTS) {
    return `a layout may hold at most ${MAX_PLACEMENTS} placements`;
  }
  // Byte length, not string length: the column's limit is bytes, and a layout
  // of CJK or emoji `config` values is three to four times its own `.length`.
  const bytes = Buffer.byteLength(serializeLayout(placements), "utf8");
  if (bytes > MAX_LAYOUT_BYTES) {
    return `a layout may be at most ${MAX_LAYOUT_BYTES} bytes; this one is ${bytes}`;
  }
  return undefined;
}

/**
 * A short, stable stand-in for "which widgets this caller could see".
 *
 * 🔴 The row's `version` guards the ROW, and that is only half of what shaped
 * the snapshot the client is holding. The other half is VISIBILITY: a GET
 * returns placements filtered by what this caller may see, and a permission
 * grant, a role change or a plugin registering on another instance changes that
 * filter without touching the row. `version` therefore still matches, the
 * conditional write still succeeds, and a placement that was invisible at read
 * time but is visible at write time is in neither the client's submission nor
 * the carried-through set — so it is silently and permanently deleted, along
 * with its order and its `config`.
 *
 * Echoing this token back closes that. The client's snapshot is stale whenever
 * the visible set has moved under it, and stale is exactly what a conflict
 * means: re-read and try again.
 *
 * A hash rather than the id list itself, because the list is the one thing this
 * endpoint must never hand back — it names every widget the caller may see, and
 * comparing two tokens across two callers would otherwise reveal whether their
 * grants differ. Truncated to 16 base64url characters: this is a
 * change-detector between two reads by ONE caller, not a security boundary, and
 * a collision costs a preserved placement rather than a leaked one.
 */
export function visibilityToken(widgetIds: readonly string[]): string {
  return (
    createHash("sha256")
      // Sorted, so the token depends on the SET and not on registration order —
      // otherwise a hot reload that re-registered the same widgets in a different
      // order would refuse every write with nothing actually changed.
      .update([...widgetIds].sort().join("\n"))
      .digest("base64url")
      .slice(0, 16)
  );
}
