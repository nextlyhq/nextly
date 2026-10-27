/**
 * What a widget IS, as data the host can read without executing the plugin
 * that declared it.
 *
 * Validation lives at registration (the blocks-engine pattern): a malformed
 * definition fails at boot with a named error rather than rendering a broken
 * card later, when the declaration still looks correct.
 *
 * @module domains/widgets/definition
 */

import { NextlyError } from "../../errors/nextly-error";

import { requiredPermissionSlugs, type WidgetPermissionGate } from "./gate";
import {
  sizeDeclarationProblems,
  type WidgetSizeDeclaration,
} from "./grid-size";
import {
  lifecycleProblem,
  type WidgetCondition,
  type WidgetLifecycle,
} from "./lifecycle";
import type {
  SettingSourcedQuerySpec,
  WidgetQuery,
  WidgetQuerySpec,
} from "./query";
import {
  drivesQuery,
  isLimitSetting,
  settingsSourceOf,
  validateWidgetSettings,
  type AnyWidgetSetting,
} from "./settings";
import type { WidgetOp, WidgetSourceFilter } from "./sources";

/*
 * Re-exported from the contract's home so a caller reading a definition finds
 * the type of one of its fields in the same place, rather than having to know
 * which module the validation happens to live in.
 */
export type { WidgetSetting } from "./settings";

// The gate rule lives in a module with no imports so the BROWSER can read it
// too (`nextly/widget-gate`). Validation asks the same reader the gate asks,
// so a declaration this file admits is one the gate can actually use.

export {
  holdsWidgetPermission,
  requiredPermissionGroups,
  requiredPermissionSlugs,
  widgetGateHolds,
  type WidgetPermissionGate,
} from "./gate";

/**
 * How a widget renders. Every archetype but `custom` is drawn by core from the
 * query result, so it inherits the card anatomy, the loading and empty states,
 * the theme tokens and the accessibility work for free.
 */
export const WIDGET_ARCHETYPES = [
  "metric",
  // Several labelled, clickable numbers. Named "stats" rather than the obvious
  // "metrics", and the near-miss is the reason: `metric` and `metrics` differ by
  // one character, both are valid members of this union, and confusing them
  // draws ONE number where six were declared -- a card that looks finished and
  // answers a narrower question than it claims. A name that cannot be reached
  // by a typo from an existing one costs nothing and removes that.
  "stats",
  "table",
  "list",
  // A categorical comparison, drawn as bars. Named for the SHAPE rather than
  // for `groupBy`, the op behind it: an archetype is a way of drawing, and a
  // name taken from the query would have to change if the same picture were
  // ever drawn from a different one.
  "bars",
  // A count per interval, drawn as a line. This one DOES share its name with
  // its op, and that is not the near-miss `stats` avoids: `metric`/`metrics`
  // are two different pictures one keystroke apart, while an archetype and an
  // op called `timeseries` are the same idea named once.
  "timeseries",
  "text",
  "actions",
  "custom",
] as const;
export type WidgetArchetype = (typeof WIDGET_ARCHETYPES)[number];

/**
 * Archetypes whose content comes from a data query.
 *
 * Exported, and this is the reason: the contributions channel has to make the
 * same distinction, and it got it WRONG by restating it -- requiring a query
 * for every non-`custom` archetype, which made `text` and `actions` undeclarable
 * and contradicted the rule below for the same two names. One question, one
 * implementation; a narrower view is derived from this rather than computed
 * beside it.
 */
export const DATA_ARCHETYPES = [
  "metric",
  "table",
  "list",
  "bars",
  "timeseries",
] as const;

/**
 * Archetypes drawn from MANY queries, declared as `cells`.
 *
 * 🔴 A third vocabulary rather than a member of either existing one, because
 * both would be a lie in a way that reaches real code. `DATA_ARCHETYPES` means
 * "requires the singular `query` field", and a `stats` card declaring one would
 * be refused. `QUERYLESS_ARCHETYPES` means "requires no data at all" -- the
 * admin derives its `DeclaredBody` dispatch from it, the kind of body that
 * never enters the batch and waits for no slot -- and a `stats` card placed
 * there would be drawn from its declaration with its numbers never fetched.
 *
 * The two names have agreed until now because no archetype needed data without
 * using `query`. `stats` is the first, so it gets its own name rather than
 * being filed under whichever existing one is closer.
 */
export const CELL_ARCHETYPES = ["stats"] as const;

/** An archetype core draws from several query results. */
export type CellWidgetArchetype = (typeof CELL_ARCHETYPES)[number];

const CELL_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  CELL_ARCHETYPES
);

/** An archetype core draws from a query result. */
export type DataWidgetArchetype = (typeof DATA_ARCHETYPES)[number];

const DATA_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  DATA_ARCHETYPES
);

/**
 * The result each data archetype knows how to draw.
 *
 * Declared rather than left to the renderer, because the renderer discovers a
 * mismatch too late to say anything useful: a `metric` handed buckets returns
 * an "expected a count" body, so the card is drawn as an error on every load
 * while the declaration that caused it looks fine. Registration is where an
 * author can still be told which archetype takes which result.
 *
 * `custom` is deliberately absent. Its component receives the result whole and
 * decides what to draw, so constraining it here would be this file guessing at
 * a plugin's intent -- and the flexibility to draw something new from a new op
 * is the reason that archetype exists.
 */
export const ARCHETYPE_OPS = {
  metric: ["count"],
  table: ["list"],
  list: ["list"],
  bars: ["groupBy"],
  timeseries: ["timeseries"],
} as const satisfies Record<DataWidgetArchetype, readonly WidgetOp[]>;

/**
 * `ARCHETYPE_OPS` as the lookup registration reads.
 *
 * Built from the literal table above, which the typed widget declaration also
 * reads to pair a display with its data at compile time, so the two checks
 * cannot disagree about which archetype draws which op.
 */
const ARCHETYPE_RESULTS: ReadonlyMap<
  DataWidgetArchetype,
  ReadonlySet<WidgetOp>
> = new Map(
  DATA_ARCHETYPES.map(archetype => [
    archetype,
    new Set<WidgetOp>(ARCHETYPE_OPS[archetype]),
  ])
);

/**
 * How many numbers one `stats` card may declare.
 *
 * A bound rather than a style note. Each cell is its OWN count query, so a card
 * declaring thirty would consume the entire batch (`MAX_QUERIES_PER_REQUEST`)
 * and leave every other widget on the dashboard without a slot -- one card
 * silently darkening the rest of the page. Eight also happens to be past the
 * point a row of numbers can be read at a glance, which is what the card is
 * for, so the readable limit and the affordable one agree.
 */
export const MAX_STAT_CELLS = 8;

/**
 * One read a `custom` card asks beside its others, its answer handed to the
 * card's component under `key`.
 *
 * For a card that draws several answers together, such as a number beside the
 * trend it comes from: each read is batched, streamed and refused on its own,
 * so one the reader may not have is answered as not available while the rest
 * draw. Any query a card may ask, including one whose source the card's
 * Collection setting supplies.
 *
 * @experimental While the content widgets are being built.
 */
export interface WidgetQueryCell {
  /** Identifies this cell's answer within the card. Unique across the card. */
  key: string;
  query: WidgetQuerySpec | SettingSourcedQuerySpec;
  /**
   * Asked only for a card whose collection has (`"lifecycle"`) or has not
   * (`"no-lifecycle"`) a draft and published lifecycle, so a card reads a
   * status split where there is one and a plain count where there is not,
   * once either way. Absent, the cell is always asked.
   */
  when?: WidgetCellCondition;
  /**
   * The narrowest tier of the card that draws this cell: `"medium"` for a
   * cell a small card leaves out, `"large"` for one only a large card draws.
   * The admin asks only the cells the card's tier draws, and the rest once the
   * card widens to draw them. Absent, the cell is drawn, and asked, at every
   * tier.
   */
  drawnFrom?: WidgetCellTier;
}

/** The tiers a card is drawn at, narrowest first. @experimental */
export const WIDGET_CELL_TIERS = ["small", "medium", "large"] as const;

/** @experimental */
export type WidgetCellTier = (typeof WIDGET_CELL_TIERS)[number];

/** When a cell is asked: the closed set of conditions. @experimental */
export const WIDGET_CELL_CONDITIONS = ["lifecycle", "no-lifecycle"] as const;

/** @experimental */
export type WidgetCellCondition = (typeof WIDGET_CELL_CONDITIONS)[number];

/**
 * One number on a `stats` card.
 *
 * 🔴 Each cell carries its OWN query rather than the card carrying one query
 * that returns several numbers. The difference is access control: a cell is an
 * ordinary `count` against an ordinary source, so it is judged by the same rule
 * every other widget query is judged by, and a reader who may not read one of
 * the collections simply loses that number. A single composite query would need
 * a source that knows about every domain it counts -- and one authorization
 * decision covering all of them, which is the second implementation this domain
 * exists to avoid.
 *
 * `link` is per CELL, not per card. The point of the card is that every number
 * navigates: "14 drafts" goes to the drafts, not to the collection's front page.
 */
export interface WidgetStatCell {
  /** Identifies this cell's answer within the card. Unique across the card. */
  key: string;
  /** What the number is called, beneath it. */
  label: string;
  /**
   * 🔴 A COUNT, narrowed in the type and checked at registration. The card
   * draws one number per cell and refuses any other result shape, so a `list`
   * here would pass validation, reach the source, succeed, and then render a
   * muted dash forever -- a declaration mistake wearing the appearance of
   * unavailable data, which is the one reading nobody investigates.
   */
  /**
   * `groupBy?: never` alongside the op, because `groupBy` is optional on
   * `WidgetQuery`: the intersection pins the op and would still have accepted
   * a group key beside it, which the registration check does not look at and
   * the executor would drop.
   */
  /**
   * A count, with every key belonging to another op closed off.
   *
   * `groupBy`, `dateField` and `interval` are optional on `WidgetQuery` because
   * it stays flat, so without these a stats cell carrying one COMPILES and is
   * then refused by the endpoint on every load -- a permanently failed stat the
   * type could have caught. Each op-specific key is named rather than the type
   * being derived from a union member, because `keyof` over a union keeps only
   * the shared keys and would quietly stop demanding a position on new ones.
   */
  query: WidgetQuery & {
    op: "count";
    groupBy?: never;
    dateField?: never;
    interval?: never;
  };
  /** Where this number navigates. A cell without one draws as plain text. */
  link?: { label: string; href: string };
}

/**
 * One shortcut on an `actions` widget.
 *
 * `requiredPermission` gates the ITEM, not the card. A shortcut to something
 * the reader may not do is worse than no shortcut: it advertises a capability,
 * costs a click, and answers with a refusal screen. The card's own
 * `requiredPermission` decides whether the widget appears at all, which is a
 * different question -- a card of five shortcuts where the reader may use two
 * should show two, not disappear.
 *
 * `external` marks a destination outside the admin, which the renderer opens in
 * a new tab and marks for a screen reader. Declared rather than sniffed from
 * the href, because "is this my origin" is a question the browser answers
 * differently than the author meant -- a relative path served behind a proxy is
 * internal, and an absolute URL to the same host is still a full page load.
 */
export interface WidgetAction {
  label: string;
  href: string;
  /** Lucide icon name, resolved by the admin. */
  icon?: string;
  /** Hides this ITEM from a reader without the grant. */
  requiredPermission?: string;
  /** Opens in a new tab, and says so. */
  external?: boolean;
}

export interface WidgetDefinition {
  /** `namespace/name`, e.g. "core/recent-entries". */
  id: string;
  title: string;
  description?: string;
  /** Lucide icon name, resolved by the admin. */
  icon?: string;
  /** Groups the widget in the "add widget" picker. */
  category?: string;
  archetype: WidgetArchetype;
  /**
   * What a reader may change about THIS card, per placement.
   *
   * Declared as field configs so the admin draws them with the renderer it
   * already has and a plugin author needs no new vocabulary. The stored values
   * live on the placement, not here: this is the offer, and the placement is
   * one reader's answer to it.
   *
   * Any of the eight setting types. A content setting (a collection, and the
   * filter, sort and grouping over it) is admitted only where core builds the
   * query from it, `serverData`; see `widgetSettingsProblem`.
   */
  settings?: AnyWidgetSetting[];
  /**
   * How big a card of this widget is, in grid units: the size a new card
   * starts at, and the smallest and largest a reader may resize it to.
   *
   * 🔴 The only way a widget states its size. The minimum defaults to the
   * default and the maximum to the full width at the default's height, and
   * every reader fills them through `sizeBounds`, so the registry, the layout
   * and the admin agree about a declaration that leaves an end out.
   */
  size: WidgetSizeDeclaration;
  /** Whether one dashboard may hold more than one card of this widget. */
  allowsSeveral?: boolean;
  /**
   * Which of core's displays the add panel sketches this widget's row with,
   * when it is not its archetype: a widget drawn by its own component says
   * what it most looks like.
   */
  sketch?: DataWidgetArchetype;
  /**
   * What a declared widget's empty state says and offers in place of the
   * frame's own: one line, and one action, a path relative to the admin,
   * offered only to a reader holding its `requiredPermission`.
   *
   * 🔴 Published by core for a declared widget alone (with `serverData`), from
   * a declaration startup already held to the empty state's rules. Whether
   * the card is empty is decided on the server, so no test travels here.
   */
  empty?: {
    message?: string;
    action?: { label: string; link: string; requiredPermission?: string };
  };
  /**
   * The settings the widget's source narrows by rather than being replaced by
   * (`WidgetSource.filters`), so the admin's knobs build the card's query as
   * the server admits its settings.
   *
   * 🔴 Set by core when it publishes a registered widget, read from the source
   * registry then, and never taken from the registration: a stated value is
   * replaced, so a widget cannot claim a filter its source does not take.
   *
   * @experimental The shape may grow while the content widgets are built.
   */
  sourceFilters?: readonly WidgetSourceFilter[];
  /**
   * Where this widget sits by default, ascending. Omitted means "after
   * everything that states one".
   *
   * The DECLARED default, not the reader's own arrangement -- a stored layout
   * carries its own order per placement and wins over this. It exists because
   * position was otherwise an accident of which CHANNEL a widget arrived
   * through: the resolver reads contributions before registrations, so a card
   * moved across the grid when its author switched from one to the other
   * without changing anything about the card.
   *
   * A number rather than an index, so inserting between two neighbours does not
   * renumber them. Any finite value is legal, negatives and fractions included.
   */
  defaultOrder?: number;
  /**
   * How long this widget stays on the dashboard. Defaults to `"always"`.
   *
   * A `conditional` widget is transient: it shows only while `visibleWhen`
   * holds, and is neither placed nor offered otherwise. Declaring it here
   * rather than deciding in the component is what stops the grid reserving a
   * slot, and an order, for a card that renders nothing.
   */
  lifecycle?: WidgetLifecycle;
  /**
   * The named condition this widget shows under. Required when conditional.
   *
   * A NAME the host evaluates, never a predicate the widget supplies. The
   * closed set lives in `lifecycle.ts` with the reasoning; the short version is
   * that a vocabulary cannot be spammed and an arbitrary hook can.
   */
  visibleWhen?: WidgetCondition | readonly WidgetCondition[];
  /**
   * Whether a reader may send this card away themselves.
   *
   * 🔴 Dismissal is HIDING, not deleting, and deliberately so: the placement
   * stays in the reader's layout marked hidden, which is what lets them put it
   * back from the same panel every other hidden card is restored from. A
   * separate "dismissed" store would be a second way to make a card disappear,
   * and the reader would have two places to look for it.
   *
   * Independent of {@link WidgetDefinition.lifecycle}. A CONDITIONAL card stops
   * being offered when its condition lapses, which is the install's decision; a
   * DISMISSIBLE one can be sent away while the condition still holds, which is
   * the reader's. An onboarding checklist wants both -- it goes when the work is
   * done, and a reader who does not want it now should not have to finish the
   * work to be rid of it.
   */
  dismissible?: boolean;
  /**
   * Whether the dashboard takes this widget's card out of the grid while its
   * answer is empty, rather than drawing the empty state. Judged after the
   * answer arrives; a card that failed, or whose source is not available to
   * the reader, is never hidden. Customise mode still shows it, marked.
   *
   * @experimental
   */
  hidesWhenEmpty?: boolean;
  /**
   * Whether the host sizes this `custom` widget's list query to the card, as it
   * sizes the lists it draws itself: it asks the rows the card's size draws, at
   * most the reader's "Number of items", and one more, the row that says more
   * exist.
   *
   * Only for a `custom` widget whose query is a `list`. Unstated, a custom
   * widget is asked exactly its declared query, because its component draws the
   * raw answer and would draw the extra row as an ordinary one. A component that
   * opts in draws `rowsDrawn(tier, query.limit)` rows of the answer and says
   * more exist when the answer holds more, from the `query` it is handed.
   *
   * @experimental The shape may change while custom cards adopt the host's
   * sizing.
   */
  sizedQuery?: boolean;
  /**
   * Gates whether the CARD renders. It does NOT constrain the rows the query
   * returns -- that is `execute`'s job, and it is not optional there.
   *
   * A `PermissionSlug` spelling (`read-posts`), the same vocabulary
   * `WidgetSource.requiredPermission` and `PluginAdminWidget` carry.
   *
   * 🔴 An ARRAY means ANY-OF, and it exists because a single slug cannot
   * describe the rule the services behind these cards actually apply. Release
   * authority is the worked example: `ReleasesService.authorize` treats `create`
   * or `publish` as satisfying `read` -- deliberately, so a role granted only
   * `create` can see the release it just made -- and the admin's
   * `canViewReleases` capability lists all three. A card gated on the read slug
   * alone is a THIRD encoding of that rule and the only one that disagrees, so
   * the reader can open the releases screen and never see its dashboard card.
   *
   * Any-of rather than all-of because that is the shape every consumer of this
   * vocabulary already has -- `requireAnyPermission` at the route layer, the
   * capability lists in the admin. A card that needs several grants together
   * says so with the separate `{ allOf }` form (@experimental), whose entries
   * are slugs or any-of arrays: the Team card needs a reader who may read people
   * AND may add or change them. An array never means all-of, so no declaration
   * reads two ways.
   *
   * `WidgetAction.requiredPermission` stays a single slug. It gates one
   * shortcut rather than a card, and nothing has asked it for more.
   */
  requiredPermission?: WidgetPermissionGate;
  /**
   * Required for every data archetype unless `serverData` is set; forbidden
   * for `text` and `actions`.
   *
   * Typed as {@link WidgetQuerySpec} so a declaration pairing `groupBy` with an
   * op that ignores it, or a `groupBy` op carrying no key, fails to compile
   * rather than booting and failing on every request the card makes.
   *
   * A widget with a Collection setting declares no source
   * ({@link SettingSourcedQuerySpec}): each card reads the collection it is
   * set to.
   */
  query?: WidgetQuerySpec | SettingSourcedQuerySpec;
  /**
   * Where the add panel offers this widget, when not as one card for the
   * whole dashboard.
   *
   * - Absent: placed on the default dashboard, and offered as one card.
   * - `"per-collection"`: offered only inside each collection's group of the
   *   add panel, one row per collection, a card starting with that collection
   *   as its Collection setting.
   * - `"on-request"`: offered only from the add panel, as a card a reader asks
   *   for, such as a note; nothing to show until they set it up.
   *
   * Either value keeps the widget off the default dashboard and allows any
   * number of cards, unless it says otherwise (`allowsSeveral`). One fact, so
   * the placement, the panel and the count cannot disagree.
   *
   * @experimental While the content widgets are being built.
   */
  offered?: "per-collection" | "on-request";
  /**
   * The card's data is built on the server from the widget's declaration (a
   * data function, or a query written from its settings), so the definition
   * carries no query of its own and the browser never holds the code that
   * builds one.
   *
   * 🔴 Set by core when it publishes a declared widget, never by hand: the
   * public registration doors refuse it, because a definition claiming its
   * data is built on the server, with no declaration to build it from, is a
   * card that can never be answered.
   */
  serverData?: true;
  /** Required for `custom`; forbidden otherwise. */
  component?: string;
  /** Required for `actions`; forbidden otherwise. */
  actions?: WidgetAction[];
  /**
   * Required for `text`; forbidden otherwise.
   *
   * Markdown, drawn by the host. It ships inside every layout response to
   * every reader the card is offered to, which is why {@link MAX_TEXT_CONTENT}
   * bounds it at registration rather than letting a card carry a document.
   */
  content?: string;
  /**
   * Required for `stats`; optional for `custom`, whose component is handed
   * each cell's answer by key ({@link WidgetQueryCell}); forbidden otherwise.
   */
  cells?: WidgetStatCell[] | WidgetQueryCell[];
  /** Where a "view all" footer link points. */
  link?: { label: string; href: string };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

// A malformed widget definition is a plugin author's mistake, not end-user
// input, so this uses `invalidInput` (message is developer-facing and safe to
// surface verbatim) rather than `validation` (structured, user-facing errors).
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget definition: ${message}`,
  });
}

/** Confirms `id` is present and shaped as `namespace/name`. */
/**
 * Whether `id` is a widget id this registry would accept.
 *
 * Exported so a caller that DERIVES an id can ask before minting one, rather
 * than restating the pattern. The dashboard generates a card per collection, and
 * a slug that cannot produce a valid id has to be skipped — a second copy of
 * this rule there would accept ids the registry refuses, or refuse ids it
 * accepts, and either way the two would drift apart silently.
 */
export function isValidWidgetId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function validateId(d: Partial<WidgetDefinition>): void {
  if (!isValidWidgetId(d.id)) {
    fail(
      `id must be namespace/name in lowercase slug form, got ${String(d.id)}`
    );
  }
}

/** Confirms `title` carries real, non-whitespace text. */
/**
 * Why a widget's field VALUES are unusable, or `undefined`.
 *
 * The rules that hold identically whichever channel a widget arrives by, in one
 * place because they kept being written in two. Four fields have already
 * drifted this way -- the shortcut rule, the queryless no-query rule,
 * `defaultOrder` and `chrome` -- each added to one validator, missed by the
 * other, and each time the contributed side was the more permissive, which is
 * the direction that ships.
 *
 * SHAPE is deliberately not here, because the two channels genuinely disagree
 * about it: a contribution may omit `title` and `size`, which resolution
 * fills in, while a `WidgetDefinition` is the resolved widget and requires
 * both. Those differences belong to their own validators and are listed by name
 * in `plugins/__tests__/channel-divergence.test.ts`. What is here is only what
 * neither channel has a reason to read differently.
 *
 * Takes a loose record rather than a `Partial<WidgetDefinition>`, so a decoded
 * JSON object can ask it without either side casting to the other's shape.
 */
/**
 * How this core should treat a declaration's `archetype`.
 *
 * FOUR states, not two. Gating rules on "is it a string this core knows" folded
 * the other three together and each one leaked a defect: an ABSENT archetype
 * became `custom` during resolution but skipped every rule that names one; a
 * NON-STRING skipped them too and reached the admin, which interpolates it into
 * a diagnostic; and an UNKNOWN string was exempted from shape rules when the
 * exemption it earns is only from vocabulary ones.
 */
type ArchetypeStanding =
  /** Not supplied. Resolution deterministically fills in `custom`. */
  | { kind: "resolved-custom" }
  /** A name this core knows, so every rule about it applies. */
  | { kind: "known"; name: WidgetArchetype }
  /** A name from a newer core. Exempt from VOCABULARY rules, not from shape. */
  | { kind: "newer" }
  /** Not a string at all, which no version of this contract permits. */
  | { kind: "invalid" };

/**
 * Why this widget cannot ask the host to size its query, or `undefined`.
 *
 * A BOOLEAN in every version, so anything else is a mistake rather than version
 * skew. Only a `custom` widget may ask, since core already sizes the lists it
 * draws, and only for a `list` query, the one kind with rows to size: asked of
 * anything else it would be a validated option that changes nothing. Asked of
 * the archetype only where this core knows it (`archetypeStanding`), so a
 * newer core's archetype is not judged here.
 */
function sizedQueryProblem(
  widget: Record<string, unknown>
): string | undefined {
  const sized = widget.sizedQuery;
  if (sized === undefined) return undefined;
  if (typeof sized !== "boolean") {
    return "sizedQuery, when given, must be a boolean";
  }
  if (!sized) return undefined;
  const standing = archetypeStanding(widget.archetype);
  if (standing.kind === "known" && standing.name !== "custom") {
    return `sizedQuery is only valid for archetype "custom", not "${standing.name}" -- core already sizes the lists it draws`;
  }
  const query = widget.query as { op?: unknown } | undefined;
  if (query?.op !== "list") {
    return "sizedQuery needs a list query: only a list has rows to size";
  }
  return undefined;
}

function archetypeStanding(value: unknown): ArchetypeStanding {
  if (value === undefined) return { kind: "resolved-custom" };
  if (typeof value !== "string") return { kind: "invalid" };
  return WIDGET_ARCHETYPES.includes(value as WidgetArchetype)
    ? { kind: "known", name: value as WidgetArchetype }
    : { kind: "newer" };
}

/** The fields read as booleans, which a truthy non-boolean must not stand in for. */
const BOOLEAN_FIELDS = ["dismissible", "hidesWhenEmpty"] as const;

/**
 * Why a widget's title, frame or boolean fields are unusable, or `undefined`.
 *
 * A title is a STRING in every version, so this is not a vocabulary rule. Blank is permitted
 * deliberately -- `resolveTitle` trims it and falls back to the widget id -- but a non-string is a
 * different case: that helper calls `.trim()` on the value, so a number or object throws and takes
 * widget resolution down rather than rendering a differently-named card.
 *
 * The booleans are BOOLEANS in every version: there is no vocabulary here that a newer core could
 * extend, so anything else is a mistake rather than version skew. Each decides whether the admin
 * hides a card, and the admin copies a registration's fields verbatim, so a truthy non-boolean
 * such as `dismissible: "false"` would act on a card whose author declared the opposite. Refusing
 * the declaration is the only place that mistake is visible to the person who made it.
 */
function presentationProblem(
  widget: Record<string, unknown>
): string | undefined {
  if (widget.title !== undefined && typeof widget.title !== "string") {
    return "title, when given, must be a string";
  }
  const framed = chromeFieldProblem(widget);
  if (framed !== undefined) return framed;
  const field = BOOLEAN_FIELDS.find(
    name => widget[name] !== undefined && typeof widget[name] !== "boolean"
  );
  return field === undefined
    ? undefined
    : `${field}, when given, must be a boolean`;
}

/**
 * Why a widget's stated size cannot be used, or `undefined`.
 *
 * The same rule on both declaration channels, through the grid size module's
 * one check: a size is whole grid units in every version, so there is no
 * newer vocabulary for a contribution to be excused for. A default outside its
 * own bounds is refused rather than drawn, since a card that starts at a size
 * its reader may not return it to has bounds that mean nothing. Only a stated
 * size is judged here; whether one is required is each channel's own rule.
 */
function sizeProblem(widget: Record<string, unknown>): string | undefined {
  if (widget.size === undefined) return undefined;
  const problems = sizeDeclarationProblems(widget.size);
  return problems.length === 0 ? undefined : problems.join("; ");
}

export function widgetValueProblem(
  widget: Record<string, unknown>
): string | undefined {
  const presented = presentationProblem(widget);
  if (presented !== undefined) return presented;

  const sized = sizedQueryProblem(widget);
  if (sized !== undefined) return sized;

  const size = sizeProblem(widget);
  if (size !== undefined) return size;

  // Asked HERE rather than in the registration validator, because both channels
  // must answer it the same way. Left on the registration side, a plugin using
  // the contributed channel could declare a lifecycle nothing validated: the
  // summary carried the fields through and the layout server treated the card
  // as permanent, so a transient card shipped by the documented route would
  // simply never lapse -- and the author would have no refusal to read.
  const lifecycle = lifecycleProblem(widget);
  if (lifecycle !== undefined) return lifecycle;

  // A permission slug is a STRING in every version -- a newer core may mint new
  // slugs, but it cannot make a slug stop being a string -- so this is shape
  // rather than vocabulary, and it is shared by both channels. The field was
  // declared and never checked, and the gap failed OPEN: the dashboard's server
  // filter reads "not a string" as "no permission declared", so a widget whose
  // author wrote `requiredPermission: { read: true }` was gated for nobody and
  // returned to every authenticated caller. Refusing the declaration is the
  // only place the mistake is still visible to the person who made it.
  //
  // Asked through the same reader the GATE uses, rather than by restating the
  // shape here. Widening this to accept an any-of array added a second way for
  // a declaration to be unusable -- an empty array, or one member that is not a
  // slug -- and a validator that admitted a form the gate then refuses would
  // hide a card with no error anywhere.
  if (
    widget.requiredPermission !== undefined &&
    requiredPermissionSlugs(widget.requiredPermission) === undefined
  ) {
    return "requiredPermission, when given, must be a permission slug, a non-empty array of them, or { allOf: [...] } whose entries are each a slug or a non-empty array of slugs";
  }

  // A query is an OBJECT in every version, so it belongs here rather than
  // beside the body checks. There it was reachable only when the query had to
  // establish a body, so a widget shipping a component skipped it -- and the
  // admin put the malformed value in the batched request regardless.
  if (
    widget.query !== undefined &&
    (typeof widget.query !== "object" || widget.query === null)
  ) {
    return "query must be an object";
  }

  return archetypeRelatedProblem(widget);
}

/**
 * The rules that depend on what the archetype is, per its standing.
 *
 * The split that matters: a newer core's archetype is exempt from VOCABULARY
 * rules -- this core cannot judge where its payload belongs -- but not from
 * SHAPE. `resolveOne` calls `readableActions` for every archetype whatever its
 * name, and that immediately calls `.filter`, so a non-array `actions` throws
 * during resolution and takes the whole grid down before the unknown-card
 * fallback can draw. Container shape is version-independent; placement is not,
 * and the two live in their own functions below so that each reads as the one
 * rule it is.
 */
function archetypeRelatedProblem(
  widget: Record<string, unknown>
): string | undefined {
  const standing = archetypeStanding(widget.archetype);

  if (standing.kind === "invalid") {
    return "archetype, when given, must be a string";
  }

  // Shape first, and for every standing including a newer core's.
  const shapeProblem = payloadShapeProblem(widget);
  if (shapeProblem !== undefined) return shapeProblem;

  // Placement is a vocabulary judgement, so a newer core's archetype is exempt.
  // An ABSENT one is not: resolution supplies `custom`, which is a name this
  // core knows perfectly well, so the rule applies as it would to any other.
  if (standing.kind === "newer") return undefined;
  const effective =
    standing.kind === "resolved-custom" ? "custom" : standing.name;
  return payloadPlacementProblem(widget, effective);
}

/**
 * Why an archetype's payload is the wrong SHAPE, or `undefined` -- one level
 * in, not just the container.
 *
 * `readableActions` runs for every archetype and reads
 * `action.requiredPermission` off each item, so a `null` or `undefined` entry
 * throws exactly as a non-array `actions` does. A newer core may add FIELDS to
 * an action; it cannot make an action stop being an object, nor `content` stop
 * being a string, so these hold for every standing while "must have a label
 * and href" does not.
 */
function payloadShapeProblem(
  widget: Record<string, unknown>
): string | undefined {
  if (widget.actions !== undefined) {
    if (!Array.isArray(widget.actions)) {
      return "actions, when given, must be an array";
    }
    const badIndex = widget.actions.findIndex(
      action => typeof action !== "object" || action === null
    );
    if (badIndex !== -1) {
      return `actions[${badIndex}] must be an object`;
    }
  }
  if (widget.content !== undefined && typeof widget.content !== "string") {
    return "content, when given, must be a string";
  }
  return undefined;
}

/**
 * Why a payload sits on an archetype it does not belong to, or `undefined`.
 *
 * A vocabulary judgement: which field each archetype carries is a fact about
 * THIS core's names, which is why the caller never asks it of a newer core's.
 */
function payloadPlacementProblem(
  widget: Record<string, unknown>,
  archetype: string
): string | undefined {
  if (widget.actions !== undefined && archetype !== "actions") {
    return 'actions are only valid for archetype "actions"';
  }
  if (widget.content !== undefined && archetype !== "text") {
    return 'content is only valid for archetype "text"';
  }
  return undefined;
}

function validateTitle(d: Partial<WidgetDefinition>): void {
  // Channel-specific, and deliberately not shared. This is the RESOLVED widget,
  // so a blank title is a card labelled with whitespace. A contribution is a
  // declaration: `resolveTitle` trims it and falls back to the id, so the same
  // value renders a correctly named card there and refusing it would turn a
  // working card into a failed plugin install.
  // REQUIRED and non-blank here, because this is the RESOLVED widget and a
  // blank title is a card labelled with whitespace. That a supplied value is a
  // string is the shared rule's, since it holds on both sides.
  if (
    d.title === undefined ||
    (typeof d.title === "string" && d.title.trim() === "")
  ) {
    fail(`${d.id}: title is required`);
  }
}

/** Confirms `archetype` is one of the known values. */
function validateArchetype(d: Partial<WidgetDefinition>): void {
  if (!WIDGET_ARCHETYPES.includes(d.archetype as WidgetArchetype)) {
    fail(`${d.id}: archetype must be one of ${WIDGET_ARCHETYPES.join(", ")}`);
  }
}

/**
 * Confirms the widget states a size.
 *
 * Registry-only: this is the resolved widget, and a card with no size has
 * nowhere on the grid to start. A contribution may leave it out, and its
 * summary reads that as the default every reader shares. What a stated size
 * must be is the shared rule's (`sizeProblem`), asked before this.
 */
function validateSize(d: Partial<WidgetDefinition>): void {
  if (d.size === undefined) {
    fail(`${d.id}: size is required, as { default: { w, h }, min?, max? }`);
  }
}

/**
 * Confirms `component` is present exactly when the archetype requires it, and
 * that what is present can actually resolve.
 *
 * A `typeof` check alone accepts `""` and `"   "`, so the archetype that
 * REQUIRES a component registered without a usable one -- the broken card
 * requiring the field exists to prevent, arriving through the check meant to
 * prevent it. Trimmed rather than merely length-checked, because a path made of
 * spaces resolves no better than an empty one.
 */
function validateComponent(d: Partial<WidgetDefinition>): void {
  const isCustom = d.archetype === "custom";
  if (
    isCustom &&
    (typeof d.component !== "string" || d.component.trim() === "")
  ) {
    fail(`${d.id}: archetype "custom" requires a component path`);
  }
  if (!isCustom && d.component !== undefined) {
    fail(`${d.id}: component is only valid for archetype "custom"`);
  }
}

/**
 * Confirms `query` is present exactly where the archetype calls for one.
 *
 * BOTH directions, the way `validateComponent` above checks both. The
 * interface says "Required for every data archetype; forbidden for `text` and
 * `actions`", and enforcing only the first half let a `text` widget carry a
 * query its renderer never asks for -- accepted at registration and silently
 * inert afterwards, which is the class of mistake this validator exists to
 * catch at boot.
 *
 * `custom` is in neither set on purpose: it draws itself and may legitimately
 * want core to run its query, so the forbidden set is NAMED rather than
 * derived as "everything that is not a data archetype".
 */
/**
 * Archetypes core draws with NO query at all, exported for the same reason as
 * `DATA_ARCHETYPES` above.
 */
export const QUERYLESS_ARCHETYPES = ["text", "actions"] as const;

/** An archetype core draws without asking for data. */
export type QuerylessWidgetArchetype = (typeof QUERYLESS_ARCHETYPES)[number];

const QUERYLESS_ARCHETYPE_SET: ReadonlySet<WidgetArchetype> = new Set(
  QUERYLESS_ARCHETYPES
);

/**
 * Any archetype belonging to none of the four groups.
 *
 * `custom` is drawn by the plugin; the other three are drawn by core -- from one
 * query, from many (`cells`), and from none. Adding a name to `WIDGET_ARCHETYPES` and forgetting to
 * classify it would otherwise leave it silently outside every rule below --
 * accepted with or without a query, and undeclarable through the contributions
 * union that derives from these names.
 *
 * Asserted to be `never` in `__tests__/archetype-classification.test-d.ts`,
 * where this repo keeps its compile-time assertions, so adding an unclassified
 * archetype fails the typecheck naming it.
 */
export type UnclassifiedArchetype = Exclude<
  WidgetArchetype,
  | DataWidgetArchetype
  | QuerylessWidgetArchetype
  | CellWidgetArchetype
  | "custom"
>;

/**
 * An `actions` widget is its list of shortcuts, so it must have one.
 *
 * Both directions, the same reading `validateComponent` takes: an `actions`
 * widget without them describes an empty card, and any other archetype carrying
 * them describes shortcuts nothing will draw -- accepted at every layer,
 * rendering nothing, reporting nothing.
 *
 * Each item is checked for the two fields that make it a link. A label is what
 * the reader clicks and an href is where it goes; neither has a sensible
 * default, and a blank one is a shortcut that looks broken rather than absent.
 */
function validateActions(d: Partial<WidgetDefinition>): void {
  const isActions = d.archetype === "actions";

  // The misplacement case is the shared rule's; what is left here is the
  // requirement that an `actions` widget actually carries some.
  if (!isActions) return;

  if (!Array.isArray(d.actions) || d.actions.length === 0) {
    fail(`${d.id}: archetype "actions" requires a non-empty actions array`);
  }

  d.actions.forEach((action, index) =>
    validateAction(action, `${d.id}: action #${index}`)
  );
}

/**
 * The most markdown a `text` widget may carry.
 *
 * Generous for notes and a runbook link, and a bound nonetheless: the content
 * travels inside every layout response to every reader offered the card, so a
 * declaration is not the place for a document. REFUSED over the cap rather
 * than cut, because a bound that silently truncates is a bound nobody notices
 * until the prose ends mid-sentence.
 */
export const MAX_TEXT_CONTENT = 10_000;

/**
 * Why a `text` widget's prose cannot be drawn, or `undefined`.
 *
 * Exported so the contributions channel applies the SAME rule the registry
 * does -- one contract, two channels, one rule, the way `actionProblem` is
 * shared. A `text` widget IS its prose, so blank content describes an empty
 * card; the bound is explained on {@link MAX_TEXT_CONTENT}.
 */
export function textContentProblem(content: unknown): string | undefined {
  if (typeof content !== "string" || content.trim() === "") {
    return 'archetype "text" requires non-empty content';
  }
  if (content.length > MAX_TEXT_CONTENT) {
    return `content is ${content.length} characters; the most a text widget may carry is ${MAX_TEXT_CONTENT}`;
  }
  return undefined;
}

/**
 * A `text` widget is its prose, so it must have some -- and not too much.
 *
 * The misplacement case is the shared rule's, as for `actions`.
 */
function validateText(d: Partial<WidgetDefinition>): void {
  if (d.archetype !== "text") return;
  const problem = textContentProblem(d.content);
  if (problem) fail(`${d.id}: ${problem}`);
}

/**
 * One shortcut, checked for the two fields that make it a link.
 *
 * Separate from the archetype rule above because they are different questions:
 * whether this widget should have actions at all, and whether a given action is
 * usable. A label is what the reader clicks and an href is where it goes;
 * neither has a sensible default, and a blank one is a shortcut that looks
 * broken rather than absent.
 */
function validateAction(action: WidgetAction | undefined, at: string): void {
  const problem = actionProblem(action);
  if (problem) fail(`${at} ${problem}`);
}

/**
 * What is wrong with one shortcut, or `undefined` when nothing is.
 *
 * A PREDICATE beside the throwing check, because both channels into the grid
 * need this rule and only one of them throws. `assertAdminWidgets` refuses a
 * contributed widget with its own error shape and its own message, so it cannot
 * call `validateAction` -- and restating the rule there is how the two came to
 * disagree: the registry rejected a blank label while a contributed
 * `actions: [{}]` was published and drew a link with an undefined destination.
 */
export function actionProblem(action: unknown): string | undefined {
  const candidate = action as Partial<WidgetAction> | null | undefined;
  if (typeof candidate?.label !== "string" || candidate.label.trim() === "") {
    return "requires a non-empty label";
  }
  if (typeof candidate.href !== "string" || candidate.href.trim() === "") {
    return "requires a non-empty href";
  }
  return undefined;
}

/**
 * Why a queryless archetype may not carry this `query`, or `undefined`.
 *
 * The non-throwing half of a rule {@link validateQuery} also enforces, exported
 * for the same reason {@link actionProblem} is: the CONTRIBUTIONS channel needs
 * the identical answer without a throw, and one rule spelled twice is exactly
 * how the two channels came to disagree. The registry refused a query on an
 * `actions` widget while a contributed one carrying the same query passed boot
 * -- and since core draws `actions` from the declaration, the admin then issued
 * a batched read on every mount and refetch whose result the declared renderer
 * never looks at.
 *
 * Takes the two values rather than a definition, so both a validated
 * `WidgetDefinition` and a decoded JSON object can ask it without either side
 * casting to the other's shape.
 */
export function querylessQueryProblem(
  archetype: unknown,
  query: unknown
): string | undefined {
  if (typeof archetype !== "string") return undefined;
  if (!QUERYLESS_ARCHETYPE_SET.has(archetype as WidgetArchetype)) {
    return undefined;
  }
  if (query === undefined) return undefined;
  return `query is only valid for a data archetype or "custom", not "${archetype}"`;
}

/**
 * `defaultOrder`, when stated, must be a finite number.
 *
 * `Number.isFinite` rather than a `typeof` check alone, and it is reachable
 * rather than defensive: `1e400` is valid JSON that parses to `Infinity`, so a
 * decoded plugin manifest can carry one without any code having written it. An
 * infinite sort key cannot be diagnosed from the grid -- it pins the card to one
 * end and compares equal to every other infinity, so two of them order
 * arbitrarily against each other.
 */
/**
 * Why a declaration that still names `chrome` is refused, or `undefined`.
 *
 * Every card is drawn in the dashboard's one frame, which draws its header and
 * every state; no widget may decline it. A declaration naming the field is
 * refused rather than ignored, so a plain-JavaScript author who wrote it learns
 * at startup that their card will be framed, rather than from the dashboard.
 * Exported, so the contributions channel asks the same question.
 */
export function chromeFieldProblem(widget: object): string | undefined {
  return Object.hasOwn(widget, "chrome")
    ? "chrome is not a widget field: every card is drawn in the dashboard's frame"
    : undefined;
}

/**
 * Why this value cannot serve as a `defaultOrder`, or `undefined`.
 *
 * Non-throwing and exported for the same reason {@link actionProblem} and
 * {@link querylessQueryProblem} are: the CONTRIBUTIONS channel needs the same
 * answer without a throw. That channel had no order check at all, so a
 * JavaScript plugin could publish `defaultOrder: "soon"`, and the admin's
 * comparator turned it into `NaN` -- which compares false against everything,
 * so the widget sorted as equal to whatever it met and every explicit order
 * around it stopped meaning anything. Silently, and only sometimes, depending
 * on the order the array happened to arrive in.
 *
 * `Number.isFinite` rather than a `typeof` check alone, and it is reachable
 * rather than defensive: `1e400` is valid JSON that parses to `Infinity`, so a
 * decoded manifest carries one without any code having written it. The sort
 * uses infinity as its "stated nothing" sentinel, so an infinite ORDER would
 * tie with every widget that declared none.
 */
export function defaultOrderProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "defaultOrder must be a finite number";
  }
  return undefined;
}

function validateDefaultOrder(d: Partial<WidgetDefinition>): void {
  const problem = defaultOrderProblem(d.defaultOrder);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

/**
 * Confirms one cell of a `stats` card is usable, or names what is wrong.
 *
 * Every condition is a refusal rather than a fallback, for the reason the
 * source validator gives about its own fields: a card is registered ONCE and
 * read by every reader, so a malformed cell that is tolerated here becomes a
 * number that is blank, mislabelled or unclickable on every dashboard, arriving
 * per reader rather than at the point the mistake was made.
 */
/** Confirms one named part of a cell carries real, non-whitespace text. */
function blankCellText(
  value: unknown,
  at: string,
  field: string
): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return undefined;
  return `${at} requires a non-empty ${field}`;
}

/**
 * Confirms a cell's query is a count.
 *
 * Its own check, and its own reason: a missing query means there is no number
 * to draw at all, while a `list` one means the card asks for something it
 * refuses on arrival -- a declaration mistake that renders as unavailable data.
 */
function cellQueryProblem(query: unknown, at: string): string | undefined {
  if (typeof query !== "object" || query === null) {
    return `${at} requires a query object`;
  }
  // Checked at RUNTIME as well as in the type, for the callers a type does not
  // bind: a plugin compiled separately, JavaScript, and a cast.
  if ((query as WidgetQuery).op !== "count") {
    return `${at} must be a "count" query, because a stats cell draws one number`;
  }
  // A key belonging to another op is refused rather than ignored. Carried
  // alongside `count` it would pass registration, be refused by the dashboard
  // endpoint on every load, and leave a permanently failed stat -- with nothing
  // pointing at the declaration that caused it.
  //
  // Named as a list rather than derived from a type, because this exists for
  // the callers a type does not reach; the type beside it closes the same keys
  // for the callers it does.
  const foreign = (["groupBy", "dateField", "interval"] as const).filter(
    key => (query as Record<string, unknown>)[key] !== undefined
  );
  if (foreign.length > 0) {
    return `${at} is a "count" query and cannot carry ${foreign.join(", ")}`;
  }
  return undefined;
}

/**
 * Confirms a cell's optional link, when it has one, can actually be followed.
 *
 * A blank or non-string `href` reaches the admin's `Link`, whose
 * external-destination check calls `href.startsWith` -- so activating the number
 * throws instead of navigating, and the card that exists to navigate is the one
 * place that breaks. Refused here, where the mistake was made.
 */
function cellLinkProblem(
  link: WidgetStatCell["link"],
  at: string
): string | undefined {
  if (link === undefined) return undefined;
  if (typeof link !== "object" || link === null) {
    return `${at} link, when given, must be an object`;
  }
  return (
    blankCellText(link.label, `${at} link`, "label") ??
    blankCellText(link.href, `${at} link`, "href")
  );
}

export function statCellProblem(cell: unknown, at: string): string | undefined {
  if (typeof cell !== "object" || cell === null) {
    return `${at} must be an object`;
  }
  const c = cell as Partial<WidgetStatCell>;
  return (
    blankCellText(c.key, at, "key") ??
    blankCellText(c.label, at, "label") ??
    cellQueryProblem(c.query, at) ??
    cellLinkProblem(c.link, at)
  );
}

/**
 * Everything wrong with a `cells` list, or `undefined`.
 *
 * 🔴 Exported so the CONTRIBUTIONS channel asks the same question rather than a
 * similar one. `validateWidgetDefinition` refuses a malformed cell and the
 * plugin path checked only that the array was non-empty, so a contribution
 * carrying a `list` query, a missing query or two cells under one key was
 * published -- the exact values the registry refuses, arriving by the other
 * door and rendering as silent dashes or one answer drawn twice.
 */
export function cellsProblem(
  cells: unknown,
  max: number = MAX_STAT_CELLS
): string | undefined {
  if (!Array.isArray(cells) || cells.length === 0) {
    return 'archetype "stats" requires a non-empty cells array';
  }
  if (cells.length > max) {
    return `a stats card may declare at most ${max} cells, got ${cells.length}`;
  }
  const seen = new Set<string>();
  for (const [index, cell] of cells.entries()) {
    const problem = statCellProblem(cell, `cells[${index}]`);
    if (problem !== undefined) return problem;
    const key = (cell as WidgetStatCell).key;
    if (seen.has(key)) return `cells declare the key "${key}" more than once`;
    seen.add(key);
  }
  return undefined;
}

/**
 * Why a `custom` card's cells cannot be asked, or `undefined` when they can:
 * at least one, at most {@link MAX_STAT_CELLS}, each a keyed query, no key
 * twice. Each query's shape is judged with the card's own query
 * ({@link widgetQueryShapeProblem}).
 */
function queryCellsProblem(cells: unknown): string | undefined {
  if (!Array.isArray(cells) || cells.length === 0) {
    return "a custom card's cells, when declared, must be a non-empty array";
  }
  if (cells.length > MAX_STAT_CELLS) {
    return `a custom card may declare at most ${MAX_STAT_CELLS} cells, got ${cells.length}`;
  }
  const seen = new Set<string>();
  for (const [index, cell] of cells.entries()) {
    const problem = queryCellProblem(cell, index);
    if (problem !== undefined) return problem;
    // Well formed now, so the key is a string.
    const key = (cell as WidgetQueryCell).key;
    if (seen.has(key)) return `cells declare the key "${key}" more than once`;
    seen.add(key);
  }
  return undefined;
}

/** Why one cell cannot be asked: no key, a condition it may not name, or no query. */
/** Why an optional value is outside its closed set, or nothing when it is absent or inside. */
function closedValueProblem(
  name: string,
  value: unknown,
  allowed: readonly string[]
): string | undefined {
  if (value === undefined || allowed.includes(value as string))
    return undefined;
  return `has ${name} ${JSON.stringify(value)}, which is not one of ${allowed.join(", ")}`;
}

function queryCellProblem(cell: unknown, index: number): string | undefined {
  const { key, query, when, drawnFrom } = (cell ??
    {}) as Partial<WidgetQueryCell>;
  if (typeof key !== "string" || key.trim() === "") {
    return `cells[${index}] needs a non-empty key`;
  }
  const outside =
    closedValueProblem("when", when, WIDGET_CELL_CONDITIONS) ??
    closedValueProblem("drawnFrom", drawnFrom, WIDGET_CELL_TIERS);
  if (outside !== undefined) return `cells[${index}] ("${key}") ${outside}`;
  if (typeof query !== "object" || query === null) {
    return `cells[${index}] ("${key}") needs a query`;
  }
  return undefined;
}

/**
 * Confirms `cells` is present exactly for `stats`, and well formed.
 *
 * The duplicate-key check matters more than it looks: the card keys each
 * answer back by `key`, so two cells sharing one would collapse into a single
 * answer and the card would draw the same number twice under two different
 * labels -- which is not wrong-looking in any way a reader could detect.
 */
/**
 * Why a custom card that asks twice is refused, or `undefined`: a card answered
 * through its cells has no top-level query, since nothing would hand the
 * component that query's answer. One rule for both declaration channels, the
 * registry's and a plugin's contributed widgets, so neither accepts a shape the
 * other refuses.
 */
export function customAsksTwiceProblem(widget: {
  archetype?: unknown;
  query?: unknown;
  cells?: unknown;
}): string | undefined {
  return widget.archetype === "custom" &&
    widget.cells !== undefined &&
    widget.query !== undefined
    ? "a custom card asks through its query or its cells, not both"
    : undefined;
}

/**
 * Why a widget's `limit` setting cannot reach its query, or `undefined`. A
 * number setting named `limit` sets how many rows the card asks for, and a
 * query over a `range` refuses a limit, since its range sets how many points
 * are drawn: offered beside one, the setting would fail every request it
 * changed. Shared by the registry and the contributed-widget check.
 */
export function rangedLimitSettingProblem(widget: {
  query?: unknown;
  cells?: unknown;
  settings?: unknown;
}): string | undefined {
  // The setting the limit knob drives, by the knob's own test.
  const limited =
    Array.isArray(widget.settings) && widget.settings.some(isLimitSetting);
  if (!limited) return undefined;
  const queries = [
    widget.query,
    ...(Array.isArray(widget.cells)
      ? widget.cells.map(cell =>
          typeof cell === "object" && cell !== null
            ? (cell as { query?: unknown }).query
            : undefined
        )
      : []),
  ];
  const ranged = queries.some(
    query =>
      typeof query === "object" &&
      query !== null &&
      (query as { range?: unknown }).range !== undefined
  );
  return ranged
    ? 'declares a "limit" setting, and a query with a range draws the points its range sets'
    : undefined;
}

function validateCells(d: Partial<WidgetDefinition>): void {
  if (d.archetype === "custom" && d.cells !== undefined) {
    const twice = customAsksTwiceProblem(d);
    if (twice !== undefined) fail(`${d.id}: ${twice}`);
    const problem = queryCellsProblem(d.cells);
    if (problem !== undefined) fail(`${d.id}: ${problem}`);
    return;
  }
  if (d.archetype !== "stats") {
    if (d.cells !== undefined) {
      fail(`${d.id}: cells are only valid for archetype "stats" or "custom"`);
    }
    return;
  }
  const problem = cellsProblem(d.cells);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

/**
 * Why an archetype cannot draw the result its query would return, if it cannot.
 *
 * Answers a reason rather than throwing, like {@link querylessQueryProblem}
 * beside it, so the caller attaches the widget id once for every rule.
 */
export function archetypeResultProblem(
  archetype: WidgetArchetype,
  // Sourceless too: the op decides what an archetype can draw, whichever way
  // the source arrives.
  query: WidgetQuerySpec | SettingSourcedQuerySpec | undefined
): string | undefined {
  // A Map, not an object literal. A contribution's archetype is caller text,
  // and `"toString"` or `"constructor"` indexes an object literal to something
  // inherited rather than to `undefined` — the same hole this file's group-key
  // sibling had, so it gets the container that cannot have it.
  const drawable = ARCHETYPE_RESULTS.get(archetype as DataWidgetArchetype);
  if (!drawable || !query?.op || drawable.has(query.op)) return undefined;
  return (
    `archetype "${archetype}" draws a ${[...drawable].join(" or ")} result, ` +
    `so it cannot use op "${query.op}"`
  );
}

/**
 * Confirms `allowsSeveral` and `sketch`, when stated, are values the add panel
 * can act on: a boolean, and one of the displays core draws.
 */
function validateOfferTerms(d: Partial<WidgetDefinition>): void {
  if (d.allowsSeveral !== undefined && typeof d.allowsSeveral !== "boolean") {
    fail(`${d.id}: allowsSeveral must be true or false`);
  }
  if (d.sketch !== undefined && !DATA_ARCHETYPE_SET.has(d.sketch)) {
    fail(`${d.id}: sketch must be one of ${DATA_ARCHETYPES.join(", ")}`);
  }
}

/**
 * Confirms `empty`, when stated, comes with `serverData` and has its shape.
 *
 * Only a declared widget's empty state is published, and its words and link
 * were judged at startup by the empty state's own rules. A registered widget
 * stating one would bypass them, so it is refused; the shape is still checked,
 * as a guard over values already in hand.
 */
function validateEmpty(d: Partial<WidgetDefinition>): void {
  const empty: unknown = d.empty;
  if (empty === undefined) return;
  if (d.serverData !== true) {
    fail(`${d.id}: empty is published by core for a declared widget only`);
  }
  const { message, action } = empty as { message?: unknown; action?: unknown };
  if (
    (message !== undefined && !isText(message)) ||
    !emptyActionIsText(action)
  ) {
    fail(`${d.id}: empty has a message or an action that is not text`);
  }
}

/** Words a person reads: a string with something in it. */
const isText = (value: unknown) =>
  typeof value === "string" && value.trim() !== "";

/** An empty state's action, when stated: a label and a link, each of them text. */
function emptyActionIsText(action: unknown): boolean {
  if (action === undefined) return true;
  if (typeof action !== "object" || action === null) return false;
  const { label, link } = action as { label?: unknown; link?: unknown };
  return isText(label) && isText(link);
}

/**
 * Why a definition's query, or its want of one, does not fit its archetype:
 * the ONE reading of that question, for every way a data archetype's card can
 * be answered.
 *
 * A data archetype is answered by a query it carries, or, marked `serverData`,
 * by core from the widget's declaration, with no query. The mark may only be
 * `true`, and a query beside it would leave two answers to what the card
 * shows: the one the definition carries and the one core builds.
 */
export function widgetQueryShapeProblem(
  d: Partial<WidgetDefinition>
): string | undefined {
  const marked: unknown = d.serverData;
  if (marked !== undefined) {
    if (marked !== true) return "serverData may only be true";
    if (d.query !== undefined) {
      return "a widget whose data is built on the server takes no query";
    }
    return undefined;
  }
  const archetype = d.archetype as WidgetArchetype;
  if (DATA_ARCHETYPE_SET.has(archetype) && !d.query) {
    return `archetype "${d.archetype}" requires a query`;
  }
  return sourceProblem(d);
}

function validateQuery(d: Partial<WidgetDefinition>): void {
  const archetype = d.archetype as WidgetArchetype;
  const shape = widgetQueryShapeProblem(d);
  if (shape !== undefined) fail(`${d.id}: ${shape}`);
  // Refused with its OWN reason rather than the queryless one, which would say
  // this archetype takes no data -- the opposite of true. Its numbers come from
  // `cells`, and an author who wrote `query` needs to be told where to move it.
  if (CELL_ARCHETYPE_SET.has(archetype) && d.query !== undefined) {
    fail(
      `${d.id}: archetype "${d.archetype}" draws from cells, so it takes no top-level query`
    );
  }
  const mismatch = archetypeResultProblem(archetype, d.query);
  if (mismatch !== undefined) fail(`${d.id}: ${mismatch}`);
  const problem = querylessQueryProblem(archetype, d.query);
  if (problem !== undefined) fail(`${d.id}: ${problem}`);
}

/**
 * Why a definition's query cannot name what it reads, or `undefined` when it
 * can: it declares a source, or it declares none and a Collection setting
 * supplies one. Both together is a source the card's Collection setting
 * replaces once it is set, and reads while it is not.
 *
 * A grouped query's group key is read the same way: stated, or supplied by a
 * Group by setting that always has a value to give, a static default or one
 * taken from the collection. Left to a setting that may give none, the card
 * would be asked a grouping of nothing, which the endpoint refuses.
 */
function sourceProblem(d: Partial<WidgetDefinition>): string | undefined {
  const fromSetting = declaresCollectionSetting(d.settings);
  // The card's own query and each of a custom card's cells, judged alike: the
  // Collection setting supplies every one of their sources, or none.
  const asked: Array<[string, AskedQuery | undefined]> = [
    ["its query", d.query],
    // Judged before the cells' own rule runs, so a malformed list is left to
    // that rule to refuse by name.
    ...(d.archetype === "custom" && Array.isArray(d.cells)
      ? (d.cells as Partial<WidgetQueryCell>[]).map(
          (cell): [string, AskedQuery | undefined] => [
            `its cell "${String(cell?.key)}"`,
            typeof cell?.query === "object" && cell.query !== null
              ? cell.query
              : undefined,
          ]
        )
      : []),
  ];
  for (const [what, query] of asked) {
    if (query === undefined) continue;
    if (query.source === undefined && !fromSetting) {
      return `${what} names no source, and no Collection setting supplies one`;
    }
    // Per query: a Group by setting reaches only the queries its knob drives
    // (a collection's, or one a Collection setting fills), so a cell on
    // another kind of source is not supplied by it.
    if (
      query.op === "groupBy" &&
      query.groupBy === undefined &&
      !suppliesGrouping(d.settings, query)
    ) {
      return `${what} names no groupBy, and no Group by setting with a default supplies one`;
    }
  }
  return undefined;
}

/** The parts of a declared query `sourceProblem` reads, read defensively. */
interface AskedQuery {
  source?: string;
  op?: unknown;
  groupBy?: unknown;
}

/**
 * Whether a definition declares a Group by setting that always gives `query`
 * a value: one with a default, or one taking its default from the collection,
 * that a knob drives on that query. Read defensively, as
 * {@link declaresCollectionSetting} reads.
 */
function suppliesGrouping(settings: unknown, query: AskedQuery): boolean {
  return (
    Array.isArray(settings) &&
    settings.some((setting: unknown) => {
      if (typeof setting !== "object" || setting === null) return false;
      const { type, defaultValue, defaultFrom } = setting as {
        type?: unknown;
        defaultValue?: unknown;
        defaultFrom?: unknown;
      };
      return (
        type === "groupBy" &&
        (typeof defaultValue === "string" || defaultFrom === "collection") &&
        drivesQuery(setting as AnyWidgetSetting, query)
      );
    })
  );
}

/**
 * Whether a definition declares a Collection setting. Read defensively:
 * malformed settings are the settings rule's to refuse by name, so here they
 * simply declare none.
 */
function declaresCollectionSetting(settings: unknown): boolean {
  return (
    Array.isArray(settings) &&
    settings.some(
      (setting: unknown) =>
        typeof setting === "object" &&
        setting !== null &&
        (setting as { type?: unknown }).type === "collection"
    )
  );
}

/** The modes `offered` may name, the closed list its type spells. */
const OFFERED_MODES = [
  "per-collection",
  "on-request",
] as const satisfies readonly NonNullable<WidgetDefinition["offered"]>[];

/**
 * Refuses an `offered` mode outside its closed list, and a widget offered per
 * collection that declares no Collection setting:
 * its add-panel rows each start a card set to a collection, so without one the
 * widget could be added nowhere.
 */
function validateOffered(d: Partial<WidgetDefinition>): void {
  // An untyped registration with a misspelt mode would otherwise be read as an
  // ordinary widget: placed by default, perhaps with no collection to read.
  const outside = closedValueProblem("offered", d.offered, OFFERED_MODES);
  if (outside !== undefined) fail(`${d.id}: ${outside}`);
  if (
    d.offered === "per-collection" &&
    !declaresCollectionSetting(d.settings)
  ) {
    fail(
      `${d.id}: a widget offered per collection needs a Collection setting, which each card starts set to`
    );
  }
}

/** Throws with a named reason if `def` is not a usable definition. */
export function validateWidgetDefinition(
  def: unknown
): asserts def is WidgetDefinition {
  if (typeof def !== "object" || def === null) fail("expected an object");
  const d = def as Partial<WidgetDefinition>;

  validateId(d);
  // The rules neither channel reads differently, asked once.
  const valueProblem = widgetValueProblem(d);
  if (valueProblem !== undefined) fail(`${d.id}: ${valueProblem}`);

  validateTitle(d);
  validateArchetype(d);
  validateSize(d);
  validateComponent(d);
  validateActions(d);
  validateText(d);
  validateQuery(d);
  validateOfferTerms(d);
  validateEmpty(d);
  validateCells(d);
  const rangedLimit = rangedLimitSettingProblem(d);
  if (rangedLimit !== undefined) fail(`${d.id}: ${rangedLimit}`);
  validateOffered(d);
  validateDefaultOrder(d);
  // Judged on what the widget asks, with the filters each source declares: a
  // content setting is admitted where core builds the query, or where a knob
  // drives it on the query's source or on at least one cell's.
  validateWidgetSettings(
    d.settings,
    d.id ?? "widget",
    d.serverData === true,
    settingsSourceOf(d)
  );
}
