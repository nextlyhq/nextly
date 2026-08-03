import { expectTypeOf } from "vitest";

import type { ManifestEntry } from "../manifest";
import type { BeginMigrationArgs, SettleArgs } from "../state";

const PLAN = { registryHash: "s", manifestHash: "h" };
const APPLIED: ManifestEntry[] = [
  { kind: "table", from: "comp_hero", to: "fg_hero" },
];

// The rules these shapes exist to enforce are type-level, so they are asserted
// type-level. A runtime test cannot show that an unsafe call fails to compile,
// and a comment claiming a field is required has already proven unenforceable
// here once.

// Both directions carry the plan. A `down` run reverses a recorded plan and
// cannot derive one; an `up` run cannot rely on rebuilding one either, because
// once each rename rewrites its registry pointer a rebuild omits the work
// already done and no longer matches the recorded step positions.
expectTypeOf({
  direction: "down" as const,
  migrationId: "r",
  plan: PLAN,
  appliedManifest: APPLIED,
}).toMatchTypeOf<BeginMigrationArgs>();

expectTypeOf({
  direction: "up" as const,
  migrationId: "r",
  plan: PLAN,
  appliedManifest: APPLIED,
}).toMatchTypeOf<BeginMigrationArgs>();

// Starting a run without the plan it will execute is not a legal shape, in
// either direction.
expectTypeOf({
  direction: "down" as const,
  migrationId: "r",
  plan: PLAN,
}).not.toMatchTypeOf<BeginMigrationArgs>();

expectTypeOf({
  direction: "up" as const,
  migrationId: "r",
  plan: PLAN,
}).not.toMatchTypeOf<BeginMigrationArgs>();

// The identity records the slug set and the plan's own integrity. A caller
// supplying the retired step-list hash instead of the slug hash does not
// typecheck, so the rename cannot be half-applied at a call site.
expectTypeOf({
  direction: "up" as const,
  migrationId: "r",
  plan: { manifestHash: "h", planHash: "p" },
  appliedManifest: APPLIED,
}).not.toMatchTypeOf<BeginMigrationArgs>();

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
