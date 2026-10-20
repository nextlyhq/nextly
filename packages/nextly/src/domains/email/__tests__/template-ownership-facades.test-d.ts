import type { nextly } from "../../../direct-api/nextly";
import type { getNextly } from "../../../init";

// The ownership methods are on every public Direct API surface: the instance
// `getNextly()` returns and the module-level `nextly` facade. Compiled by
// `pnpm check-types` (a `.test-d.ts`, which tsconfig doesn't exclude).

type Assignable<A, B> = [A] extends [B] ? true : false;
declare function assertType<T extends true>(proof: T): void;

type Instance = Awaited<ReturnType<typeof getNextly>>["emailTemplates"];
type Facade = (typeof nextly)["emailTemplates"];
type Steps = "override" | "reset" | "compare" | "applyUpdate" | "undoUpdate";

assertType<Assignable<Steps, keyof Instance>>(true);
assertType<Assignable<Steps, keyof Facade>>(true);
// Each takes what the namespace takes.
assertType<
  Assignable<
    Parameters<Instance["applyUpdate"]>[0],
    Parameters<Facade["applyUpdate"]>[0]
  >
>(true);
