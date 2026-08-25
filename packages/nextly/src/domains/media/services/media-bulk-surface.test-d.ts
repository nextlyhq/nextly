/**
 * The bulk surface is pinned by the CHECKER, because the runtime guard has a
 * shape it cannot see.
 *
 * Its companion in `__tests__/revalidate-media.test.ts` enumerates
 * `Object.getOwnPropertyNames(MediaService.prototype)`, which finds a method
 * declared as `async bulkDelete(...)` and finds NOTHING for one declared as a
 * class field — `bulkArchive = async (...) => ...` is an own property of each
 * instance, initialised in the constructor, and never on the prototype. A
 * fan-out written that way would leave both runtime assertions passing while
 * omitting the batch scope: precisely the regression that guard exists to
 * expose, invisible to the instrument meant to expose it.
 *
 * `keyof` does not have that hole. A class field and a prototype method are the
 * same member of the type, so deriving the surface from the type covers both
 * declaration forms and any future one, without constructing the service —
 * which a unit test cannot cheaply do, since it takes a storage adapter, an
 * upload validator, an image processor and a retention runner.
 *
 * Asked as an equality on a mapped type rather than with `@ts-expect-error`,
 * which suppresses ANY error on the line that follows and would keep passing
 * once the code started failing for an unrelated reason.
 */
import { expectTypeOf } from "vitest";

import type { MediaService } from "./media-service";

/**
 * Every PUBLIC member whose name marks it a fan-out.
 *
 * `keyof` on a class type excludes private and protected members, so the
 * per-item helpers the bulk methods delegate to stay out of this by
 * construction rather than by being filtered.
 */
type BulkSurface<T> = {
  [K in keyof T]-?: K extends `bulk${string}` ? K : never;
}[keyof T];

// Adding a bulk method fails HERE, whichever way it is declared. The fix is not
// to widen this line: it is to open a `withMediaRevalidationBatch` scope in the
// new method, then name it here. Without a scope, a fan-out over N rows busts
// the shared `nextly:media` tag N times, which no call site reveals.
expectTypeOf<BulkSurface<MediaService>>().toEqualTypeOf<
  "bulkUpload" | "bulkDelete"
>();
