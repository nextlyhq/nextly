/**
 * The baselines a comparison can start from, resolved on the server.
 *
 * A reader rarely wants "version 7 against version 6" by number. They want the
 * current draft against what is live, or this version against the one before
 * it in the same language. So a comparison names a target and a baseline, and
 * the baseline is resolved here, from the document's own history, rather than
 * by each client working it out from a list it may only have one page of.
 *
 * Baselines are registered. Core registers `previous`, `published`, `draft`
 * and `last-viewed`; another core feature adds its own (Workflows: "since submitted",
 * "since approved") without the history code changing. An explicit pair of
 * version numbers stays available beside them.
 *
 * Every baseline works within one part of the document: a language, or the
 * part with no language. A comparison needs both sides in the same part, and a
 * German version is never English's "previous".
 *
 * @module domains/versions/comparison-baselines
 * @experimental
 */

import { getService } from "../../di";
import { NextlyError } from "../../errors";

import {
  recordsServedContent,
  type RecordedVersionStatus,
} from "./recorded-status";
import { readLastLookedAt } from "./version-views";
import type { VersionRef } from "./versions-repository";

/** One durable version, as a baseline sees it. */
export interface PartVersion {
  versionNo: number;
  status: RecordedVersionStatus;
  /** The part the version belongs to: its language, or null. */
  locale: string | null;
}

/** What a baseline is given to decide from. */
export interface BaselineContext {
  ref: VersionRef;
  /** The part being compared: a language, or null for the part with none. */
  part: string | null;
  /** The version the comparison is about. */
  target: number;
  /** The person comparing, or null for an API key or the system. */
  userId: string | null;
  /** The part's durable versions, newest first. */
  versions: readonly PartVersion[];
  /**
   * Whether the part is served now. A withdrawal records a draft version, so
   * the history alone still shows the last publish as if it were live.
   */
  live: boolean;
  /**
   * Whether the document has the Draft/Published lifecycle. Without it every
   * version was served and none is a draft, whatever its own `status` says.
   */
  lifecycle: boolean;
}

/**
 * A baseline that stands in for the version it named, which is gone: the
 * comparison uses `versionNo`, and says that `replaces` was removed.
 */
export interface BaselineSubstitute {
  versionNo: number;
  /** The version the baseline named, which retention removed. */
  replaces: number;
}

/**
 * A baseline that has nothing to compare with, and says why from what it
 * read: the reason travels with the decision rather than being read again.
 */
export interface BaselineRefusal {
  unavailable: string;
}

/** What a baseline resolved to: a version, and the one it stands in for. */
export interface BaselineChoice {
  versionNo: number;
  replaces?: number;
}

/**
 * A registered baseline.
 *
 * @experimental
 */
export interface ComparisonBaseline {
  /** Its name in a comparison request (`?baseline=`): kebab-case, unique. */
  name: string;
  /** How a reader would name it ("Previous version", "Since approved"). */
  label: string;
  /**
   * The version to compare the target with, or null when there is none (the
   * part's first version has no previous one). May read through the context
   * only; a baseline that needs more (Workflows' pins) reads its own records.
   * A baseline whose version is gone may name a substitute, which the
   * comparison then reports.
   */
  resolve(
    context: BaselineContext
  ):
    | number
    | BaselineSubstitute
    | BaselineRefusal
    | null
    | Promise<number | BaselineSubstitute | BaselineRefusal | null>;
  /**
   * Why there is nothing to compare with, in the reader's terms, when the
   * baseline resolves to nothing or to the target itself (`found`, with the
   * version it stood in for when it substituted one). Without one, the reader
   * is told the version has no such baseline.
   */
  unavailable?(
    context: BaselineContext,
    found: BaselineChoice | null
  ): string | Promise<string>;
}

const BASELINE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const registry = new Map<string, ComparisonBaseline>();

/**
 * Add a baseline. Called once per baseline as its feature loads.
 *
 * Refuses a name that is not kebab-case, and a name already taken: two
 * features answering one name differently would make a comparison mean
 * whichever registered last.
 *
 * @experimental
 */
export function registerComparisonBaseline(baseline: ComparisonBaseline): void {
  if (!BASELINE_NAME.test(baseline.name)) {
    throw NextlyError.invalidInput({
      message: `Comparison baseline name "${baseline.name}" must be kebab-case, such as "since-approved".`,
      logContext: { name: baseline.name },
    });
  }
  if (registry.has(baseline.name)) {
    throw NextlyError.invalidInput({
      message: `A comparison baseline is already registered as "${baseline.name}"; choose another name.`,
      logContext: { name: baseline.name },
    });
  }
  registry.set(baseline.name, baseline);
}

/** Every registered baseline's name, for a request's validation and a picker. */
export function comparisonBaselineNames(): string[] {
  return [...registry.keys()];
}

/**
 * The version a named baseline compares the target with, or null when it has
 * none.
 *
 * Throws a validation error naming the known baselines for an unknown name.
 */
export async function resolveComparisonBaseline(
  name: string,
  context: BaselineContext
): Promise<number | null> {
  const choice = await chooseComparisonBaseline(name, context);
  return choice !== null && "versionNo" in choice ? choice.versionNo : null;
}

/**
 * What a named baseline resolves to, with the version it stands in for when it
 * substituted one. The context's versions are narrowed to its part first, so
 * no baseline can reach into another language.
 */
async function chooseComparisonBaseline(
  name: string,
  context: BaselineContext
): Promise<BaselineChoice | BaselineRefusal | null> {
  const baseline = requireBaseline(name);
  const resolved = await baseline.resolve(narrowToPart(context));
  if (resolved === null) return null;
  return typeof resolved === "number" ? { versionNo: resolved } : resolved;
}

function narrowToPart(context: BaselineContext): BaselineContext {
  return {
    ...context,
    versions: context.versions.filter(v => v.locale === context.part),
  };
}

function requireBaseline(name: string): ComparisonBaseline {
  const baseline = registry.get(name);
  if (!baseline) {
    throw NextlyError.validation({
      errors: [
        {
          path: "baseline",
          code: "INVALID_VALUE",
          message: `"${name}" is not a comparison baseline. Known baselines: ${comparisonBaselineNames().join(", ")}.`,
        },
      ],
    });
  }
  return baseline;
}

/**
 * The part's latest published version: content its readers were served, which
 * without the lifecycle is every version whatever its status. What its readers
 * are served only while the part is live; see `BaselineContext.live`.
 */
export function latestPublished(
  versions: readonly PartVersion[],
  lifecycle: boolean
): PartVersion | undefined {
  return versions.find(v => recordsServedContent(v.status, lifecycle));
}

/**
 * The part's current draft: its newest draft version saved after its latest
 * publish. Every save of a working draft records a version, so this holds the
 * working draft's content. Undefined when the part has no draft since its
 * latest publish.
 */
export function currentDraft(
  versions: readonly PartVersion[],
  lifecycle: boolean
): PartVersion | undefined {
  // Without the lifecycle every version was served, so none is newer than the
  // latest served one and nothing is a draft.
  const published = latestPublished(versions, lifecycle)?.versionNo ?? 0;
  return versions.find(v => v.status === "draft" && v.versionNo > published);
}

registerComparisonBaseline({
  name: "previous",
  label: "Previous version",
  resolve: ({ versions, target }) =>
    versions.find(v => v.versionNo < target)?.versionNo ?? null,
});

registerComparisonBaseline({
  name: "published",
  label: "Currently published",
  // Nothing is currently published in a part that has been withdrawn.
  resolve: ({ versions, live, lifecycle }) =>
    live ? (latestPublished(versions, lifecycle)?.versionNo ?? null) : null,
  unavailable: ({ live, target }) =>
    live
      ? `Version ${target} has no "published" version to compare with.`
      : "Nothing is published in this language now, so there is no published version to compare with.",
});

registerComparisonBaseline({
  name: "draft",
  label: "Current draft",
  resolve: ({ versions, lifecycle }) =>
    currentDraft(versions, lifecycle)?.versionNo ?? null,
});

registerComparisonBaseline({
  name: "last-viewed",
  label: "Last looked at",
  // The furthest version of the reader's previous visit to this part (see
  // `version-views`). When retention has removed it, the nearest older version
  // still kept stands in, and the comparison names the one removed.
  resolve: async ({ ref, part, userId, versions }) => {
    if (userId === null) {
      return {
        unavailable:
          "Only a signed-in person has a version they last looked at.",
      };
    }
    const looked = await readLastLookedAt(getService("adapter"), {
      userId,
      ref,
      part,
    });
    if (looked === null) {
      return {
        unavailable:
          "You have not looked at this part of the document on an earlier visit, so there is no version you last looked at.",
      };
    }
    if (versions.some(v => v.versionNo === looked)) return looked;
    const kept = versions.find(v => v.versionNo < looked);
    return kept
      ? { versionNo: kept.versionNo, replaces: looked }
      : {
          unavailable:
            "The version you last looked at was removed, and no older version is kept.",
        };
  },
  // Only reached with a version in hand that is the target itself; every
  // other refusal came from `resolve`, with the reason it read.
  unavailable: (_context, found) =>
    found?.replaces !== undefined
      ? "The version you last looked at was removed, and the nearest older version kept is this one."
      : "This is the version you last looked at, so nothing has changed since.",
});

/** What a comparison request names, before its pair is resolved. */
export interface ComparisonRequest {
  ref: VersionRef;
  /** The version the comparison is about; absent opens on the default. */
  to?: number;
  /** The baseline to compare it with; absent uses the default. */
  baseline?: string;
  /**
   * The part to open on when `to` is absent: a language, or null for the
   * part with none. With a `to`, the part is that version's own.
   */
  locale?: string | null;
  userId: string | null;
  /**
   * The parts that hold a working draft. A draft saved before every save was
   * recorded as a version has no version to compare, and must not be passed
   * over for older versions as if it did not exist.
   */
  workingDraftParts?: readonly (string | null)[];
  /** Whether a part is served now: read from the document, not its history. */
  partIsLive: (part: string | null) => Promise<boolean>;
  /** Whether the document has the Draft/Published lifecycle. */
  lifecycle: boolean;
}

/** The pair a request resolves to, and the baseline that chose `from`. */
export interface ResolvedComparison {
  from: number;
  to: number;
  /**
   * The baseline that chose `from`. `replaces` names the version it named
   * instead, when retention had removed that one.
   */
  baseline: { name: string; versionNo: number; replaces?: number };
}

/**
 * Turn a request into the two versions to compare.
 *
 * Defaults, when the request names no target or no baseline:
 * - a live part with a current draft and a published version opens on the
 *   draft against what is published;
 * - otherwise the target is compared with the version before it.
 *
 * A part's first version has nothing before it, so that request is refused
 * with `NO_BASELINE` rather than compared with an invented empty side; a reader
 * is shown the version on its own instead.
 *
 * @param versions The document's durable versions, newest first.
 */
export async function resolveComparisonPair(
  request: ComparisonRequest,
  versions: readonly PartVersion[]
): Promise<ResolvedComparison> {
  const part = partOf(request, versions);
  const inPart = versions.filter(v => v.locale === part);
  const draft = currentDraft(inPart, request.lifecycle);
  assertDraftHasVersion(request, part, draft);
  const target = request.to ?? draft?.versionNo ?? inPart[0]?.versionNo;
  if (target === undefined) {
    throw NextlyError.notFound({
      logContext: { reason: "comparison-no-versions", part },
    });
  }
  const live = await request.partIsLive(part);
  const name =
    request.baseline ??
    defaultBaseline(target, draft, live, inPart, request.lifecycle);

  const context: BaselineContext = {
    ref: request.ref,
    part,
    target,
    userId: request.userId,
    versions,
    live,
    lifecycle: request.lifecycle,
  };
  const choice = await chooseComparisonBaseline(name, context);
  if (choice !== null && "unavailable" in choice) {
    throw noBaseline(choice.unavailable);
  }
  if (choice === null || choice.versionNo === target) {
    throw noBaseline(await unavailableMessage(name, context, choice));
  }
  return {
    from: choice.versionNo,
    to: target,
    baseline: {
      name,
      versionNo: choice.versionNo,
      ...(choice.replaces !== undefined ? { replaces: choice.replaces } : {}),
    },
  };
}

/** A comparison refused because one side has nothing to compare with. */
function noBaseline(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "baseline", code: "NO_BASELINE", message }],
  });
}

/**
 * Refuse a request for the current draft when the part's working draft was
 * saved before every save was kept as a version: there is no version holding
 * it, and older versions must not be passed off as the draft.
 */
function assertDraftHasVersion(
  request: ComparisonRequest,
  part: string | null,
  draft: PartVersion | undefined
): void {
  const asksForDraft = request.to === undefined || request.baseline === "draft";
  if (
    asksForDraft &&
    draft === undefined &&
    (request.workingDraftParts ?? []).includes(part)
  ) {
    throw noBaseline(
      "This draft was saved before every save was kept as a version, so it has no version to compare. Save it once and compare again."
    );
  }
}

/**
 * The baseline a request that names none compares with: what is live, for a
 * live part's current draft that has a published version; otherwise the
 * version before the target.
 */
function defaultBaseline(
  target: number,
  draft: PartVersion | undefined,
  live: boolean,
  inPart: readonly PartVersion[],
  lifecycle: boolean
): string {
  return target === draft?.versionNo &&
    live &&
    latestPublished(inPart, lifecycle)
    ? "published"
    : "previous";
}

/** Why a baseline has nothing to compare with, in its own words if it has them. */
async function unavailableMessage(
  name: string,
  context: BaselineContext,
  found: BaselineChoice | null
): Promise<string> {
  const baseline = requireBaseline(name);
  return baseline.unavailable
    ? baseline.unavailable(narrowToPart(context), found)
    : `Version ${context.target} has no "${name}" version to compare with.`;
}

/** The part a request compares: its target's own, or the one it names. */
function partOf(
  request: ComparisonRequest,
  versions: readonly PartVersion[]
): string | null {
  if (request.to === undefined) return request.locale ?? null;
  const target = versions.find(v => v.versionNo === request.to);
  if (!target) {
    throw NextlyError.notFound({
      logContext: { reason: "comparison-target-missing", to: request.to },
    });
  }
  return target.locale;
}
