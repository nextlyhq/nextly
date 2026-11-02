/**
 * The admin's activity entry carries the server's closed event set, checked by
 * the compiler, so the Team activity card's switch over it covers every event
 * the server can name and a bare string cannot reach it.
 */
import type { ActivityEvent } from "nextly/widget-result";
import { expectTypeOf } from "vitest";

import type { Activity } from "./activity";

type Assignable<A, B> = [A] extends [B] ? true : false;

expectTypeOf<NonNullable<Activity["event"]>>().toEqualTypeOf<ActivityEvent>();
expectTypeOf<
  Assignable<string, NonNullable<Activity["event"]>>
>().toEqualTypeOf<false>();
