/**
 * The site's settings as the editor's Settings changes them: the permission
 * they need, the one way the site's breakpoints change, and what a caller may
 * change.
 *
 * The breakpoints have ONE door. Redefining the site's devices is a site
 * setting with a permission of its own, so it is written by a route that asks
 * for that permission, and the `site-style` Single refuses every other write
 * that changes them (`refuseBreakpointsOutsideSettings`, beside the Single).
 *
 * A set that removes breakpoints also strips every value stored under them
 * from the site (`breakpoint-removal/service`): one removal at a time, each
 * audited, carried on by its own route when the save runs out of time.
 *
 * @module site-settings
 */
import {
  breakpointContexts,
  type BreakpointSet,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  REMOVAL_PLACES,
  type PlaceCount,
  type RemovalDryRun,
  type RemovalPlace,
  type RemovedBreakpoint,
} from "./breakpoint-removal/dry-run";
import type { BreakpointRun, HoldingRun } from "./breakpoint-removal/run-store";
import type { BreakpointRemovalService } from "./breakpoint-removal/service";
import { stripClass, stripClasses } from "./breakpoint-removal/strip";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import {
  documentKeyOf,
  type LeftReason,
  type RewriteReport,
} from "./host-rewrite/contract";
import { runStarterOf } from "./host-rewrite/service";
import { inCauses } from "./judged-writes";
import {
  SITE_BREAKPOINT_REMOVAL_ROUTE_PATH,
  SITE_BREAKPOINTS_ROUTE_PATH,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteBreakpointRemoval,
  type SiteBreakpointRemovalRequest,
  type SiteBreakpointsRequest,
  type SiteBreakpointsSaved,
  type SiteLayoutOption,
  type SiteSettingsRead,
  type StoredSiteStyle,
} from "./library-contract";
import { walkPages } from "./paged-walk";
import {
  resolveSiteStyle,
  siteBreakpoints,
  type SiteStyleData,
} from "./site-style";
import {
  checkStoredBreakpoints,
  readSiteStyleRecord,
} from "./site-style-record";
import {
  loadSiteStyle,
  sameStoredValue,
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "./site-style-storage";
import { readStoredJson } from "./stored-json";

/** The permission a role needs to change the site's settings, in its parts. */
const MANAGE_SITE = {
  action: "manage",
  resource: "page-builder-site",
} as const;

/** The same permission as a route declares it. */
export const MANAGE_SITE_PERMISSION: string = `${MANAGE_SITE.action}-${MANAGE_SITE.resource}`;

/** The caller and the plugin's resolved names, as a route sees them. */
export interface SiteSettingsRouteContext {
  self: {
    collections: Record<string, string | undefined>;
    singles: Record<string, string | undefined>;
  };
  user: { id: string } | null;
  caller: { can(action: string, resource: string): Promise<boolean> } | null;
}

/** The slice of the Direct API the breakpoints route writes through. */
export interface SiteSettingsDirectApi {
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
    context: Record<string, unknown>;
    user?: { id: string };
  }): Promise<unknown>;
}

const BreakpointsBody = z.strictObject({
  breakpoints: z.unknown(),
  // Count what saving this set would drop, and save nothing.
  dryRun: z.boolean().optional(),
  // Strip what the removed breakpoints held, as the person confirmed after
  // seeing the dry run. Without it a set removing breakpoints is stored and
  // nothing stored under them is touched.
  confirmRemoval: z.boolean().optional(),
});

/** A refusal naming what is wrong with the breakpoints sent. */
function invalidBreakpoints(messages: readonly string[]): NextlyError {
  return NextlyError.validation({
    errors: messages.map(message => ({
      path: "breakpoints",
      code: "INVALID_VALUE",
      message,
    })),
  });
}

/** The body, parsed at the boundary: a set the site may store, or refused. */
async function readBreakpoints(req: Request): Promise<{
  breakpoints: SiteBreakpointsRequest["breakpoints"];
  dryRun: boolean;
  confirmRemoval: boolean;
}> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = BreakpointsBody.safeParse(raw);
  if (!parsed.success || parsed.data.breakpoints === undefined) {
    throw invalidBreakpoints(["The request is not a set of breakpoints."]);
  }
  // The Single's own check, so the route stores nothing the Single's field
  // would refuse. `null` is a set too: it clears the stored one, and the
  // site's configured breakpoints apply again.
  const { value, issues } = checkStoredBreakpoints(parsed.data.breakpoints);
  if (issues.length > 0) throw invalidBreakpoints(issues);
  return {
    breakpoints: value ?? null,
    dryRun: parsed.data.dryRun === true,
    confirmRemoval: parsed.data.confirmRemoval === true,
  };
}

/**
 * The breakpoints `after` no longer defines that `before` does, by id, with
 * the name the author knows each by. Both are the sets the stylesheet is
 * emitted under, so a definition the compiler drops is in neither.
 */
export function removedBreakpoints(
  before: BreakpointSet | undefined,
  after: BreakpointSet | undefined
): Map<string, string> {
  const kept = new Set(breakpointContexts(after).map(context => context.id));
  const labels = new Map(
    [...(before?.viewport ?? []), ...(before?.container ?? [])].map(def => [
      def.id,
      def.label ?? def.id,
    ])
  );
  const removed = new Map<string, string>();
  for (const { id } of breakpointContexts(before)) {
    if (!kept.has(id)) removed.set(id, labels.get(id) ?? id);
  }
  return removed;
}

/** How the installed plugin counts, and carries out, a removal. */
export interface BreakpointRemoval {
  /**
   * The site style's Single as stored: what a removal records as the set it
   * replaced, and the shared styles it strips. The site's style as it is now
   * is derived from it ({@link currentStyle}).
   */
  readonly stored: (
    ctx: SiteSettingsRouteContext
  ) => Promise<VersionedSiteStyle>;
  /** The configured site style, which a stored `null` gives back. */
  readonly defaults?: SiteStyleData;
  /** Walk the site for what removing each of these would drop. */
  readonly count: (
    removed: ReadonlyMap<string, string>,
    classes: readonly NamedClass[],
    ctx: BreakpointsRouteContext,
    /** When the count stops and answers what it has (`complete: false`). */
    deadline?: Date
  ) => Promise<RemovalDryRun>;
  /**
   * Carrying a removal out: its run, and the walk stripping the site. Absent,
   * a save that removes breakpoints stores the set and strips nothing.
   */
  readonly cascade?: BreakpointCascade;
}

/** What carrying a removal out needs of the installed plugin. */
export interface BreakpointCascade {
  readonly service: () => BreakpointRemovalService;
  /** How long one request walks the site before answering with the run. */
  readonly walkMs: number;
  /**
   * How long a save counts what its removal drops, for the audit, before it
   * records what it has counted (`complete: false`) and goes on.
   */
  readonly countMs: number;
  /**
   * Log a removal's walk that failed after its set was stored. The save still
   * answers with the run, which its route or the removal job carries on.
   */
  readonly logError?: (message: string, meta: Record<string, unknown>) => void;
}

/** The site style's Single as stored, and the version that read was of. */
export interface VersionedSiteStyle extends StoredSiteStyle {
  /**
   * The Single's `_rev` when it was read. A save handing it back is refused
   * (`STALE_VERSION`) once another save has replaced it, rather than
   * overwriting what that save stored.
   */
  readonly version?: string;
}

/** The key a stored document carries its version under. */
const VERSION_KEY = "_rev";

/** A stored document's version, when it carries one. */
export function versionOfDocument(doc: unknown): string | undefined {
  if (typeof doc !== "object" || doc === null) return undefined;
  const version: unknown = (doc as Record<string, unknown>)[VERSION_KEY];
  return typeof version === "string" ? version : undefined;
}

/**
 * The version a save made from `stored` hands back. A read without one is
 * refused rather than written past: a write that cannot say what it was
 * computed from could overwrite a removal or a re-add saved meanwhile.
 */
function versionToWrite(stored: VersionedSiteStyle): string {
  if (stored.version !== undefined) return stored.version;
  throw NextlyError.internal({
    logContext: { reason: "site-style-read-without-version" },
  });
}

/** Whether a write was refused because the Single changed since it was read. */
function isStaleVersion(error: unknown): boolean {
  return inCauses(error, NextlyError)?.code === "STALE_VERSION";
}

/**
 * What the breakpoints routes are handed: the settings context, who asks, and
 * the audit trail a removal is recorded in.
 */
export type BreakpointsRouteContext = SiteSettingsRouteContext &
  Pick<PluginRouteContext, "caller" | "audit">;

/** The site's style as it is now: the stored record over the configured defaults. */
function currentStyle(
  removal: BreakpointRemoval,
  stored: StoredSiteStyle
): SiteStyleData {
  return resolveSiteStyle(removal.defaults, readSiteStyleRecord(stored));
}

/**
 * The breakpoints the site emits once `breakpoints` is stored: a stored
 * `null` gives the configured defaults back, as the resolved style reads it.
 */
function breakpointsAfter(
  removal: BreakpointRemoval,
  breakpoints: SiteBreakpointsRequest["breakpoints"]
): BreakpointSet | undefined {
  return siteBreakpoints(
    resolveSiteStyle(removal.defaults, {
      breakpoints: breakpoints ?? undefined,
    })
  );
}

/** What a dry run answers with. */
interface SiteBreakpointsDryRun extends RemovalDryRun {
  readonly dryRun: true;
  readonly breakpoints: SiteBreakpointsRequest["breakpoints"];
}

/**
 * What saving `breakpoints` would drop, with nothing saved: the breakpoints it
 * removes from the set the site emits now, and every style and hide stored
 * under them.
 */
async function dryRunBreakpoints(
  breakpoints: SiteBreakpointsRequest["breakpoints"],
  ctx: BreakpointsRouteContext,
  removal: BreakpointRemoval
): Promise<Response> {
  const current = currentStyle(removal, await removal.stored(ctx));
  const removed = removedBreakpoints(
    siteBreakpoints(current),
    breakpointsAfter(removal, breakpoints)
  );
  const counted = await removal.count(removed, current.classes ?? [], ctx);
  return respondMutation<SiteBreakpointsDryRun>(
    "Nothing was saved: this is what saving these breakpoints would drop.",
    { dryRun: true, breakpoints, ...counted }
  );
}

/**
 * The one write of the site style's Single that changes its breakpoints:
 * marked, so the Single's hook knows which door it came through, and made past
 * the Single's own permission, because the site permission the route asked
 * for is what lets a role redefine its devices.
 */
async function writeSiteStyle(
  nextly: SiteSettingsDirectApi,
  ctx: SiteSettingsRouteContext,
  data: Record<string, unknown>,
  /** The version the write was computed from; refused once replaced. */
  version?: string
): Promise<void> {
  await nextly.updateSingle({
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    data: version === undefined ? data : { ...data, [VERSION_KEY]: version },
    overrideAccess: true,
    context: { ...SITE_SETTINGS_WRITE_CONTEXT },
    ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
  });
}

/** What a save that removes a breakpoint while its removal is open is told. */
const READDED_WHILE_REMOVING =
  "A breakpoint in this set is still being removed. Try again when its removal has finished.";

/** What a save defining a breakpoint a draft still holds values under is told. */
const READDED_UNDER_A_DRAFT =
  "Some pages still hold styles for that breakpoint (a draft is waiting to be published). Publish or discard those drafts, then add it again.";

/** What a save defining a breakpoint other left content still holds is told. */
const READDED_UNDER_LEFT_CONTENT =
  "Some content still holds styles for that breakpoint that could not be removed yet. Once that content can be saved, finish the breakpoint's removal, then add it again.";

/** The left reason a published page with a pending draft is recorded with. */
const PENDING_DRAFT: LeftReason = "pending-draft";

/** What a run still holding `readded` tells the person saving. */
function readdedMessage(held: HoldingRun): string {
  if (held.run.open) return READDED_WHILE_REMOVING;
  return held.leftReasons.includes(PENDING_DRAFT)
    ? READDED_UNDER_A_DRAFT
    : READDED_UNDER_LEFT_CONTENT;
}

/**
 * Refuse a set that defines again a breakpoint a removal still holds: the
 * open one is stripping its values, and a done one left documents still
 * keeping them. Defining it again would bring those values back instead of
 * starting empty. A held id the site defines already is not being added: a
 * run strips only the ids the site does not define, so it is left alone.
 */
function refuseReadding(
  holding: readonly HoldingRun[],
  now: BreakpointSet | undefined,
  after: BreakpointSet | undefined
): void {
  const current = new Set(breakpointContexts(now).map(context => context.id));
  const defined = new Set(
    breakpointContexts(after)
      .map(context => context.id)
      .filter(id => !current.has(id))
  );
  // The open run first: its refusal says to wait, which comes before any
  // document an earlier removal left.
  const ordered = [...holding].sort(
    (a, b) => Number(b.run.open) - Number(a.run.open)
  );
  for (const held of ordered) {
    const readded = held.run.removedIds.filter(id => defined.has(id));
    if (readded.length === 0) continue;
    throw NextlyError.conflict({
      reason: "state",
      message: readdedMessage(held),
      logContext: {
        reason: "breakpoint-readded-while-held",
        runId: held.run.id,
        readded,
      },
    });
  }
}

/**
 * The stored class tier a removal writes, or `undefined` when no shared style
 * holds anything under `ids`, so a removal that strips none writes none.
 *
 * The library the site compiles is the code's classes with the stored tier
 * over them, by id. So every stored entry is stripped, and each code-supplied
 * class that holds values under `ids` and that no stored entry overrides yet
 * is stored as its stripped override: the code's class, without them, which
 * is the stored tier's rule for what differs from the code (`classOverrideOf`).
 * Otherwise the code's values would stay in the library, and a breakpoint
 * added again under the same id would find them.
 */
function strippedClassTier(
  stored: unknown,
  supplied: readonly NamedClass[] | undefined,
  ids: ReadonlySet<string>
): readonly unknown[] | undefined {
  const read = readStoredJson(stored);
  const list: readonly unknown[] = Array.isArray(read) ? read : [];
  const stripped = stripClasses(list, ids);
  const overridden = new Set(
    list.map(entry =>
      typeof entry === "object" && entry !== null
        ? (entry as { id?: unknown }).id
        : undefined
    )
  );
  const fromCode = (supplied ?? [])
    .filter(entry => !overridden.has(entry.id))
    .map(entry => ({ entry, without: stripClass(entry, ids) }))
    .filter(({ entry, without }) => without !== entry)
    .map(({ without }) => without);
  if (stripped === list && fromCode.length === 0) return undefined;
  return [...stripped, ...fromCode];
}

/** The audit kind each removed breakpoint is recorded under. */
export const BREAKPOINT_REMOVED_AUDIT =
  "nextlyhq-plugin-page-builder.breakpoint-removed";

/** One key of a removal's audit row. */
type RemovalAuditKey =
  | "runId"
  | "breakpointId"
  | "breakpointLabel"
  | "documents"
  | "drafts"
  | "styles"
  | "hides"
  | RemovalPlace
  | "sharedStyles"
  | "sharedStyleValues"
  | "lockedDocuments"
  | "unaddressable"
  | "unreadable"
  | "complete";

/** The counts a removal's audit row carries, every one present. */
export const BREAKPOINT_REMOVED_METADATA: readonly RemovalAuditKey[] = [
  "runId",
  "breakpointId",
  "breakpointLabel",
  "documents",
  "drafts",
  "styles",
  "hides",
  ...REMOVAL_PLACES,
  "sharedStyles",
  "sharedStyleValues",
  "lockedDocuments",
  "unaddressable",
  "unreadable",
  "complete",
];

/** One removed breakpoint's audit metadata: what it dropped, zeros included. */
function auditMetadataOf(
  runId: string,
  entry: RemovedBreakpoint,
  counted: RemovalDryRun
): Record<RemovalAuditKey, string | number | boolean> {
  const places = REMOVAL_PLACES.map(place => entry.places[place]);
  const sum = (pick: (count: PlaceCount) => number) =>
    places.reduce((total, count) => total + pick(count), 0);
  return {
    runId,
    breakpointId: entry.id,
    breakpointLabel: entry.label,
    documents: sum(count => count.documents),
    drafts: sum(count => count.drafts),
    styles: sum(count => count.styles),
    hides: sum(count => count.hides),
    ...placeDocuments(entry),
    sharedStyles: entry.sharedStyles.classes,
    sharedStyleValues: entry.sharedStyles.styles,
    lockedDocuments: entry.locked.named.length + entry.locked.unnamed,
    unaddressable: entry.unaddressable,
    unreadable: counted.unreadable,
    complete: counted.complete,
  };
}

/** How many documents in each place held something under the breakpoint. */
function placeDocuments(
  entry: RemovedBreakpoint
): Record<RemovalPlace, number> {
  return Object.fromEntries(
    REMOVAL_PLACES.map(place => [place, entry.places[place].documents])
  ) as Record<RemovalPlace, number>;
}

/**
 * One audit row per removed breakpoint, with what removing it dropped as
 * counted before anything was stripped. The writer never throws.
 */
async function auditRemoval(
  ctx: BreakpointsRouteContext,
  req: Request,
  runId: string,
  counted: RemovalDryRun
): Promise<void> {
  for (const entry of counted.removed) {
    await ctx.audit?.write({
      kind: BREAKPOINT_REMOVED_AUDIT,
      actorUserId: ctx.user?.id ?? null,
      request: req,
      metadata: auditMetadataOf(runId, entry, counted),
    });
  }
}

/**
 * The answer to a save or a call carrying a removal on: 202 while the walk is
 * not finished, so the caller knows to call the removal route again.
 */
function removalAnswer<T>(
  message: { readonly finished: string; readonly going: string },
  itemOf: (removal: SiteBreakpointRemoval) => T,
  runId: string,
  report: RewriteReport
): Response {
  const removal: SiteBreakpointRemoval = {
    runId,
    finished: report.finished,
    // Documents, each once: a call walking both walks meets a document it
    // must leave in each, and a document leaves each of its hosts.
    left: new Set(report.left.map(left => documentKeyOf(left.host))).size,
  };
  return respondMutation(
    report.finished ? message.finished : message.going,
    itemOf(removal),
    report.finished ? undefined : { status: 202 }
  );
}

/** How many times a removal's write is made again after another save. */
const REMOVAL_WRITE_ATTEMPTS = 3;

/** What a save is told when the breakpoints changed while it was made. */
const BREAKPOINTS_CHANGED =
  "The site's breakpoints were changed while this was being saved. Reload to see them, then save again.";

/**
 * Store a removal's set with the shared styles stripped, from the version read
 * before the removal was opened. Another save of the Single in between
 * (a shared style edited in Design, say) is not overwritten: the write is
 * refused, the Single read again, its shared styles stripped again, and the
 * write made from that version, a few times. A save in between that changed
 * the breakpoints themselves is a removal planned from a set no longer stored,
 * so it is refused for the person to reload.
 */
async function writeRemovalSet(args: {
  breakpoints: SiteBreakpointsRequest["breakpoints"];
  ctx: BreakpointsRouteContext;
  nextly: SiteSettingsDirectApi;
  removal: BreakpointRemoval;
  stored: VersionedSiteStyle;
  removedIds: ReadonlySet<string>;
}): Promise<void> {
  let read = args.stored;
  for (let attempt = 1; ; attempt += 1) {
    const classes = strippedClassTier(
      read.classes,
      args.removal.defaults?.classes,
      args.removedIds
    );
    try {
      await writeSiteStyle(
        args.nextly,
        args.ctx,
        {
          breakpoints: args.breakpoints,
          ...(classes === undefined ? {} : { classes }),
        },
        versionToWrite(read)
      );
      return;
    } catch (error) {
      if (!isStaleVersion(error) || attempt >= REMOVAL_WRITE_ATTEMPTS) {
        throw error;
      }
    }
    read = await args.removal.stored(args.ctx);
    if (!sameStoredValue(read.breakpoints, args.stored.breakpoints)) {
      throw NextlyError.conflict({
        reason: "state",
        message: BREAKPOINTS_CHANGED,
        logContext: { reason: "breakpoint-removal-set-changed" },
      });
    }
  }
}

/**
 * Open a removal, count what it drops, and store the set with the shared
 * styles stripped in the same write. The removal is dropped again when either
 * fails, since nothing was removed.
 */
async function beginRemoval(args: {
  breakpoints: SiteBreakpointsRequest["breakpoints"];
  ctx: BreakpointsRouteContext;
  nextly: SiteSettingsDirectApi;
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade };
  service: BreakpointRemovalService;
  stored: VersionedSiteStyle;
  removed: ReadonlyMap<string, string>;
}): Promise<{ run: BreakpointRun; counted: RemovalDryRun }> {
  const { ctx, removal, service, stored, removed } = args;
  const run = await service.begin(
    [...removed.keys()],
    stored.breakpoints ?? null,
    runStarterOf(ctx)
  );
  try {
    // Counted before anything is stripped, for the audit trail.
    const counted = await removal.count(
      removed,
      currentStyle(removal, stored).classes ?? [],
      ctx,
      new Date(Date.now() + removal.cascade.countMs)
    );
    await writeRemovalSet({
      breakpoints: args.breakpoints,
      ctx,
      nextly: args.nextly,
      removal,
      stored,
      removedIds: new Set(removed.keys()),
    });
    return { run, counted };
  } catch (error) {
    await service.abandon(run.id);
    throw error;
  }
}

/** What a save answers once its set is stored. */
const SAVED = {
  finished: "The site's breakpoints were saved.",
  going:
    "The site's breakpoints were saved. The styles under the removed breakpoints are still being removed.",
};

/**
 * Store a set, and where it removes breakpoints and the person confirmed
 * stripping them, strip what they held from the whole site: the shared styles
 * in the same write as the set, then every document holding blocks, as far as
 * the time allows. Only one removal is open at a time, and a set defining a
 * breakpoint a removal still holds is refused.
 */
async function saveBreakpoints(
  req: Request,
  breakpoints: SiteBreakpointsRequest["breakpoints"],
  ctx: BreakpointsRouteContext,
  nextly: SiteSettingsDirectApi,
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade },
  /** Whether the person confirmed stripping what removed breakpoints held. */
  confirmed: boolean
): Promise<Response> {
  const service = removal.cascade.service();
  // Read BEFORE the runs are asked, and every write below hands its version
  // back: a removal opened, or a set stored, after this read makes the write
  // stale and it is refused, so a check made against the runs and the set
  // as read cannot be acted on once either has changed.
  const stored = await removal.stored(ctx);
  const now = siteBreakpoints(currentStyle(removal, stored));
  const after = breakpointsAfter(removal, breakpoints);
  refuseReadding(await service.holding(), now, after);
  const removed = removedBreakpoints(now, after);
  // Stripping the site is what the person confirmed after the dry run, never
  // a side effect of an ordinary save: unconfirmed, the set is stored and the
  // values under a removed breakpoint stay, inert, as they always have.
  if (removed.size === 0 || !confirmed) {
    await writeSiteStyle(nextly, ctx, { breakpoints }, versionToWrite(stored));
    return respondMutation<SiteBreakpointsSaved>(SAVED.finished, {
      breakpoints,
    });
  }
  const { run, counted } = await beginRemoval({
    breakpoints,
    ctx,
    nextly,
    removal,
    service,
    stored,
    removed,
  });
  await auditRemoval(ctx, req, run.id, counted);
  let report: RewriteReport;
  try {
    report = await service.walk(run.id, {
      deadline: new Date(Date.now() + removal.cascade.walkMs),
    });
  } catch (error) {
    // The set is stored and the run open: answered as a removal still going,
    // with its id, so the caller carries it on through its route (and the
    // removal job does if nobody does), rather than with an error that names
    // no run while the run holds the one open slot.
    removal.cascade.logError?.(
      "[page-builder] a breakpoint removal's walk failed after its set was " +
        "stored; it is carried on by its route or the removal job.",
      { runId: run.id, error }
    );
    report = NOT_WALKED;
  }
  return removalAnswer(
    SAVED,
    (removal): SiteBreakpointsSaved => ({ breakpoints, removal }),
    run.id,
    report
  );
}

/** A walk that did not run: nothing done, and not finished. */
const NOT_WALKED: RewriteReport = {
  rewritten: [],
  unchanged: [],
  left: [],
  caughtByFinalWalk: [],
  finished: false,
};

/**
 * Store the site's breakpoints: the one write that may change them.
 *
 * Authorized by the route's declared permission before this runs. A set that
 * removes breakpoints strips what they held from the site, where the
 * installed plugin can (`saveBreakpoints`).
 */
export async function writeSiteBreakpoints(
  req: Request,
  ctx: BreakpointsRouteContext,
  nextly: SiteSettingsDirectApi,
  removal?: BreakpointRemoval
): Promise<Response> {
  const { breakpoints, dryRun, confirmRemoval } = await readBreakpoints(req);
  if (dryRun) {
    // Counted only where the installed plugin can walk the site.
    if (removal === undefined) {
      throw NextlyError.internal({
        logContext: { reason: "breakpoint-dry-run-not-installed" },
      });
    }
    return dryRunBreakpoints(breakpoints, ctx, removal);
  }
  const cascade = removal?.cascade;
  if (removal !== undefined && cascade !== undefined) {
    return saveBreakpoints(
      req,
      breakpoints,
      ctx,
      nextly,
      { ...removal, cascade },
      confirmRemoval
    );
  }
  await writeSiteStyle(nextly, ctx, { breakpoints });
  return respondMutation<SiteBreakpointsSaved>(SAVED.finished, {
    breakpoints,
  });
}

/**
 * The route Settings writes the site's breakpoints through, and asks first
 * what a removal would drop (`dryRun`), under the same permission.
 */
export function siteBreakpointsRoute(removal?: BreakpointRemoval): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: BreakpointsRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SITE_BREAKPOINTS_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) =>
      writeSiteBreakpoints(req, ctx, await getCachedNextly(), removal),
  };
}

const RemovalBody = z.strictObject({ runId: z.string().min(1).max(64) });

/** What carrying a removal on answers. */
const CARRIED = {
  finished: "The styles under the removed breakpoints were removed.",
  going: "The styles under the removed breakpoints are still being removed.",
};

/**
 * Carry on a removal its save did not finish, from where it stopped. Any
 * site manager may: the walk writes as the system, so whose request carries
 * it on changes nothing it does.
 *
 * Only the run's breakpoints the site does not define now are stripped: one
 * defined again (or never removed, where its save failed after opening the
 * run) holds values the site still emits, so they stay, and a run left with
 * none is closed.
 */
async function carryOnRemoval(
  req: Request,
  ctx: BreakpointsRouteContext,
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade }
): Promise<Response> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = RemovalBody.safeParse(raw);
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "runId",
          code: "INVALID_VALUE",
          message: "The request does not name a breakpoint removal.",
        },
      ],
    });
  }
  const { runId }: SiteBreakpointRemovalRequest = parsed.data;
  const service = removal.cascade.service();
  const run = await service.runById(runId);
  if (run === null) {
    throw NextlyError.notFound({
      logContext: { reason: "breakpoint-removal-no-run", runId },
    });
  }
  // The walk strips only the run's ids the site does not define now, and
  // closes a run whose ids it defines again (`service`).
  const report = await service.walk(runId, {
    deadline: new Date(Date.now() + removal.cascade.walkMs),
  });
  return removalAnswer(CARRIED, removal => removal, runId, report);
}

/**
 * The route a removal its save did not finish is carried on through, under
 * the permission the save asked for.
 */
export function siteBreakpointRemovalRoute(
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade }
): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: BreakpointsRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SITE_BREAKPOINT_REMOVAL_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) => carryOnRemoval(req, ctx, removal),
  };
}

/** What a caller who may not manage the site is told: nothing about it. */
const NOTHING: SiteSettingsRead = {
  mayManageSite: false,
  mayChooseDefaultLayout: false,
  defaultLayout: null,
  breakpoints: null,
  layouts: [],
};

/** How many Layouts are read per page, and the most pages walked. */
const LAYOUT_PAGE_SIZE = 100;
const LAYOUT_PAGES_MAX = 50;

/**
 * What the Site tab shows, and what this caller may change there: the site
 * permission offers the tab, and with it the rights to update and publish
 * Layouts let the default Layout be chosen, as make-default asks. Read past
 * the Layouts' own read rule, as make-default's checks are, and only for a
 * caller the site permission admits.
 */
export async function readSiteSettings(
  ctx: SiteSettingsRouteContext,
  nextly: Pick<DefaultLayoutDirectApi, "find" | "findSingle">,
  /** The configured site style, which the stored breakpoints sit over. */
  defaults?: SiteStyleData
): Promise<SiteSettingsRead> {
  const { caller } = ctx;
  if (caller === null) return NOTHING;
  if (!(await caller.can(MANAGE_SITE.action, MANAGE_SITE.resource))) {
    return NOTHING;
  }
  const slugs = {
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    settings:
      ctx.self.singles[PAGE_BUILDER_SETTINGS_SLUG] ??
      PAGE_BUILDER_SETTINGS_SLUG,
  };
  const mayChooseDefaultLayout =
    (await caller.can("update", slugs.layouts)) &&
    (await caller.can("publish", slugs.layouts));
  const { defaultLayout } = await readLayoutSettings(nextly, slugs);
  // Every published Layout for a caller who may choose; otherwise only the
  // default, so it can be named.
  const only = mayChooseDefaultLayout
    ? undefined
    : defaultLayout === null
      ? []
      : [defaultLayout];
  const layouts: SiteLayoutOption[] = [];
  if (only === undefined || only.length > 0) {
    // Every page of them: an option left off would be a Layout that cannot be
    // made the default, or a default the select could not show.
    await walkPages({
      describe: "the published Layouts",
      maxPages: LAYOUT_PAGES_MAX,
      fetchPage: async page =>
        await nextly.find({
          collection: slugs.layouts,
          ...(only === undefined ? {} : { where: { id: { in: only } } }),
          status: "published",
          limit: LAYOUT_PAGE_SIZE,
          page,
          depth: 0,
          select: { id: true, title: true },
          overrideAccess: true,
        }),
      onPage: rows => {
        for (const row of rows) {
          const { id, title } = row as Record<string, unknown>;
          if (typeof id === "string" && typeof title === "string") {
            layouts.push({ id, title });
          }
        }
      },
    });
  }
  // The breakpoints as the canvas resolves them, read past Design's read:
  // the site permission admits their write, so it admits seeing them.
  const { breakpoints } = await loadSiteStyle({
    nextly,
    // The Single the route writes, renamed or not.
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    ...(defaults === undefined ? {} : { defaults }),
  });
  return {
    mayManageSite: true,
    breakpoints: breakpoints ?? null,
    mayChooseDefaultLayout,
    defaultLayout,
    layouts,
  };
}

/**
 * The route the Site tab reads before it draws. Authenticated, with no
 * required permission: the permission is what it reports on, and gating the
 * question on the answer would refuse exactly the authors it tells "no".
 */
export function siteSettingsRoute(defaults?: SiteStyleData): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: SiteSettingsRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: SITE_SETTINGS_ROUTE_PATH,
    handler: async (_req, ctx) =>
      Response.json(
        await readSiteSettings(ctx, await getCachedNextly(), defaults)
      ),
  };
}
