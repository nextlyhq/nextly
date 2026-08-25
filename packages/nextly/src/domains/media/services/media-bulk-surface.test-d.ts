/**
 * The bulk surface of BOTH media services, pinned by the checker.
 *
 * There are two, and the second is the one that gets forgotten: the unified
 * `MediaService` is built by DI, while `services/media.ts` is reached directly
 * by the published `nextly/actions` subpath and by `ServiceContainer.media`,
 * with no DI at all. Each has its own bulk fan-out, and a scope added to one
 * leaves the other invalidating the shared `nextly:media` tag once per file.
 *
 * `keyof` is what makes this complete across DECLARATION forms. The runtime
 * companion in `__tests__/revalidate-media.test.ts` inspects a constructed
 * instance so it can read a class field's source, but it can only check the
 * members it finds; this file is what fails when a bulk member is ADDED,
 * whether it is written as `async bulkArchive(...)` or as
 * `bulkArchive = async (...) => ...`, because both are the same member of the
 * type.
 *
 * Asked as an equality on a mapped type rather than with `@ts-expect-error`,
 * which suppresses ANY error on the line that follows and would keep passing
 * once the code started failing for an unrelated reason.
 */
import { expectTypeOf } from "vitest";

import type { MediaService as LegacyMediaService } from "../../../services/media";

import type { MediaService } from "./media-service";

/**
 * Every PUBLIC member whose name marks it a fan-out.
 *
 * `keyof` on a class type excludes private and protected members, so the
 * per-item helpers these methods delegate to stay out of this by construction
 * rather than by being filtered.
 */
type BulkSurface<T> = {
  [K in keyof T]-?: K extends `bulk${string}` ? K : never;
}[keyof T];

/** The same, for the legacy service, whose fan-outs are named `*Bulk`. */
type BulkSuffixSurface<T> = {
  [K in keyof T]-?: K extends `${string}Bulk` ? K : never;
}[keyof T];

// Adding a bulk member fails HERE, whichever way it is declared. The fix is not
// to widen these lines: it is to open a `withMediaRevalidationBatch` scope in
// the new method, then name it. Without a scope, a fan-out over N rows busts
// the shared `nextly:media` tag N times, which no call site reveals.
expectTypeOf<BulkSurface<MediaService>>().toEqualTypeOf<
  "bulkUpload" | "bulkDelete"
>();

expectTypeOf<BulkSuffixSurface<LegacyMediaService>>().toEqualTypeOf<
  "uploadMediaBulk" | "deleteMediaBulk"
>();
