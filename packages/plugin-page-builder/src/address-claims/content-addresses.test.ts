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
      startup: () => null,
    });
    expect((await service.addresses("en", { limit: 10 })).paths).toEqual([
      ["blog", "hello"],
    ]);
  });
});
