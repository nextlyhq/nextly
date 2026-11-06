/**
 * Undoing a breakpoint removal from Settings.
 *
 * The newest removal can be undone once, within the 30 days what it took out
 * is kept for (`breakpoint-removal/fragments`). Undoing it defines its
 * breakpoints again and puts every value it took out back where nothing has
 * been set since, in two steps, the way a removal is made:
 * - one write of the site style's Single: the breakpoints re-inserted into
 *   the set as it is now, and the shared styles' values put back;
 * - then a walk of the documents the removal kept something for, carried on
 *   through the removal route and the removal job like a removal's walk.
 *
 * The undo is a run of its own, holding the one open slot, so no removal is
 * saved while it puts values back, and a lock accepts exactly what it puts
 * back (`breakpoint-removal/lock-acceptance`).
 *
 * @module site-breakpoint-undo
 * @experimental
 */
import {
  breakpointContexts,
  MAX_BREAKPOINTS_PER_AXIS,
  type BreakpointDef,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";
import { getCachedNextly, NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { restoreClasses } from "./breakpoint-removal/restore";
import {
  removedEver,
  type BreakpointRun,
} from "./breakpoint-removal/run-store";
import type { BreakpointRemovalService } from "./breakpoint-removal/service";
import { removalOf } from "./breakpoint-removal/strip";
import { undoMessage, undoReport } from "./breakpoint-removal/undo-report";
import type { RewriteReport } from "./host-rewrite/contract";
import { runStarterOf } from "./host-rewrite/service";
import {
  SITE_BREAKPOINT_UNDO_ROUTE_PATH,
  type SiteBreakpointRemovalRequest,
  type SiteBreakpointsSaved,
} from "./library-contract";
import {
  currentStyle,
  isStaleVersion,
  MANAGE_SITE_PERMISSION,
  NOT_WALKED,
  refuseReadding,
  removalAnswer,
  setLanded,
  sharedStylesNow,
  versionToWrite,
  writeSiteStyle,
  type BreakpointCascade,
  type BreakpointRemoval,
  type BreakpointsRouteContext,
  type SiteSettingsDirectApi,
  type VersionedSiteStyle,
} from "./site-settings";
import { siteBreakpoints } from "./site-style";
import { checkStoredBreakpoints } from "./site-style-record";
import { readStoredJson } from "./stored-json";

/** The audit kind an undo of a removal is recorded under. */
export const BREAKPOINT_REMOVAL_UNDONE_AUDIT =
  "nextlyhq-plugin-page-builder.breakpoint-removal-undone";

/** The keys an undo's audit row carries, every one present. */
export const BREAKPOINT_REMOVAL_UNDONE_METADATA: readonly string[] = [
  "runId",
  "undoes",
  "breakpointIds",
  "breakpointLabels",
];

const UndoBody = z.strictObject({ runId: z.string().min(1).max(64) });

/** The removal the body names, parsed at the boundary. */
async function readUndo(req: Request): Promise<string> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = UndoBody.safeParse(raw);
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
  return runId;
}

/** An undo refused for what the site's breakpoints are now, with why. */
function cannotPutBack(message: string, reason: string): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message,
    logContext: { reason: `breakpoint-undo-${reason}` },
  });
}

/** Where a width is on its axis: an unbounded definition is the widest. */
function widthOf(def: BreakpointDef): number {
  return def.maxWidth ?? Number.POSITIVE_INFINITY;
}

/**
 * `axis` with `def` put back in width order, widest first: before the first
 * definition narrower than it, so the order the site keeps is kept.
 */
function insertedByWidth(
  axis: readonly BreakpointDef[],
  def: BreakpointDef
): BreakpointDef[] {
  const at = axis.findIndex(other => widthOf(other) < widthOf(def));
  return at === -1
    ? [...axis, def]
    : [...axis.slice(0, at), def, ...axis.slice(at)];
}

/**
 * Why `def` cannot go back on `axis` of `set`, or `undefined` when it can:
 * its id is a breakpoint again, another definition there ends at its width,
 * or the axis is full.
 */
function refusalToPutBack(
  def: BreakpointDef,
  axis: readonly BreakpointDef[],
  defined: ReadonlySet<string>
): NextlyError | undefined {
  if (defined.has(def.id)) {
    return cannotPutBack(
      `“${def.label}” is one of the site's breakpoints again, so this removal can't be undone.`,
      "defined-again"
    );
  }
  const clash = axis.find(other => widthOf(other) === widthOf(def));
  if (clash !== undefined) {
    return cannotPutBack(
      `“${def.label}” would end at the same width as “${clash.label}”, so this removal can't be undone. Change or remove “${clash.label}” first.`,
      "same-width"
    );
  }
  if (axis.length >= MAX_BREAKPOINTS_PER_AXIS) {
    return cannotPutBack(
      `There's no room to put “${def.label}” back: the site already has ${MAX_BREAKPOINTS_PER_AXIS} breakpoints of that kind. Remove one first.`,
      "axis-full"
    );
  }
  return undefined;
}

/**
 * The set with the removed definitions put back into it as it is now,
 * refusing when one cannot go back (`refusalToPutBack`).
 */
function setWithRemoved(
  now: BreakpointSet | undefined,
  before: BreakpointSet | undefined,
  ids: ReadonlySet<string>
): BreakpointSet {
  const set: BreakpointSet = {
    viewport: [...(now?.viewport ?? [])],
    container: [...(now?.container ?? [])],
  };
  const defined = new Set(breakpointContexts(now).map(context => context.id));
  for (const axis of ["viewport", "container"] as const) {
    for (const def of (before?.[axis] ?? []).filter(def => ids.has(def.id))) {
      const refusal = refusalToPutBack(def, set[axis], defined);
      if (refusal !== undefined) throw refusal;
      set[axis] = insertedByWidth(set[axis], def);
    }
  }
  // The set is stored as the Single's own check reads it, so the undo stores
  // nothing a save through Settings would refuse.
  const { value, issues } = checkStoredBreakpoints(set);
  if (issues.length > 0 || value === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "breakpoint-undo-set-invalid", issues },
    });
  }
  return value;
}

/** What an undo's write stores, planned from one read of the Single. */
interface UndoPlan {
  readonly stored: VersionedSiteStyle;
  readonly breakpoints: BreakpointSet;
  /** The stored class tier with what the removal kept put back. */
  readonly classes?: readonly unknown[];
  readonly ids: ReadonlySet<string>;
  readonly labels: readonly string[];
}

/**
 * The set and shared styles undoing `undone` stores: its definitions back in
 * the set as it is now, and its kept shared styles' values back where none
 * is set. Refused, with nothing written, when a definition cannot go back or
 * an earlier removal still holds one of its ids.
 */
async function planUndo(
  removal: BreakpointRemoval,
  ctx: BreakpointsRouteContext,
  service: BreakpointRemovalService,
  undone: BreakpointRun
): Promise<UndoPlan> {
  const stored = await removal.stored(ctx);
  const now = siteBreakpoints(currentStyle(removal, stored));
  const ids = removedEver(undone);
  const before = removalOf(undone, removal.defaults).before;
  const breakpoints = setWithRemoved(now, before, ids);
  // The removal being undone is not in the way.
  refuseReadding(
    (await service.holding()).filter(held => held.run.id !== undone.id),
    now,
    breakpoints
  );
  const site = await service.keptSharedStyles(undone.id);
  const tier = readStoredJson(stored.classes);
  const classes =
    site?.form === "site"
      ? restoreClasses(
          Array.isArray(tier) ? tier : [],
          removal.defaults?.classes ?? [],
          site.fragment,
          ids
        ).value
      : undefined;
  const labels = [...(before?.viewport ?? []), ...(before?.container ?? [])]
    .filter(def => ids.has(def.id))
    .map(def => def.label);
  return {
    stored,
    breakpoints,
    ...(classes === undefined ? {} : { classes }),
    ids,
    labels,
  };
}

/** What an undo is told when the site's settings changed while it was made. */
const SETTINGS_CHANGED =
  "The site's settings were changed while this removal was being undone. Try again.";

/**
 * Store the undo's set and shared styles in one write, from the version read
 * when it was planned. The undo is dropped again when the write did not
 * land; where whether it landed cannot be read, it is published, so its walk
 * puts back what the stored set defines and the request still fails.
 */
async function writeUndo(
  args: {
    readonly ctx: BreakpointsRouteContext;
    readonly nextly: SiteSettingsDirectApi;
    readonly removal: BreakpointRemoval & {
      readonly cascade: BreakpointCascade;
    };
    readonly service: BreakpointRemovalService;
    readonly undo: BreakpointRun;
  },
  plan: UndoPlan
): Promise<void> {
  const { ctx, removal, service, undo } = args;
  try {
    await writeSiteStyle(
      args.nextly,
      ctx,
      {
        breakpoints: plan.breakpoints,
        ...(plan.classes === undefined ? {} : { classes: plan.classes }),
      },
      versionToWrite(plan.stored)
    );
  } catch (error) {
    const landed = await setLanded(removal, ctx, plan.breakpoints);
    if (landed === false) {
      await service.abandon(undo.id);
      if (isStaleVersion(error)) {
        throw cannotPutBack(SETTINGS_CHANGED, "settings-changed");
      }
      throw error;
    }
    if (landed === undefined) {
      await service.publish(undo.id).catch(() => undefined);
      throw error;
    }
    removal.cascade.logError?.(
      "[page-builder] a breakpoint undo's write threw after its set was " +
        "stored; the undo goes on.",
      { runId: undo.id, error }
    );
  }
}

/**
 * Undo removal `runId`: refused (409) unless it can be undone, with nothing
 * changed; otherwise its set is stored, its shared styles put back, and its
 * documents walked as far as the time allows, answered like a save.
 */
async function undoRemoval(
  req: Request,
  ctx: BreakpointsRouteContext,
  nextly: SiteSettingsDirectApi,
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade }
): Promise<Response> {
  const runId = await readUndo(req);
  const service = removal.cascade.service();
  // The preconditions first: the newest removal, done, not undone yet, within
  // its window. Then the set it stores is planned, reading only; its run is
  // opened with that set recorded, judged again as it opens.
  await service.assertUndoable(runId);
  const undone = await service.runById(runId);
  if (undone === null) {
    throw NextlyError.notFound({
      logContext: { reason: "breakpoint-undo-no-run", runId },
    });
  }
  const plan = await planUndo(removal, ctx, service, undone);
  const undo = await service.undo(runId, runStarterOf(ctx), plan.breakpoints);
  try {
    // Before the set is stored, as a re-add retires the claims on what it
    // defines again (`retireReadded`): the removal gives up its ids.
    await service.retire([...plan.ids]);
  } catch (error) {
    await service.abandon(undo.id);
    throw error;
  }
  await writeUndo({ ctx, nextly, removal, service, undo }, plan);
  await service.publish(undo.id);
  await ctx.audit?.write({
    kind: BREAKPOINT_REMOVAL_UNDONE_AUDIT,
    actorUserId: ctx.user?.id ?? null,
    request: req,
    metadata: {
      runId: undo.id,
      undoes: runId,
      breakpointIds: [...plan.ids].join(","),
      breakpointLabels: plan.labels.join(", "),
    },
  });
  let report: RewriteReport;
  try {
    report = await service.walk(undo.id, {
      deadline: new Date(Date.now() + removal.cascade.walkMs),
    });
  } catch (error) {
    // The set is stored and the undo open: answered as still going, so the
    // caller carries it on through the removal route (or the job does).
    removal.cascade.logError?.(
      "[page-builder] a breakpoint undo's walk failed after its set was " +
        "stored; it is carried on by its route or the removal job.",
      { runId: undo.id, error }
    );
    report = NOT_WALKED;
  }
  const answered = (await undoReport(service, undo, report.finished, () =>
    sharedStylesNow(removal, ctx)
  )) ?? { undoes: runId };
  return removalAnswer(
    undoMessage(answered),
    (state): SiteBreakpointsSaved => ({
      breakpoints: plan.breakpoints,
      removal: state,
    }),
    undo.id,
    report,
    answered
  );
}

/**
 * The route Settings undoes the newest breakpoint removal through, under the
 * permission its save asked for.
 */
export function siteBreakpointUndoRoute(
  removal: BreakpointRemoval & { readonly cascade: BreakpointCascade }
): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: BreakpointsRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SITE_BREAKPOINT_UNDO_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) =>
      undoRemoval(req, ctx, await getCachedNextly(), removal),
  };
}
