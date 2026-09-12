/**
 * The field-function registry is REPLACED from the config in force.
 *
 * A reload re-reads the config and installs what it describes at the reload's
 * commit point. Two things have to be true of that install. An entity the new
 * config no longer declares must stop deciding anything: a collection dropped
 * from `nextly.config.ts` keeps its registry row and its table so an orphan
 * sweep can find them, so it stays addressable, and a rule left behind here
 * would keep running. And nothing may be installed by a reload that does not
 * commit, or a rule from a config the process refused would decide writes
 * while every other service ran the previous one.
 */
import { describe, expect, it } from "vitest";

import {
  getFieldFunctions,
  registerFieldFunctions,
  replaceFieldFunctions,
} from "../field-level-registry";

describe("replaceFieldFunctions", () => {
  it("drops an entity the new config no longer declares", () => {
    registerFieldFunctions("collection", "kept", [
      { name: "tone", type: "text", defaultValue: () => "before" },
    ]);
    registerFieldFunctions("collection", "removed", [
      { name: "tone", type: "text", defaultValue: () => "gone" },
    ]);

    replaceFieldFunctions([
      {
        kind: "collection",
        slug: "kept",
        fields: [{ name: "tone", type: "text", defaultValue: () => "after" }],
      },
    ]);

    expect(
      getFieldFunctions("collection", "kept")?.tone?.defaultValue?.({})
    ).toBe("after");
    // Not merely stale: absent, so nothing of it runs.
    expect(getFieldFunctions("collection", "removed")).toBeUndefined();
  });

  it("keeps the kinds apart", () => {
    replaceFieldFunctions([
      {
        kind: "collection",
        slug: "shared",
        fields: [{ name: "tone", type: "text", defaultValue: () => "coll" }],
      },
      {
        kind: "single",
        slug: "shared",
        fields: [{ name: "tone", type: "text", defaultValue: () => "single" }],
      },
    ]);

    expect(
      getFieldFunctions("collection", "shared")?.tone?.defaultValue?.({})
    ).toBe("coll");
    expect(
      getFieldFunctions("single", "shared")?.tone?.defaultValue?.({})
    ).toBe("single");
  });

  it("installs nothing for an entity that declares no functions", () => {
    registerFieldFunctions("collection", "plain", [
      { name: "tone", type: "text", defaultValue: () => "x" },
    ]);
    replaceFieldFunctions([
      {
        kind: "collection",
        slug: "plain",
        fields: [{ name: "tone", type: "text" }],
      },
    ]);
    expect(getFieldFunctions("collection", "plain")).toBeUndefined();
  });
});
