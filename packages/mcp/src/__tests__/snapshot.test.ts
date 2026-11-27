/**
 * The fixture door's tool list against its checked-in snapshot: any change to
 * a name, title, description, hint or schema fails here until the snapshot is
 * updated in the same change. A real door's snapshot sits in
 * `src/__snapshots__/` and is checked the same way.
 *
 * To accept a change: `UPDATE_TOOL_SNAPSHOTS=1 pnpm --filter @nextlyhq/mcp test`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { toolListSnapshot } from "../snapshot";

import { fixtureToolSet } from "./fixtures";

const SNAPSHOT = fileURLToPath(
  new URL("./__snapshots__/fixture-chat.json", import.meta.url)
);

describe("the tool-list snapshot", () => {
  it("matches the list the adapter builds", () => {
    const built = toolListSnapshot(fixtureToolSet());
    if (process.env.UPDATE_TOOL_SNAPSHOTS === "1") {
      writeFileSync(SNAPSHOT, built);
      return;
    }
    expect(
      existsSync(SNAPSHOT),
      `${SNAPSHOT} is missing; write it with UPDATE_TOOL_SNAPSHOTS=1`
    ).toBe(true);
    expect(
      built,
      "The tool list changed. Review the difference, then accept it with UPDATE_TOOL_SNAPSHOTS=1 pnpm --filter @nextlyhq/mcp test"
    ).toBe(readFileSync(SNAPSHOT, "utf8"));
  });

  it("holds every tool the door serves, sorted by name", () => {
    const snapshot = JSON.parse(toolListSnapshot(fixtureToolSet())) as {
      tools: { name: string }[];
    };
    const names = snapshot.tools.map(tool => tool.name);
    expect(names).toEqual([...names].sort());
    expect(names).toHaveLength(fixtureToolSet().tools.length);
  });
});
