/**
 * Reading a system resource through the one decision, over a table of actors,
 * with and without the access-control service.
 *
 * The property that separates the reader from a plausible broken one is the
 * grant alone deciding: a key made by a super-admin carries that role's name
 * and is still refused without its own grant, a super-admin passes with no
 * grant at all, and without the service a signed-in user is refused while a
 * key keeps its scope's answer.
 */
import { describe, expect, it } from "vitest";

import { makePrincipal } from "../../plugins/principals/principal";

import {
  keyActor,
  principalActor,
  systemActor,
  userActor,
  visitorActor,
  type Actor,
  type PermissionGrant,
} from "./actor";
import { recordingDeviations } from "./deviations";
import { readsSystemResource } from "./system-resource-read";

const read = (resource: string): PermissionGrant => ({
  slug: `read-${resource}`,
  action: "read",
  resource,
});

const actors: Record<string, Actor> = {
  system: systemActor(),
  visitor: visitorActor(),
  // A visitor whose permissions grant both reads, as a Public role could:
  // the decision reads a visitor's grants like anyone else's.
  "visitor-granted": visitorActor([read("media"), read("users")]),
  principal: principalActor(makePrincipal("members:member", "m1", {})),
  "user-media": userActor({
    userId: "u1",
    roles: ["editor"],
    permissions: [read("media")],
  }),
  "user-none": userActor({ userId: "u2", roles: ["editor"], permissions: [] }),
  "super-admin": userActor({
    userId: "u3",
    roles: ["super-admin"],
    permissions: [],
  }),
  "key-users": keyActor({
    keyId: "k1",
    userId: "u1",
    roles: ["editor"],
    superAdmin: false,
    permissions: [read("users")],
  }),
  // Made by a super-admin, so it carries that role's name, but holds no grant.
  "key-super-admin-maker": keyActor({
    keyId: "k2",
    userId: "u3",
    roles: ["super-admin"],
    superAdmin: false,
    permissions: [],
  }),
};

/** [actor, resource, with the service, without it] */
const table: [string, string, boolean, boolean][] = [
  ["system", "media", true, true],
  ["system", "users", true, true],
  ["visitor", "media", false, false],
  ["visitor", "users", false, false],
  ["visitor-granted", "media", true, true],
  ["principal", "media", false, false],
  ["user-media", "media", true, false],
  ["user-media", "users", false, false],
  ["user-none", "media", false, false],
  ["super-admin", "media", true, false],
  ["super-admin", "users", true, false],
  ["key-users", "users", true, true],
  ["key-users", "media", false, false],
  ["key-super-admin-maker", "users", false, false],
  ["key-super-admin-maker", "media", false, false],
];

describe("readsSystemResource", () => {
  for (const [name, resource, withService, withoutService] of table) {
    it(`${name} reading ${resource}: ${withService} with the service, ${withoutService} without`, async () => {
      const actor = actors[name];
      expect(
        await readsSystemResource(actor, { resource, serviceRegistered: true })
      ).toBe(withService);
      expect(
        await readsSystemResource(actor, { resource, serviceRegistered: false })
      ).toBe(withoutService);
    });
  }

  it("asks every actor kind the table names", () => {
    // POPULATION CONTROL: each kind of actor is in the table, so a kind the
    // reader mishandles cannot be missing from it.
    const kinds = new Set(table.map(([name]) => actors[name].kind));
    expect([...kinds].sort()).toEqual(
      ["key", "principal", "system", "user", "visitor"].sort()
    );
  });
});

describe("the deviation it records", () => {
  it("names `no-service` only where the service's absence changed the answer", async () => {
    const read = (name: string, serviceRegistered: boolean) =>
      recordingDeviations(() =>
        readsSystemResource(actors[name], {
          resource: "media",
          serviceRegistered,
        })
      );
    // A user the decision admits, refused without the service: recorded.
    expect((await read("user-media", false)).deviations).toEqual([
      "no-service",
    ]);
    // A user the decision refuses anyway: the answer did not change.
    expect((await read("user-none", false)).deviations).toEqual([]);
    // With the service, and for a key without it, nothing deviates.
    expect((await read("user-media", true)).deviations).toEqual([]);
    expect((await read("key-users", false)).deviations).toEqual([]);
  });
});
