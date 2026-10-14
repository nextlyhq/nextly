import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { money } from "../money/money";
import { createInMemoryCatalogueSource } from "../testing/in-memory-catalogue-source";

import { createCatalogueService } from "./catalogue-service";

async function codeOf(
  body: () => Promise<unknown>
): Promise<string | undefined> {
  try {
    await body();
  } catch (error) {
    return NextlyError.is(error) ? String(error.code) : String(error);
  }
  return undefined;
}

describe("the catalogue service's arguments", () => {
  const { source } = createInMemoryCatalogueSource({
    currency: "USD",
    items: [
      {
        reference: "drill",
        name: "Drill",
        price: { kind: "listed", unitPrice: money(12_900, "USD") },
        stock: { kind: "counted", available: 4 },
      },
    ],
  });
  const catalogue = createCatalogueService({ source, currency: "USD" });

  it("refuses an argument it cannot parse as a validation error, never a crash", async () => {
    // Server code calls the service directly, so its arguments are outside
    // input: each method is reached here as server code without types would.
    // A method's parameter is compared both ways, so either method fits here.
    interface Untyped {
      call(input: unknown): Promise<unknown>;
    }
    const methods: Record<string, Untyped> = {
      find: { call: catalogue.find },
      list: { call: catalogue.list },
    };
    for (const [name, method] of Object.entries(methods)) {
      expect(await codeOf(() => method.call(null)), `${name}(null)`).toBe(
        "VALIDATION_ERROR"
      );
      expect(
        await codeOf(() => method.call({ references: ["drill"], cartId: "x" })),
        `${name} with a key it does not know`
      ).toBe("VALIDATION_ERROR");
    }
  });

  it("answers the arguments it accepts", async () => {
    expect(
      (await catalogue.find({ references: ["drill"] })).map(i => i.reference)
    ).toEqual(["drill"]);
    expect((await catalogue.list({})).items.map(i => i.reference)).toEqual([
      "drill",
    ]);
  });
});
