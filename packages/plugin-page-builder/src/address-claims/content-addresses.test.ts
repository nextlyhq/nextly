/**
 * The addresses the content route pre-renders are listed only once any
 * start-up pass over the store has finished, so a build run while the passes
 * are still claiming or moving entries never lists a store they have not
 * settled. Boot is not held for the passes: the listing joins one in flight.
 */
import { describe, expect, it, vi } from "vitest";

import type { Claims } from "./claim-store";
import { contentAddressService } from "./content-addresses";

/** A store holding one entry's address, recording when it is read. */
function store() {
  const listEntries = vi.fn(async () => ({
    data: [
      {
        id: "c1",
        claimKey: "k1",
        kind: "address",
        locale: "en",
        path: "/blog/hello",
        holderCollection: "posts",
        holderId: "1",
      },
    ],
    pagination: { total: 1 },
  }));
  const claims = {
    services: { ownCollections: { listEntries }, collections: {} },
    slug: "claims",
    dialect: "sqlite",
  } as unknown as Claims;
  return { claims, listEntries };
}

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; settle: () => void } {
  let settle = (): void => undefined;
  const promise = new Promise<void>(resolve => {
    settle = resolve;
  });
  return { promise, settle };
}

describe("the addresses listed for pre-rendering", () => {
  it("wait for a start-up pass in flight, and read the store only after it", async () => {
    const { claims, listEntries } = store();
    const pass = deferred();
    let running: Promise<void> | null = pass.promise;
    const service = contentAddressService({
      claims,
      defaultLocale: () => "en",
      collections: [],
      holders: ["pages", "posts"],
      entryHolders: async () => ["posts"],
      storesAddress: async () => false,
      startup: () => running,
    });

    let listed: { paths: string[][] } | undefined;
    const listing = service.addresses(undefined, { limit: 10 }).then(result => {
      listed = result;
    });
    // Let every ready continuation run: the listing is still waiting.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listed).toBeUndefined();
    expect(listEntries).not.toHaveBeenCalled();

    pass.settle();
    running = null;
    await listing;
    expect(listed?.paths).toEqual([["blog", "hello"]]);
    expect(listEntries).toHaveBeenCalledTimes(1);
  });

  it("are read at once when no pass is running", async () => {
    const { claims } = store();
    const service = contentAddressService({
      claims,
      defaultLocale: () => "en",
      collections: [],
      holders: ["pages", "posts"],
      entryHolders: async () => ["posts"],
      storesAddress: async () => false,
      startup: () => null,
    });
    expect((await service.addresses("en", { limit: 10 })).paths).toEqual([
      ["blog", "hello"],
    ]);
  });

  it("are the entries' alone, so the pages' addresses never take a share of the limit", async () => {
    const listEntries = vi.fn(async () => ({
      data: [
        {
          id: "c0",
          claimKey: "k0",
          kind: "address",
          locale: "en",
          path: "/about",
          holderCollection: "pages",
          holderId: "p1",
        },
        {
          id: "c1",
          claimKey: "k1",
          kind: "address",
          locale: "en",
          path: "/blog/hello",
          holderCollection: "posts",
          holderId: "1",
        },
      ],
      pagination: { total: 1 },
    }));
    const service = contentAddressService({
      claims: {
        services: { ownCollections: { listEntries }, collections: {} },
        slug: "claims",
        dialect: "sqlite",
      } as unknown as Claims,
      defaultLocale: () => "en",
      collections: [],
      holders: ["pages", "posts"],
      entryHolders: async () => ["posts"],
      storesAddress: async () => false,
    });
    expect((await service.addresses("en", { limit: 1 })).paths).toEqual([
      ["blog", "hello"],
    ]);
    // Narrowed in the read itself, so the limit counts entries only.
    expect(listEntries).toHaveBeenCalledWith(
      "claims",
      expect.objectContaining({
        where: expect.objectContaining({
          holderCollection: { in: ["posts"] },
        }),
        pagination: { limit: 1, page: 1 },
      })
    );
  });

  it("are none, and read nothing, when no collection is served under an address", async () => {
    const { claims, listEntries } = store();
    const service = contentAddressService({
      claims,
      defaultLocale: () => "en",
      collections: [],
      holders: ["pages"],
      entryHolders: async () => [],
      storesAddress: async () => false,
    });
    expect(await service.addresses("en", { limit: 10 })).toEqual({
      paths: [],
      total: 0,
    });
    expect(listEntries).not.toHaveBeenCalled();
  });
});
