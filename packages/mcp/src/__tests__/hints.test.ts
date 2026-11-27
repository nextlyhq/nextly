/**
 * Every served tool's four hints, compared with what its operation's risk
 * level and effects say, from an expected table written out by hand rather
 * than computed by the code under test.
 */
import { describe, expect, it } from "vitest";

import { hintsFor } from "../hints";

import { fixtureToolSet } from "./fixtures";

/** The hints each fixture tool must carry: [readOnly, destructive, idempotent, openWorld]. */
const EXPECTED: Readonly<
  Record<string, readonly [boolean, boolean, boolean, boolean]>
> = {
  // read: changes nothing, so read-only and idempotent.
  find_entries: [true, false, true, false],
  get_entry: [true, false, true, false],
  get_thing: [true, false, true, false],
  get_renamed: [true, false, true, false],
  // draft: writes, so never read-only; idempotent only when it says so.
  create_draft: [false, false, false, false],
  update_draft: [false, false, true, false],
  // change: an update that can be undone, and a delete that destroys.
  update_thing: [false, false, true, false],
  delete_thing: [false, true, true, false],
  // critical: reaching outside the site is open-world.
  run_webhook: [false, false, false, true],
  purge_things: [false, true, false, true],
};

describe("hints from the risk level", () => {
  it("covers every served tool, so no tool goes unchecked", () => {
    const served = fixtureToolSet()
      .tools.map(tool => tool.name)
      .sort();
    expect(served).toEqual(Object.keys(EXPECTED).sort());
  });

  it("sets all four hints on every tool, each as the table says", () => {
    for (const tool of fixtureToolSet().tools) {
      const [readOnlyHint, destructiveHint, idempotentHint, openWorldHint] =
        EXPECTED[tool.name] ?? [];
      // Exactly the four keys, each a boolean: none left to the protocol's defaults.
      expect(
        Object.keys(tool.definition.annotations ?? {}).sort(),
        tool.name
      ).toEqual([
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
        "readOnlyHint",
      ]);
      expect(tool.definition.annotations, tool.name).toEqual({
        readOnlyHint,
        destructiveHint,
        idempotentHint,
        openWorldHint,
      });
    }
  });

  it("never marks a read that destroys data as read-only", () => {
    expect(
      hintsFor({
        level: "read",
        effects: {
          destroys: true,
          idempotent: true,
          outside: false,
          spendsAi: false,
        },
      })
    ).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
