import { allBlocks, clearBlocks } from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { box } from "./box";
import { collectionLoop } from "./collection-loop";
import { section } from "./section";

afterEach(() => {
  clearBlocks();
});

describe("the gate blocks are not registered as built-ins", () => {
  it("stays out of the registry until something can render it", () => {
    // Deliberate, and worth a test rather than a comment. Registering these
    // would make validation call the type known while the renderer still drew
    // the unknown-block placeholder for it, which is a worse answer than either
    // one alone: the document passes and the page is wrong.
    //
    // The blocks exist to prove the API can express a container and a repeater,
    // and tests are what proves it. They become built-ins when a renderer can
    // draw them, and this fails the day somebody registers them earlier.
    clearBlocks();
    expect(allBlocks()).toEqual([]);
    for (const block of [section, box, collectionLoop]) {
      expect(block.name).toMatch(/^core\//);
    }
  });
});
