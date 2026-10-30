/**
 * Every collection create judges its address where they all meet, before any migration or DDL.
 *
 * The Builder's handler, the root-exported `CollectionService.createCollection` and plugins'
 * `ctx.services.collections.createCollection` all call `CollectionMetadataService.createCollection`.
 * So the address is judged there, once, and before the result mapping that would turn a refusal
 * into a generic message: a check at any one of those doors would leave the others open. A refused
 * address never reaches `generateCollection`, so no migration is written and no DDL runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { judgeAddress } from "../../../../shared/address-rule";
import { ADDRESS_CASES } from "../../../../shared/__tests__/helpers/address-cases";
import { CollectionMetadataService } from "../collection-metadata-service";

let usedAddresses: Record<string, Array<{ id: string; slug: string }>> = {};
const reached = new Error("reached generateCollection");
const generateCollection = vi.fn(async () => {
  throw reached;
});

/** The service's own method over a generator that only records being reached. */
function service(): CollectionMetadataService {
  const instance = Object.create(
    CollectionMetadataService.prototype
  ) as CollectionMetadataService;
  Object.assign(instance, {
    collectionService: { generateCollection },
    // Read by the slug guard: no resource owns the slug, and these addresses are used.
    adapter: {
      // Read when a failed create is turned into a result.
      getCapabilities: () => ({ dialect: "sqlite" }),
      selectOne: vi.fn(async () => null),
      select: vi.fn(async (table: string) => usedAddresses[table] ?? []),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  });
  return instance;
}

/** The refusal's message, or `null` when the create went on to generate the collection. */
async function verdictOf(name: string): Promise<string | null> {
  try {
    await service().createCollection({ name, label: "Thing", fields: [] });
    return null;
  } catch (error) {
    if (error === reached) return null;
    const data = (error as { publicData?: { errors?: { message: string }[] } })
      .publicData;
    return data?.errors?.[0]?.message ?? (error as Error).message;
  }
}

beforeEach(() => {
  usedAddresses = {};
  generateCollection.mockClear();
});

describe("CollectionMetadataService.createCollection, where every collection create meets", () => {
  it.each(ADDRESS_CASES)("gives '%s' the rule's verdict", async address => {
    const refusal = judgeAddress("collection", address);

    expect(await verdictOf(address)).toBe(refusal?.message ?? null);
    expect(generateCollection).toHaveBeenCalledTimes(refusal ? 0 : 1);
  });

  it("refuses an address with the same snake_case form as a Single's, naming both", async () => {
    usedAddresses = { dynamic_singles: [{ id: "s-1", slug: "team-updates" }] };

    expect(await verdictOf("team_updates")).toMatch(
      /^Collection address 'team_updates'.*single 'team-updates'/
    );
    expect(generateCollection).not.toHaveBeenCalled();
  });
});
