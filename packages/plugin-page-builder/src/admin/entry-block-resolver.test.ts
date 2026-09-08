import { getBlock, registerBlocks } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { describe, expect, it } from "vitest";

import { entryBlockResolver } from "./entry-block-resolver";

/*
 * Nothing here mocks the engine.
 *
 * The registry is real, and in a fresh test module it is genuinely EMPTY —
 * which is the exact state the entry screen renders in, because
 * `ensureCoreBlocksRegistered()` runs inside `BlocksEditor` and nowhere else.
 * A mock would have had to assert that emptiness rather than observe it, and
 * would then have gone on passing after the real registry stopped behaving that
 * way.
 *
 * The order of the two tests below matters — the second one registers a block —
 * so the first asserts its own precondition. Reordered, it fails loudly instead
 * of passing for the wrong reason.
 */
describe("entryBlockResolver", () => {
  it("resolves a core block while the registry is empty", () => {
    // The precondition, observed rather than assumed. This is the whole reason
    // the resolver exists: on the entry screen nothing has been registered.
    expect(getBlock("core/text")).toBeUndefined();

    expect(entryBlockResolver().get("core/text")).toBeDefined();
  });

  it("answers undefined for a type nobody defines", () => {
    expect(
      entryBlockResolver().get("acme/nothing-defines-this")
    ).toBeUndefined();
  });

  it("prefers a definition the host registered over the core one", () => {
    const core = coreBlocks.find(block => block.name === "core/text");
    if (!core) throw new Error("core/text is missing from coreBlocks");

    // Derived from the real definition rather than written as a literal, so it
    // stays a valid block as the definition shape changes.
    const hostVersion = { ...core, description: "the host's own text block" };
    registerBlocks([hostVersion], { source: "test-host" });

    expect(entryBlockResolver().get("core/text")).toBe(hostVersion);
  });
});
