import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type {
  CatalogueItem,
  CatalogueSource,
} from "../contracts/catalogue-source";
import { commerceError } from "../errors";
import { money } from "../money/money";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";

import { findItems, listItems } from "./catalogue-read";

async function codeOf(
  body: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : "not a NextlyError";
  }
  return undefined;
}

const drill: CatalogueItem = {
  reference: "drill",
  name: "Drill",
  price: { kind: "listed", unitPrice: money(12_900, "USD") },
  stock: { kind: "counted", available: 4 },
};

function answering(answer: unknown): CatalogueSource {
  return {
    id: "fake",
    find: async () => answer as readonly CatalogueItem[],
    price: async () => [],
  };
}

describe("reading items from a catalogue source", () => {
  it("asks once for every reference, each once, and keys the answer by reference", async () => {
    const asked: string[][] = [];
    const { source } = createInMemoryCatalogueSource({
      currency: "USD",
      items: [drill],
    });
    const found = await findItems(
      {
        ...source,
        find: input => {
          asked.push([...input.references]);
          return source.find(input);
        },
      },
      "USD",
      ["drill", "unknown", "drill"]
    );
    expect(asked).toEqual([["drill", "unknown"]]);
    expect([...found.keys()]).toEqual(["drill"]);
  });

  it("does not ask at all for no references", async () => {
    let calls = 0;
    const source = answering([]);
    await findItems(
      {
        ...source,
        find: async () => {
          calls += 1;
          return [];
        },
      },
      "USD",
      []
    );
    expect(calls).toBe(0);
  });

  it("refuses an answer outside the contract rather than showing it", async () => {
    for (const answer of [
      "not a list",
      [{ ...drill, stock: { kind: "counted", available: -1 } }],
      [{ ...drill, reference: "never-asked" }],
      [drill, drill],
      [{ ...drill, price: { kind: "listed", unitPrice: money(1, "EUR") } }],
    ]) {
      expect(
        await codeOf(() => findItems(answering(answer), "USD", ["drill"]))
      ).toBe("COMMERCE_PROVIDER_CONTRACT");
    }
  });

  it("reports a source that fails to answer by the error's kind, never its message", async () => {
    const failing: CatalogueSource = {
      ...answering([]),
      find: async () => {
        throw new TypeError(
          "fetch failed: https://api.example/items?key=sk_live_secret"
        );
      },
    };
    let caught: unknown;
    try {
      await findItems(failing, "USD", ["drill"]);
    } catch (error) {
      caught = error;
    }
    expect(NextlyError.is(caught) && caught.logContext).toEqual({
      source: "fake",
      method: "find",
      errorKind: "TypeError",
    });
    expect(JSON.stringify(caught)).not.toContain("sk_live_secret");
  });

  it("refuses a listing page that holds nothing yet names a next one", async () => {
    const stuck: CatalogueSource = {
      ...answering([]),
      list: async () => ({ items: [], nextCursor: "again" }),
    };
    expect(
      await codeOf(() => listItems(stuck, "USD", { limit: 10, cursor: null }))
    ).toBe("COMMERCE_PROVIDER_CONTRACT");
    // An empty last page is a catalogue with nothing in it, which is fine.
    const empty: CatalogueSource = {
      ...answering([]),
      list: async () => ({ items: [], nextCursor: null }),
    };
    expect(await listItems(empty, "USD", { limit: 10, cursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("refuses a next cursor a storefront could not follow: the one it was given, empty, or too long", async () => {
    const answeringCursor = (nextCursor: string): CatalogueSource => ({
      ...answering([]),
      list: async () => ({ items: [drill], nextCursor }),
    });
    for (const [given, next] of [
      ["page-2", "page-2"],
      [null, ""],
      [null, "c".repeat(1025)],
    ] as const) {
      expect(
        await codeOf(() =>
          listItems(answeringCursor(next), "USD", { limit: 10, cursor: given })
        )
      ).toBe("COMMERCE_PROVIDER_CONTRACT");
    }
    // A cursor that moves on, at the longest a storefront can pass back, is
    // followed.
    const longest = "c".repeat(1024);
    expect(
      await listItems(answeringCursor(longest), "USD", {
        limit: 10,
        cursor: "page-1",
      })
    ).toEqual({ items: [drill], nextCursor: longest });
  });

  it("calls a source that fails to answer unavailable, and passes on an error it raised", async () => {
    const failing: CatalogueSource = {
      ...answering([]),
      find: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    expect(await codeOf(() => findItems(failing, "USD", ["drill"]))).toBe(
      "COMMERCE_CATALOGUE_UNAVAILABLE"
    );

    const raising: CatalogueSource = {
      ...answering([]),
      find: async () => {
        throw commerceError("COMMERCE_UNKNOWN_CURRENCY");
      },
    };
    expect(await codeOf(() => findItems(raising, "USD", ["drill"]))).toBe(
      "COMMERCE_UNKNOWN_CURRENCY"
    );
  });
});
