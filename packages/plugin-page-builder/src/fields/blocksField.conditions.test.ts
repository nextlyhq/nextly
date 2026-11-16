/**
 * A block's visibility conditions on a page save: a condition the engine
 * refuses by its shape is refused when the save brings it, and kept when the
 * stored page already held it, so an unrelated edit to that page still saves.
 */
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { blocksFieldType } from "./blocksField";

function page(conditions: unknown, title = "Hello") {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: { text: title, level: 2 },
      },
      {
        id: "box",
        type: "core/box",
        version: 1,
        props: {},
        visibility: { conditions },
      },
    ],
  };
}

/** An operator conditions never had, as an older writer stored one. */
const unknownOp = [[{ field: "tier", op: "matches", value: "v.*" }]];
const known = [[{ field: "tier", op: "equals", value: "vip" }]];

/** A stored page whose forms both hold `stored`. */
function write(stored: unknown): PluginFieldWrite {
  return {
    kind: "collection",
    slug: "pages",
    id: "p1",
    inTransaction: false,
    readStored: async () => ({ kind: "value", value: stored }),
  };
}

async function validate(value: unknown, stored: unknown) {
  const field = blocksFieldType();
  return field.validate?.(value, {
    path: "content",
    field: { name: "content", type: "blocks" },
    write: write(stored),
    data: {},
  } as never);
}

const codes = (result: unknown) =>
  Array.isArray(result)
    ? result.map((issue: { code: string }) => issue.code)
    : result;

describe("visibility conditions on a page save", () => {
  it("refuses an unknown operator the save brings", async () => {
    expect(codes(await validate(page(unknownOp), page(known)))).toEqual([
      "condition-op-unknown",
    ]);
  });

  it("keeps an unknown operator the stored page already held, through an unrelated edit", async () => {
    expect(await validate(page(unknownOp, "Changed"), page(unknownOp))).toBe(
      true
    );
  });
});
