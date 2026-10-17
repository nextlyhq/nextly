/**
 * The release capabilities the admin reads, asserted at the type level.
 *
 * The server sends `can` with every release, and a control the admin cannot
 * name is a control it never draws: nothing throws when the admin's type is
 * missing a capability, the button simply never appears. Asserted on the
 * admin's own `Release` rather than on the import, so a type here that stopped
 * being the server's would fail this file.
 *
 * `include: ["src/**\/*"]` covers this file, so `check-types` enforces it.
 */
import type { ReleaseCapabilities as ServerReleaseCapabilities } from "nextly/schemas";
import { expectTypeOf } from "vitest";

import type { Release } from "@admin/types/releases";

type AdminReleaseCapabilities = NonNullable<Release["can"]>;

// Exactly the server's type: neither a capability it lacks nor one it adds.
expectTypeOf<AdminReleaseCapabilities>().toEqualTypeOf<ServerReleaseCapabilities>();

// And the capabilities the admin's controls are drawn from, by name, so the
// assertion above cannot pass by both sides losing one.
expectTypeOf<keyof AdminReleaseCapabilities>().toEqualTypeOf<
  "schedule" | "cancel" | "addMember" | "removeMember" | "publishNow"
>();
