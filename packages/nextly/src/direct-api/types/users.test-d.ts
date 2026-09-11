/**
 * What the users namespace's by-id arguments may say.
 *
 * `FindUserByIDArgs` is derived from the shared `FindByIDArgs` by omission, so
 * every option the shared type gains is offered here unless it is omitted too —
 * and the users namespace forwards neither the draft overlay nor the lifecycle
 * scope. An option a caller may write that the call then ignores is the
 * misleading surface the omission of `draft` was written to avoid; this pins
 * that `status` is held to the same rule.
 *
 * Evaluated by the checker rather than a `@ts-expect-error` on a call, which
 * would suppress any error on that line and stay green after the option came
 * back.
 *
 * @module direct-api/types/users.test-d
 */
import { expectTypeOf } from "vitest";

import type { FindUserByIDArgs } from "./users";

type Offers<K extends string> = K extends keyof FindUserByIDArgs ? true : false;

expectTypeOf<Offers<"draft">>().toEqualTypeOf<false>();
expectTypeOf<Offers<"status">>().toEqualTypeOf<false>();
// The control: an option the namespace DOES forward stays offered.
expectTypeOf<Offers<"depth">>().toEqualTypeOf<true>();
