/**
 * The document kinds a blocks field may declare: the engine's closed list,
 * checked when the schema is registered, so a field can never be declared
 * for a kind nothing else in the system understands.
 */
import { describe, expect, it } from "vitest";

import { blocksFieldType } from "./blocksField";

function declare(kinds: readonly string[]) {
  return blocksFieldType().validateOptions?.({
    name: "document",
    type: "blocks",
    blocks: { kinds },
  });
}

describe("the kinds a blocks field declares", () => {
  it.each(["page", "pattern", "component", "template"])(
    "accepts a field for %s documents",
    kind => {
      expect(declare([kind])).toBe(true);
    }
  );

  it("refuses a field for region documents, a kind the format no longer has", () => {
    expect(declare(["region"])).toEqual([
      {
        path: "blocks.kinds",
        message:
          "blocks.kinds contains unknown document kinds: region. Accepted: page, pattern, component, template.",
      },
    ]);
  });
});
