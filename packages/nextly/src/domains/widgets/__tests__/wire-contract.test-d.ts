/**
 * The dashboard wire contract is STRICT, checked by the compiler.
 *
 * This endpoint's slot type was once `{ ok: boolean; result?: unknown; error?:
 * string }` on the server while the admin declared the discriminated union
 * below and drew from it. Both descriptions were of one HTTP response, and the
 * admin's was the stronger of the two, so every consumer relied on a guarantee
 * the producer's own type did not make. The shapes asserted UNASSIGNABLE here
 * are exactly the ones that looser declaration allowed.
 *
 * Written as explicit assignability rather than `toMatchTypeOf`, which is
 * satisfied by a partial match and so would pass for a slot missing the very
 * field each case is about.
 */
import { expectTypeOf } from "vitest";

import type { WidgetResult, WidgetSlot } from "../result";

type Assignable<A, B> = [A] extends [B] ? true : false;

const listResult: WidgetResult = { op: "list", items: [] };

// What a producer may send.
expectTypeOf<
  Assignable<{ ok: true; result: WidgetResult }, WidgetSlot>
>().toEqualTypeOf<true>();
expectTypeOf<
  Assignable<{ ok: false; error: string }, WidgetSlot>
>().toEqualTypeOf<true>();

// What it may NOT: success without an answer, failure without a reason.
expectTypeOf<Assignable<{ ok: true }, WidgetSlot>>().toEqualTypeOf<false>();
expectTypeOf<Assignable<{ ok: false }, WidgetSlot>>().toEqualTypeOf<false>();

// The exact shape the server used to declare. Its whole point is that this is
// no longer a description of a slot.
expectTypeOf<
  Assignable<{ ok: boolean; result?: unknown; error?: string }, WidgetSlot>
>().toEqualTypeOf<false>();

// A success slot's result is a WidgetResult, not `unknown` -- the promise the
// admin's copy made and the server's did not.
declare const slot: WidgetSlot;
if (slot.ok) {
  expectTypeOf(slot.result).toEqualTypeOf<WidgetResult>();
} else {
  expectTypeOf(slot.error).toEqualTypeOf<string>();
}

void listResult;
