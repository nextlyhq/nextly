import { expectTypeOf } from "vitest";

import type { ManifestEntry } from "../manifest";
import type { BeginMigrationArgs, SettleArgs } from "../state";

const PLAN = { manifestHash: "h", planHash: "p" };
const APPLIED: ManifestEntry[] = [
  { kind: "table", from: "comp_hero", to: "fg_hero" },
];

// The rules these unions exist to enforce are type-level, so they are asserted
// type-level. A runtime test cannot show that an unsafe call fails to compile,
// and a comment claiming a field is required has already proven unenforceable
// here once.

// A `down` run reverses a recorded plan and cannot derive one, so the plan is
// not optional for it.
expectTypeOf<BeginMigrationArgs>().toMatchTypeOf<
  { direction: "up" } | { direction: "down" }
>();

expectTypeOf({
  direction: "down" as const,
  migrationId: "r",
  plan: PLAN,
  appliedManifest: APPLIED,
}).toMatchTypeOf<BeginMigrationArgs>();

// Without the plan, a down run is not a legal argument shape.
expectTypeOf({
  direction: "down" as const,
  migrationId: "r",
  plan: PLAN,
}).not.toMatchTypeOf<BeginMigrationArgs>();

// An up run builds its plan from registry rows, so it carries none in.
expectTypeOf({
  direction: "up" as const,
  migrationId: "r",
  plan: PLAN,
}).toMatchTypeOf<BeginMigrationArgs>();

// Settling at the migrated generation is the last moment the plan can be
// recorded, and a rollback has no other source for it.
expectTypeOf({
  generation: "field-groups-v2" as const,
  appliedManifest: APPLIED,
}).toMatchTypeOf<SettleArgs>();

expectTypeOf({
  generation: "field-groups-v2" as const,
}).not.toMatchTypeOf<SettleArgs>();

// Settling back at legacy ends a reversal; there is nothing left to reverse.
expectTypeOf({ generation: "legacy" as const }).toMatchTypeOf<SettleArgs>();
