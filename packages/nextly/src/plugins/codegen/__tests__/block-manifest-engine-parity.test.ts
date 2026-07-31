/**
 * The manifest's version bound and the engine's are the same number.
 *
 * Generation refuses what registration refuses, so the bound has to be stated
 * where generation runs. Core states it rather than importing it: reading it
 * from the engine would make every app that installs core carry the block
 * engine so codegen can read one integer, and it points the dependency the
 * wrong way, since the plugin layer builds on core and not the reverse.
 *
 * Restating a value is only safe if it cannot quietly diverge. This is what
 * makes that true — raising the engine's bound without raising core's fails
 * here, rather than shipping a generator that refuses a block the engine
 * accepts. The engine is a development dependency for this file alone.
 */
import { MAX_BLOCK_VERSION } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { MAX_DECLARED_BLOCK_VERSION } from "../block-manifest";

describe("the manifest's block-version bound", () => {
  it("is the bound the engine enforces at registration", () => {
    expect(MAX_DECLARED_BLOCK_VERSION).toBe(MAX_BLOCK_VERSION);
  });
});
