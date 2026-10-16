/**
 * The baselines a comparison can start from, resolved on the server.
 *
 * A reader rarely wants "version 7 against version 6" by number. They want the
 * current draft against what is live, or this version against the one before
 * it in the same language. So a comparison names a target and a baseline, and
 * the baseline is resolved here, from the document's own history, rather than
 * by each client working it out from a list it may only have one page of.
 *
 * Baselines are registered. Core registers `previous`, `published` and
 * `draft`; another core feature adds its own (Workflows: "since submitted",
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

import { NextlyError } from "../../errors";
import type { VersionStatus } from "../../schemas/versions/types";

import type { VersionRef } from "./versions-repository";

/** One durable version, as a baseline sees it. */
export interface PartVersion {
  versionNo: number;
  status: VersionStatus;
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
   */
  resolve(context: BaselineContext): number | null | Promise<number | null>;
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
 * none. The context's versions are narrowed to its part first, so no baseline
 * can reach into another language.
 *
 * Throws a validation error naming the known baselines for an unknown name.
 */
export async function resolveComparisonBaseline(
  name: string,
  context: BaselineContext
): Promise<number | null> {
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
  return baseline.resolve({
    ...context,
    versions: context.versions.filter(v => v.locale === context.part),
  });
}

/** The part's latest published version: what its readers are served. */
export function latestPublished(
  versions: readonly PartVersion[]
): PartVersion | undefined {
  return versions.find(v => v.status === "published");
}

/**
 * The part's current draft: its newest draft version saved after its latest
 * publish. Every save of a working draft records a version, so this holds the
 * working draft's content. Undefined when the part has no draft since its
 * latest publish.
 */
export function currentDraft(
  versions: readonly PartVersion[]
): PartVersion | undefined {
  const published = latestPublished(versions)?.versionNo ?? 0;
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
  resolve: ({ versions }) => latestPublished(versions)?.versionNo ?? null,
});

registerComparisonBaseline({
  name: "draft",
  label: "Current draft",
  resolve: ({ versions }) => currentDraft(versions)?.versionNo ?? null,
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
}

/** The pair a request resolves to, and the baseline that chose `from`. */
export interface ResolvedComparison {
  from: number;
  to: number;
  baseline: { name: string; versionNo: number };
}

/**
 * Turn a request into the two versions to compare.
 *
 * Defaults, when the request names no target or no baseline:
 * - a part with a current draft and a published version opens on the draft
 *   against what is published;
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
  const draft = currentDraft(inPart);
  const asksForDraft = request.to === undefined || request.baseline === "draft";
  if (
    asksForDraft &&
    draft === undefined &&
    (request.workingDraftParts ?? []).includes(part)
  ) {
    throw NextlyError.validation({
      errors: [
        {
          path: "baseline",
          code: "NO_BASELINE",
          message:
            "This draft was saved before every save was kept as a version, so it has no version to compare. Save it once and compare again.",
        },
      ],
    });
  }
  const target = request.to ?? draft?.versionNo ?? inPart[0]?.versionNo;
  if (target === undefined) {
    throw NextlyError.notFound({
      logContext: { reason: "comparison-no-versions", part },
    });
  }
  const name =
    request.baseline ??
    (target === draft?.versionNo && latestPublished(inPart)
      ? "published"
      : "previous");

  const from = await resolveComparisonBaseline(name, {
    ref: request.ref,
    part,
    target,
    userId: request.userId,
    versions,
  });
  if (from === null || from === target) {
    throw NextlyError.validation({
      errors: [
        {
          path: "baseline",
          code: "NO_BASELINE",
          message: `Version ${target} has no "${name}" version to compare with.`,
        },
      ],
    });
  }
  return { from, to: target, baseline: { name, versionNo: from } };
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
