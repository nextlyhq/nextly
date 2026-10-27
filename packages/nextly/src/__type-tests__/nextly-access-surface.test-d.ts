/**
 * What `getNextly().access` offers, as the documented path types it.
 *
 * The runtime `access` namespace carries `check` and `checkApiKey`, and the
 * advice for moving off the deprecated `nextly/auth` guards names both. This
 * pins that the instance `getNextly()` resolves to declares both too, each
 * taking and returning exactly what the namespace does, so an app following
 * that advice compiles. Compiled by `pnpm check-types`.
 */
import type { AccessNamespace } from "../direct-api/namespaces/rbac";
import type { getNextly } from "../init";

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

type Access = Awaited<ReturnType<typeof getNextly>>["access"];

/** Whether `getNextly().access` offers `K` at all. */
type Offers<K extends string> = K extends keyof Access ? true : false;

assertType<Offers<"checkApiKey">>(true);
// The control: the method the instance always declared stays offered.
assertType<Offers<"check">>(true);
// Each is exactly the namespace's own, arguments and result alike.
assertType<Exact<Access, AccessNamespace>>(true);
