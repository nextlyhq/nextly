/**
 * An activity row's `event` is a CLOSED set, checked by the compiler: the type
 * published on `nextly/widget-result`, and the one the producer names events
 * by, so a consumer can switch on it and cover every case.
 *
 * Written as explicit assignability and exact equality rather than
 * `toMatchTypeOf`, which a widened `string` would also satisfy.
 */
import { expectTypeOf } from "vitest";

import type { ActivityEvent } from "../../../domains/widgets/result";
import { activityEventOf } from "../activity-changes";
import type { ActivityLogEntry } from "../activity-log-service";

type Assignable<A, B> = [A] extends [B] ? true : false;

// The published event is exactly these five, and a bare string is not one of them.
expectTypeOf<ActivityEvent>().toEqualTypeOf<
  "created" | "saved" | "published" | "unpublished" | "deleted"
>();
expectTypeOf<Assignable<string, ActivityEvent>>().toEqualTypeOf<false>();

// The producer names events by that same union, on the feed's rows and where it reads them.
expectTypeOf(activityEventOf).returns.toEqualTypeOf<
  ActivityEvent | undefined
>();
expectTypeOf<ActivityLogEntry["event"]>().toEqualTypeOf<
  ActivityEvent | undefined
>();
