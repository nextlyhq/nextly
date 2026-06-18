/**
 * Compile-time tests for codegen-narrowed `PermissionSlug` / `EventName` (D47).
 *
 * Enforced by `tsc --noEmit` (check-types). We deliberately do NOT augment the
 * global `GeneratedTypes` here — that augmentation is global and would narrow
 * the types across the ENTIRE nextly typecheck, breaking every `string`-typed
 * call site. Instead we:
 *   (a) prove the real exported types fall back to `string` in nextly's own
 *       build (no codegen present), so the change is non-breaking; and
 *   (b) prove the conditional PATTERN narrows + rejects non-members, against a
 *       local fake interface.
 * The end-to-end narrowing of the real exports is exercised in the form-builder
 * dogfood (Task 18), where a downstream package augments `GeneratedTypes`.
 */
import { expectTypeOf } from "vitest";

import type { EventName } from "../../events/event-bus";
import type { PermissionSlug } from "../contributions";

// (a) Fallback: with no GeneratedTypes augmentation, both are `string`.
expectTypeOf<PermissionSlug>().toEqualTypeOf<string>();
expectTypeOf<EventName>().toEqualTypeOf<string>();

// tsc-enforced: arbitrary strings remain assignable (back-compat).
const anyPerm: PermissionSlug = "literally-anything";
const anyEvent: EventName = "literally.anything";
declare const someString: string;
const permFromString: PermissionSlug = someString;
const eventFromString: EventName = someString;
void anyPerm;
void anyEvent;
void permFromString;
void eventFromString;

// (b) The conditional PATTERN narrows + rejects non-members (local fake shape).
interface FakeGenerated {
  permissions: { "manage-seo": true; "export-submissions": true };
  events: { "document.published": true; "acme.x.done": true };
}
type NarrowedPerm = FakeGenerated extends { permissions: infer P }
  ? keyof P & string
  : string;
type NarrowedEvent = FakeGenerated extends { events: infer E }
  ? keyof E & string
  : string;

const okPerm: NarrowedPerm = "manage-seo";
const okEvent: NarrowedEvent = "document.published";
void okPerm;
void okEvent;

// @ts-expect-error — "nope" is not in the narrowed permission union.
const badPerm: NarrowedPerm = "nope";
void badPerm;

// @ts-expect-error — "nope.event" is not in the narrowed event union.
const badEvent: NarrowedEvent = "nope.event";
void badEvent;
