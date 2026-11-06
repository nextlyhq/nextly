/**
 * What a host of the Shared styles tab implements, as `@nextlyhq/builder/shell`
 * publishes it.
 *
 * `remove` keeps the return type it shipped with, so a consumer reading its
 * answer as words is unchanged, and a host written against it still compiles.
 * Whether a refusal says the style is used travels through the optional
 * `removeWithReason`, whose answer's type the entry point exports. Compiled by
 * the package's type check: a widened `remove`, or a missing export, fails it.
 */
import type { SharedStyleRefusal, SharedStylesAccess } from "./shell";

/** True only when `A` and `B` are the same type, not merely assignable. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

/** Compiles only for `true`: each use below states one fact of the contract. */
function holds<Fact extends true>(): Fact | undefined {
  return undefined;
}

holds<
  Same<ReturnType<SharedStylesAccess["remove"]>, Promise<string | undefined>>
>();

holds<
  Same<
    SharedStylesAccess["removeWithReason"],
    | ((ids: readonly string[]) => Promise<SharedStyleRefusal | undefined>)
    | undefined
  >
>();

/** A host written before the in-use signal: `remove` alone, answering words. */
export const olderHost: SharedStylesAccess = {
  usage: async () => ({ whole: true, mayLock: false, styles: new Map() }),
  uses: async () => ({
    items: [],
    total: 0,
    hidden: 0,
    hasNext: false,
    complete: true,
  }),
  lock: async () => undefined,
  remove: async () => "Nothing was removed.",
};
