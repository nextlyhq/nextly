/**
 * A plugin's service call made as a plugin-defined person: run under the
 * rules, with no staff user and no API key, inside the person's frame; and
 * every call naming something else as well refused before it runs.
 */
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { runWithCallerScope } from "../auth/caller-scope";
import { currentPrincipal, runAsPrincipal } from "../auth/principal-scope";

import { makePrincipal } from "./principals/principal";
import type { Principal } from "./principals/types";
import {
  resolveServiceOpts as resolve,
  type ServiceOpts,
  wrapCollectionsForPlugin as wrap,
} from "./service-opts";

const deps = { listRoleSlugs: async () => [] as string[] };
const resolveServiceOpts = (opts: ServiceOpts) => resolve(opts, deps);

const person = makePrincipal("accounts:account", "acc_1", { verified: true });
const KEY: AuthenticatedScope = { actorType: "apiKey", permissions: [] };

/** A collection service whose read records the frame it ran in. */
function recordingCollections() {
  const seen: { principal: Principal | null; ctx: unknown }[] = [];
  const collections = {
    findEntryById: vi.fn(async (_slug: string, _id: string, ctx: unknown) => {
      seen.push({ principal: currentPrincipal(), ctx });
      return { id: "1" };
    }),
  };
  return { collections, seen };
}

describe("a plugin service call made as a person", () => {
  it("runs under the rules, with no user and no API key", async () => {
    expect(await resolveServiceOpts({ principal: person })).toEqual({
      overrideAccess: false,
    });
  });

  it("is not judged by the API key the request arrived on", async () => {
    await runWithCallerScope(KEY, async () => {
      expect(await resolveServiceOpts({ principal: person })).toEqual({
        overrideAccess: false,
      });
    });
  });

  it("reaches the service inside the person's frame", async () => {
    const { collections, seen } = recordingCollections();
    await wrap(collections as never, deps).findEntryById("orders", "1", {
      principal: person,
    });
    expect(seen).toEqual([
      { principal: person, ctx: { overrideAccess: false } },
    ]);
  });

  it("runs as no person when it names none, even inside a person's call", async () => {
    const { collections, seen } = recordingCollections();
    await runAsPrincipal(person, () =>
      wrap(collections as never, deps).findEntryById("orders", "1", {
        as: "public",
      })
    );
    expect(seen[0]?.principal).toBeNull();
  });

  it.each([
    ["sets as: system", { as: "system" as const }],
    ["sets as: user", { as: "user" as const }],
    ["sets as: public", { as: "public" as const }],
    ["names a staff user", { user: { id: "u1", email: "u1@x.com" } }],
    ["names an API key", { authenticatedScope: KEY }],
  ])("is refused, and runs nothing, when it %s", async (_label, extra) => {
    const { collections } = recordingCollections();
    await expect(
      wrap(collections as never, deps).findEntryById("orders", "1", {
        principal: person,
        ...extra,
      } as ServiceOpts)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(collections.findEntryById).not.toHaveBeenCalled();
  });

  it("is refused when it names a person built by hand", async () => {
    await expect(
      resolveServiceOpts({ principal: { ...person } as Principal })
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
