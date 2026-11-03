/**
 * The surface of `ctx.services.ownCollections`, against a stand-in facade so
 * each assertion is about what reaches the service rather than what a database
 * returns: the refusal comes before any call, the call runs as the system with
 * the grant attached, and nothing a caller passes at runtime widens it.
 */
import { describe, expect, it, vi } from "vitest";

import { currentPrincipal, runAsPrincipal } from "../auth/principal-scope";
import type { CollectionService } from "../services/collections/collection-service";
import type { RequestContext } from "../services/shared";
import { readHooksWaived } from "../services/collections/trust-grant";

import { ownCollectionReads, type OwnCollectionReadOpts } from "./service-opts";
import type { Principal } from "./principals/types";

function standIn() {
  const seen: { method: string; context: RequestContext }[] = [];
  const principals: (Principal | null)[] = [];
  const record =
    (method: string, result: unknown) =>
    (...args: unknown[]): Promise<unknown> => {
      seen.push({ method, context: args[args.length - 1] as RequestContext });
      principals.push(currentPrincipal());
      return Promise.resolve(result);
    };
  const service = {
    listEntries: vi.fn(record("listEntries", { data: [], pagination: {} })),
    findEntryById: vi.fn(record("findEntryById", { id: "1" })),
    count: vi.fn(record("count", 0)),
    group: vi.fn(record("group", { buckets: [], truncated: false })),
  };
  return {
    service,
    seen,
    principals,
    facade: service as unknown as CollectionService,
  };
}

describe("ctx.services.ownCollections", () => {
  it("refuses a collection the plugin did not declare before calling the service", async () => {
    const { service, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);

    await expect(reads.listEntries("posts")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    await expect(reads.findEntryById("posts", "1")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    await expect(reads.count("posts")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    await expect(reads.group("posts", { groupBy: "kind" })).rejects.toThrow(
      /not a collection this plugin declared/
    );
    expect(service.listEntries).not.toHaveBeenCalled();
    expect(service.findEntryById).not.toHaveBeenCalled();
    expect(service.count).not.toHaveBeenCalled();
    expect(service.group).not.toHaveBeenCalled();
  });

  it("calls each read as the system, carrying a grant for exactly the declared collections", async () => {
    const { seen, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);

    await reads.listEntries("ledger");
    await reads.findEntryById("ledger", "1");
    await reads.count("ledger");
    await reads.group("ledger", { groupBy: "kind" });

    expect(seen.map(call => call.method)).toEqual([
      "listEntries",
      "findEntryById",
      "count",
      "group",
    ]);
    for (const { context } of seen) {
      expect(context.overrideAccess).toBe(true);
      expect(context.user).toBeUndefined();
      expect(readHooksWaived(context.hookExemptRead, "ledger")).toBe(true);
      expect(readHooksWaived(context.hookExemptRead, "posts")).toBe(false);
    }
  });

  it("drops a person named at runtime past the published options", async () => {
    const { seen, principals, facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);
    // A caller ignoring the type: `as`, `user` and a principal must not travel.
    const smuggled = {
      as: "user",
      user: { id: "u1", email: "u1@example.com" },
      principal: { id: "p1" },
      locale: "en",
    } as unknown as OwnCollectionReadOpts;

    const person = { id: "p-outer" } as unknown as Principal;
    await runAsPrincipal(person, () =>
      reads.listEntries("ledger", {}, smuggled)
    );

    expect(seen[0]?.context.user).toBeUndefined();
    expect(seen[0]?.context.overrideAccess).toBe(true);
    expect(seen[0]?.context.locale).toBe("en");
    // The enclosing request's person is cleared for the read.
    expect(principals[0]).toBeNull();
  });

  it("is frozen, so no member can be swapped for one without the check", () => {
    const { facade } = standIn();
    const reads = ownCollectionReads(facade, ["ledger"]);
    expect(Object.isFrozen(reads)).toBe(true);
  });

  it("grants nothing when built for no collections", async () => {
    const { service, facade } = standIn();
    const reads = ownCollectionReads(facade, []);
    await expect(reads.count("ledger")).rejects.toThrow(
      /not a collection this plugin declared/
    );
    expect(service.count).not.toHaveBeenCalled();
  });
});
