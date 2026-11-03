/**
 * Two of a component's variants sharing a name: a save that creates the clash
 * is refused, and one the stored definition already held is kept, so an
 * unrelated edit to that component still saves.
 */
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { blocksFieldType } from "./blocksField";

function component(variants: Record<string, unknown>) {
  return {
    formatVersion: 1,
    kind: "component",
    nodes: [],
    variants,
  };
}

const clashing = component({
  a: { label: "Featured", overrides: {} },
  b: { label: "featured ", overrides: {} },
});
const distinct = component({
  a: { label: "Featured", overrides: {} },
  b: { label: "Compact", overrides: {} },
});

/** A stored component whose forms both hold `stored`. */
function write(stored: unknown): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "components",
    id: "c1",
    inTransaction: false,
    readStored: async () => ({ kind: "value", value: stored }),
  };
}

async function validate(value: unknown, stored: unknown) {
  const field = blocksFieldType();
  return field.validate?.(value, {
    path: "document",
    field: {
      name: "document",
      type: "blocks",
      blocks: { kinds: ["component"] },
    },
    write: write(stored),
    data: {},
  } as never);
}

describe("variant names on a component save", () => {
  it("refuses a clash the save creates", async () => {
    const result = await validate(clashing, distinct);

    expect(
      Array.isArray(result) ? result.map(issue => issue.code) : result
    ).toEqual(["variant-label-clash"]);
  });

  it("keeps a clash the stored definition already held", async () => {
    expect(await validate(clashing, clashing)).toBe(true);
  });
});
