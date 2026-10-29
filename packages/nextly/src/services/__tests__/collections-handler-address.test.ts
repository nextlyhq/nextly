/**
 * The Builder's collection create judges its address before the metadata service builds the table.
 *
 * The create registers its row after the DDL runs, so a refusal made at registration would leave a
 * `dc_<slug>` table behind. These drive the handler's own `createCollection` over a metadata service
 * that records whether it was reached: a refused address must never reach it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let usedAddresses: Record<string, Array<{ id: string; slug: string }>> = {};

const adapter = {
  selectOne: vi.fn(async () => null),
  select: vi.fn(async (table: string) => usedAddresses[table] ?? []),
};

vi.mock("../../di/container", () => ({
  container: {
    has: vi.fn((key: string) => key === "adapter"),
    get: vi.fn(() => adapter),
  },
}));

import { judgeAddress } from "../../shared/address-rule";
import { ADDRESS_CASES } from "../../shared/__tests__/helpers/address-cases";
import { CollectionsHandler } from "../collections-handler";

const createCollection = vi.fn(async () => ({ success: true }));

/** The handler's own method over a metadata service that only records the call. */
function handler(): CollectionsHandler {
  const instance = Object.create(
    CollectionsHandler.prototype
  ) as CollectionsHandler;
  Object.assign(instance, { metadataService: { createCollection } });
  return instance;
}

async function verdictOf(name: string): Promise<string | null> {
  try {
    await handler().createCollection({ name, label: "Thing", fields: [] });
    return null;
  } catch (error) {
    const data = (error as { publicData?: { errors?: { message: string }[] } })
      .publicData;
    return data?.errors?.[0]?.message ?? (error as Error).message;
  }
}

beforeEach(() => {
  usedAddresses = {};
  createCollection.mockClear();
});

describe("the Builder's collection create", () => {
  it.each(ADDRESS_CASES)(
    "gives '%s' the rule's verdict before the table is built",
    async address => {
      const refusal = judgeAddress("collection", address);

      expect(await verdictOf(address)).toBe(refusal?.message ?? null);
      expect(createCollection).toHaveBeenCalledTimes(refusal ? 0 : 1);
    }
  );

  it("refuses an address with the same snake_case form as a Single's, naming both", async () => {
    usedAddresses = { dynamic_singles: [{ id: "s-1", slug: "team-updates" }] };

    expect(await verdictOf("team_updates")).toMatch(
      /^Collection address 'team_updates'.*single 'team-updates'/
    );
    expect(createCollection).not.toHaveBeenCalled();
  });
});
