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
import type { BreakpointRun } from "./breakpoint-removal/run-store";
import type { BreakpointRemovalService } from "./breakpoint-removal/service";
import { stripClasses } from "./breakpoint-removal/strip";
import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import {
  readLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./default-layout/store";
import { documentKeyOf, type RewriteReport } from "./host-rewrite/contract";
import { runStarterOf } from "./host-rewrite/service";
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
  return { breakpoints: value ?? null, dryRun: parsed.data.dryRun === true };
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
  readonly stored: (ctx: SiteSettingsRouteContext) => Promise<StoredSiteStyle>;
  /** The configured site style, which a stored `null` gives back. */
  readonly defaults?: SiteStyleData;
  /** Walk the site for what removing each of these would drop. */
  readonly count: (
    removed: ReadonlyMap<string, string>,
    classes: readonly NamedClass[],
    ctx: BreakpointsRouteContext
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
  data: Record<string, unknown>
): Promise<void> {
  await nextly.updateSingle({
    slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
    data,
    overrideAccess: true,
    context: { ...SITE_SETTINGS_WRITE_CONTEXT },
    ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
  });
}

/** What a save that removes a breakpoint while its removal is open is told. */
const READDED_WHILE_REMOVING =
  "A breakpoint in this set is still being removed. Try again when its removal has finished.";

/**
 * Refuse a set that defines a breakpoint the open removal is stripping: the
 * walk would go on stripping values the site now emits again.
 */
function refuseReadding(
  open: BreakpointRun | null,
  after: BreakpointSet | undefined
): void {
  if (open === null) return;
  const removing = new Set(open.removedIds);
  const readded = breakpointContexts(after)
    .map(context => context.id)
    .filter(id => removing.has(id));
  if (readded.length === 0) return;
  throw NextlyError.conflict({
    reason: "state",
    message: READDED_WHILE_REMOVING,
    logContext: { reason: "breakpoint-readded-while-removing", readded },
  });
}

/**
 * The stored shared styles without their values under `ids`, or `undefined`
 * when none holds any, so a removal that strips no shared style writes none.
 */
function strippedStoredClasses(
  stored: unknown,
  ids: ReadonlySet<string>
): readonly unknown[] | undefined {
  const list = readStoredJson(stored);
  if (!Array.isArray(list)) return undefined;
  const stripped = stripClasses(list, ids);
  return stripped === list ? undefined : stripped;
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

/**
 * Open a removal, count what it drops, and store the set with the shared
 * styles stripped in the same write. The removal is dropped again when either
 * fails, since nothing was removed.
 */
async function beginRemoval(args: {
  breakpoints: SiteBreakpointsRequest["breakpoints"];
  ctx: BreakpointsRouteContext;
  nextly: SiteSettingsDirectApi;
  removal: BreakpointRemoval;
  service: BreakpointRemovalService;
  stored: StoredSiteStyle;
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
      ctx
    );
    const classes = strippedStoredClasses(
      stored.classes,
      new Set(removed.keys())
    );
    await writeSiteStyle(args.nextly, ctx, {
      breakpoints: args.breakpoints,
      ...(classes === undefined ? {} : { classes }),
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
 * Store a set that removes breakpoints, and strip what they held from the
 * whole site: the shared styles in the same write as the set, then every
 * document holding blocks, as far as the time allows. Only one removal is
 * open at a time, and a set defining a breakpoint it is still removing is
 * refused.
 */
async function saveBreakpoints(
  req: Request,
  breakpoints: SiteBreakpointsRequest["breakpoints"],
  ctx: BreakpointsRouteContext,
  nextly: SiteSettingsDirectApi,
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade }
): Promise<Response> {
  const service = removal.cascade.service();
  const stored = await removal.stored(ctx);
  const after = breakpointsAfter(removal, breakpoints);
  refuseReadding(await service.openRun(), after);
  const removed = removedBreakpoints(
    siteBreakpoints(currentStyle(removal, stored)),
    after
  );
  if (removed.size === 0) {
    await writeSiteStyle(nextly, ctx, { breakpoints });
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
  const report = await service.walk(run.id, {
    deadline: new Date(Date.now() + removal.cascade.walkMs),
  });
  return removalAnswer(
    SAVED,
    (removal): SiteBreakpointsSaved => ({ breakpoints, removal }),
    run.id,
    report
  );
}

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
  const { breakpoints, dryRun } = await readBreakpoints(req);
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
    return saveBreakpoints(req, breakpoints, ctx, nextly, {
      ...removal,
      cascade,
    });
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
 * A run whose breakpoints the site still defines is one whose set was never
 * stored (its save failed after opening it), so it is dropped rather than
 * walked: walking it would strip values the site still emits.
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
  const defined = new Set(
    breakpointContexts(
      siteBreakpoints(currentStyle(removal, await removal.stored(ctx)))
    ).map(context => context.id)
  );
  if (run.open && run.removedIds.some(id => defined.has(id))) {
    await service.abandon(run.id);
    return respondMutation<SiteBreakpointRemoval>(
      "Nothing was removed: the site still has these breakpoints.",
      { runId, finished: true, left: 0 }
    );
  }
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
