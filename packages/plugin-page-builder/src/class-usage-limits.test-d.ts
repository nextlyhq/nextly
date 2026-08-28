/**
 * Whether the bounds a rebuild derives under can be omitted.
 *
 * A type-level test rather than a runtime one, because requiredness is not
 * observable at runtime: an omitted argument and an explicitly-passed default
 * produce identical behaviour, so no assertion on a report could separate them.
 * The compiler is the only oracle for this property.
 *
 * Written as an assignment the checker EVALUATES rather than as
 * `@ts-expect-error`, which suppresses whatever error happens to land on the
 * line that follows — including one arriving for an unrelated reason, and
 * including none at all once the rejection stops happening. `RequiredKey` is
 * false exactly when the key admits `undefined`, so a signature that goes back
 * to optional fails this file rather than passing it quietly.
 *
 * This file is `.test-d.ts` rather than `.test.ts` deliberately: the package's
 * `tsconfig.json` excludes test files by glob and its `tsconfig.tests.json`
 * excludes them too, so a `.test.ts` here would be in NO TypeScript program and
 * this file would assert nothing.
 *
 * @module class-usage-limits.test-d
 */
import type { rebuildClassUsageIndex } from "./class-usage-index-rebuild";
import type { maintainClassUsage } from "./class-usage-maintenance";

/** True when `K` must be supplied — that is, when it does not admit `undefined`. */
type RequiredKey<T, K extends keyof T> = undefined extends T[K] ? false : true;

type RebuildIndexArgs = Parameters<typeof rebuildClassUsageIndex>[0];
type MaintainArgs = Parameters<typeof maintainClassUsage>[0];

/**
 * Every boundary a caller invokes demands the bounds explicitly.
 *
 * Omitting them is not neutral: the derivation falls back to the engine
 * defaults while the host may have configured others, and the two directions
 * fail in opposite ways. Raised bounds record a document the renderer draws
 * whole as an undetermined marker instead of its classes; lowered bounds count
 * classes on nodes the page never draws. Neither is visible from the rows.
 */
const rebuildIndexDemandsLimits: RequiredKey<RebuildIndexArgs, "limits"> = true;
const maintainDemandsLimits: RequiredKey<MaintainArgs, "limits"> = true;

/**
 * The positive control, and it is load-bearing.
 *
 * `RequiredKey` returning `true` for everything would satisfy the assertions
 * above without discriminating, so a key that IS optional has to come out
 * `false`.
 *
 * Declared here rather than borrowed from an entry point, because what this
 * control establishes is a property of `RequiredKey` and not of any argument
 * type. Every key on both entry points is required, so borrowing one would
 * mean keeping a key optional to serve a test — and a control that fails when
 * unrelated code tightens its bounds reports on the wrong subject.
 */
interface OptionalKeyProbe {
  required: string;
  optional?: string;
}

const requiredKeyReadsAsRequired: RequiredKey<OptionalKeyProbe, "required"> =
  true;
const optionalKeyReadsAsOptional: RequiredKey<OptionalKeyProbe, "optional"> =
  false;

export type { RebuildIndexArgs, MaintainArgs, OptionalKeyProbe, RequiredKey };
export {
  rebuildIndexDemandsLimits,
  maintainDemandsLimits,
  requiredKeyReadsAsRequired,
  optionalKeyReadsAsOptional,
};
