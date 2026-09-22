/**
 * What a slot decides, and what happens when nobody has claimed one.
 *
 * The case that matters most is `lowestFreeSlot` against a checkout with no
 * settings file. The first run of this command treated that as "no slot taken"
 * and handed a brand-new worktree slot 0 — the main checkout's :3000 and its
 * `nextly_test` database, which is exactly the collision the slot mechanism
 * exists to prevent. It was found by running the command, not by reading it.
 */
import { describe, expect, it } from "vitest";

import {
  BASE,
  databaseFor,
  lowestFreeSlot,
  settingsWithEnv,
  slotEnv,
  worktreePaths,
} from "./worktree.mjs";

describe("what a slot decides", () => {
  /*
   * The load-bearing case. Slot 0 must reproduce the documented defaults
   * byte for byte, because that is what makes this safe to land: a checkout
   * that never runs the command behaves as it always did. If this fails, every
   * existing script and every line of AGENTS.md quoting :3000 or nextly_test
   * has been invalidated.
   */
  it("leaves slot 0 exactly as the repository already documents it", () => {
    expect(slotEnv(0)).toEqual({
      NEXTLY_WORKTREE_SLOT: "0",
      NEXTLY_TEST_DB: "nextly_test",
      PORT: "3000",
      E2E_PORT: "3100",
    });
  });

  it("strides the ports so two worktrees cannot meet", () => {
    expect(slotEnv(1).PORT).toBe(String(BASE.playground + BASE.stride));
    expect(slotEnv(2).E2E_PORT).toBe(String(BASE.e2e + 2 * BASE.stride));
  });

  it("gives each slot above 0 its own database", () => {
    expect(databaseFor(0)).toBe("nextly_test");
    expect(databaseFor(3)).toBe("nextly_test_w3");
    expect(new Set([0, 1, 2, 3].map(databaseFor)).size).toBe(4);
  });

  /*
   * A single TEST_POSTGRES_URL cannot serve both Postgres legs: 15 is on 5434
   * and 17 on 5435, so an environment carrying a whole URL would point the
   * `:postgres15` lane at the 17 container and report a pass for a version it
   * never ran against. The slot therefore carries a database NAME.
   */
  it("carries a database name rather than a connection URL", () => {
    for (const value of Object.values(slotEnv(4))) {
      expect(value).not.toMatch(/:\/\//);
    }
  });
});

describe("choosing the next free slot", () => {
  it("gives out 0 only when no checkout exists at all", () => {
    expect(lowestFreeSlot([])).toBe(0);
  });

  // The regression. An unallocated checkout reports 0, not null, so a second
  // worktree must be given 1.
  it("does not hand out a slot an unallocated checkout is already using", () => {
    expect(lowestFreeSlot([0])).toBe(1);
  });

  it("fills a gap rather than climbing, so a removal returns its ports", () => {
    expect(lowestFreeSlot([0, 2, 3])).toBe(1);
  });

  it("climbs when there is no gap", () => {
    expect(lowestFreeSlot([0, 1, 2])).toBe(3);
  });

  /*
   * The seam the original defect lived in. A checkout whose slot could not be
   * read used to be dropped from the set, which reads as "nobody holds
   * anything" and hands out 0. Refusing is the only answer that cannot
   * silently collide.
   */
  it.each([[[null]], [[0, undefined]], [["1"]], [[-1]]])(
    "refuses rather than guessing when a checkout's slot is unreadable: %j",
    taken => {
      expect(() => lowestFreeSlot(taken)).toThrow(/cannot read the slot/);
    }
  );
});

describe("reading git's worktree listing", () => {
  it("takes the paths and ignores the rest of each record", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /tmp/repo-feature",
      "HEAD def456",
      "branch refs/heads/feature",
    ].join("\n");
    expect(worktreePaths(porcelain)).toEqual(["/repo", "/tmp/repo-feature"]);
  });

  it("reads nothing out of an empty listing rather than inventing a path", () => {
    expect(worktreePaths("")).toEqual([]);
  });
});

describe("writing the slot into a checkout's local settings", () => {
  it("keeps settings the file already carried", () => {
    const existing = { permissions: { allow: ["Bash(ls:*)"] }, env: { EDITOR: "vim" } };
    expect(settingsWithEnv(existing, { PORT: "3010" })).toEqual({
      permissions: { allow: ["Bash(ls:*)"] },
      env: { EDITOR: "vim", PORT: "3010" },
    });
  });

  it("creates the env block when the file had none", () => {
    expect(settingsWithEnv(null, { PORT: "3010" })).toEqual({ env: { PORT: "3010" } });
  });
});
