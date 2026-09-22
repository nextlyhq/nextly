/**
 * What a slot decides, and the ways allocating one has gone wrong.
 *
 * Every case below is a defect that shipped and was caught in review. They are
 * kept as tests rather than as comments because each one reads as correct code:
 * a suffix match looks like a match, a force flag looks like thoroughness, and
 * a catch that reports "container not running" looks like tolerance.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PORTS,
  PORT_NAMES,
  claimSlot,
  databaseFor,
  databaseToDrop,
  findWorktree,
  isReclaimable,
  portsFor,
  readClaims,
  settingsWithEnv,
  slotEnv,
  teardownIncomplete,
  worktreePaths,
  worktreeRecords,
} from "./worktree.mjs";

describe("the ports a slot owns", () => {
  /*
   * Slot 0 is the primary checkout. AGENTS.md, playwright.config.ts and
   * playwright.production.config.ts all name these numbers, so changing them
   * would invalidate every one of those at once.
   */
  it("leaves slot 0 exactly as the repository documents it", () => {
    expect(portsFor(0)).toEqual({ PORT: 3000, E2E_PORT: 3100, E2E_PROD_PORT: 3101 });
  });

  /*
   * 🔴 The defect this file exists for. The first version gave each port its
   * own arithmetic series — playground at 3000 + 10n, e2e at 3100 + 10n — and
   * the series INTERSECT: slot 10's playground port was 3100, which is slot 0's
   * e2e port. Independent series look separated at the slots anyone tries by
   * hand, so no amount of spot-checking finds it.
   */
  it("allocates 64 slots without a single port collision", () => {
    const seen = new Map();
    for (let slot = 0; slot < 64; slot += 1) {
      for (const [name, port] of Object.entries(portsFor(slot))) {
        expect(seen.has(port), `${port} taken by ${seen.get(port)} and slot ${slot}.${name}`).toBe(
          false
        );
        seen.set(port, `slot ${slot}.${name}`);
      }
    }
    expect(seen.size).toBe(64 * PORT_NAMES.length);
  });

  it("never lets an allocated slot reach a documented default", () => {
    const defaults = new Set(Object.values(DEFAULT_PORTS));
    for (let slot = 1; slot < 64; slot += 1) {
      for (const port of Object.values(portsFor(slot))) {
        expect(defaults.has(port)).toBe(false);
      }
    }
  });

  /*
   * A port absent from the slot environment is a port nobody allocates, and
   * nothing says so — the collision simply happens. E2E_PROD_PORT was missing.
   */
  it("covers every server port the repository binds", () => {
    expect(PORT_NAMES).toContain("E2E_PROD_PORT");
    const env = slotEnv(3);
    for (const name of PORT_NAMES) expect(env[name]).toBeDefined();
  });

  /*
   * A single TEST_POSTGRES_URL cannot serve both Postgres legs: 15 is on 5434
   * and 17 on 5435, so an environment carrying a whole URL would point the
   * `:postgres15` lane at the 17 container and pass for a version it never ran.
   */
  it("carries a database name rather than a connection URL", () => {
    for (const value of Object.values(slotEnv(4))) expect(value).not.toMatch(/:\/\//);
  });
});

describe("the database a slot owns", () => {
  it("gives each slot above 0 its own", () => {
    expect(databaseFor(0)).toBe("nextly_test");
    expect(new Set([0, 1, 2, 3].map(databaseFor)).size).toBe(4);
  });

  /*
   * Slot 0's database is shared by the primary checkout and every unallocated
   * one, so a removal that dropped it would break everyone else's test run —
   * from a command whose whole purpose is tidying up.
   */
  it("never drops the shared default", () => {
    expect(databaseToDrop(0)).toBeNull();
    expect(databaseToDrop(2)).toBe("nextly_test_w2");
  });
});

describe("reading git's worktree listing", () => {
  const porcelain = [
    "worktree /repo",
    "HEAD abc",
    "branch refs/heads/main",
    "",
    "worktree /tmp/repo-fix-feature",
    "HEAD def",
    "branch refs/heads/fix-feature",
  ].join("\n");

  it("reads the branch, not just the path", () => {
    expect(worktreeRecords(porcelain)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/tmp/repo-fix-feature", branch: "fix-feature" },
    ]);
  });

  it("still answers with paths for callers that only need those", () => {
    expect(worktreePaths(porcelain)).toEqual(["/repo", "/tmp/repo-fix-feature"]);
  });

  it("reads nothing out of an empty listing rather than inventing a record", () => {
    expect(worktreeRecords("")).toEqual([]);
  });
});

describe("choosing which checkout a removal names", () => {
  const records = [
    { path: "/repo", branch: "main" },
    { path: "/tmp/repo-fix-feature", branch: "fix-feature" },
  ];

  it("matches an exact branch", () => {
    expect(findWorktree(records, "fix-feature", p => p)?.path).toBe("/tmp/repo-fix-feature");
  });

  /*
   * 🔴 Removal used to select the first checkout whose PATH ended with the
   * requested name, and a path suffix is not a branch: asking to remove
   * `feature` matched the `fix-feature` checkout and then force-deleted it.
   * A removal is not a place for a near-miss.
   */
  it("refuses a name that is only a suffix of another branch", () => {
    expect(findWorktree(records, "feature", p => p)).toBeNull();
  });

  it("matches an exact path", () => {
    expect(findWorktree(records, "/repo", p => p)?.branch).toBe("main");
  });

  it("returns nothing rather than guessing when the target is unknown", () => {
    expect(findWorktree(records, "no-such-branch", p => p)).toBeNull();
  });
});

describe("whether a slot claim may be taken over", () => {
  it("takes over a claim whose checkout is gone", () => {
    expect(isReclaimable({ slot: 1, path: "/gone" }, () => false)).toBe(true);
  });

  it("leaves a claim whose checkout still exists", () => {
    expect(isReclaimable({ slot: 1, path: "/here" }, () => true)).toBe(false);
  });

  /*
   * 🔴 A removal whose databases could not be dropped keeps its claim. Reissuing
   * that slot would hand the next checkout another run's fixed-name system
   * tables — `nextly_schema_events` and its neighbours cannot be prefixed —
   * which is the collision the whole mechanism exists to prevent.
   */
  it("never takes over a slot whose databases were never dropped", () => {
    expect(isReclaimable({ slot: 1, path: "/gone", pendingCleanup: true }, () => false)).toBe(false);
  });

  /*
   * 🔴 An unreadable claim used to read as reclaimable, and that is the
   * dangerous direction. A claim mid-write, or truncated by a crash, parses as
   * null — so a concurrent run could unlink it and take a slot its owner
   * believed it held. "I cannot tell who owns this" is not "nobody owns this".
   */
  it("keeps a slot whose claim cannot be read, rather than assuming it is free", () => {
    expect(isReclaimable(null, () => false)).toBe(false);
  });
});

describe("claiming a slot", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-slots-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /*
   * The checkout paths must EXIST. A claim naming a directory that is gone is
   * reclaimable by design, so fake paths make every claim instantly stale and
   * the test asks nothing of the allocator — which is how the first version of
   * these cases passed zero of three.
   */
  const claim = name => {
    const path = join(dir, name);
    mkdirSync(path, { recursive: true });
    return claimSlot(dir, { path, branch: name });
  };

  it("hands out the lowest free slot", () => {
    expect(claim("a")).toBe(0);
    expect(claim("b")).toBe(1);
  });

  /*
   * 🔴 The first version read the worktree list, picked the lowest free number,
   * and only then wrote the settings file — three steps with nothing holding
   * between them. Two agents running `worktree new` at once both read the same
   * list and both chose the same slot, giving two checkouts identical ports and
   * an identical database.
   *
   * The claim is now the CREATE: `openSync(file, "wx")` fails with EEXIST when
   * the file exists, and the filesystem decides that. Claiming twice in a row
   * without anything releasing in between must never return the same number,
   * which is the property a racing pair would violate.
   */
  it("never issues the same slot twice", () => {
    const issued = new Set();
    for (let i = 0; i < 12; i += 1) {
      const slot = claim(`w${i}`);
      expect(issued.has(slot), `slot ${slot} issued twice`).toBe(false);
      issued.add(slot);
    }
    expect(issued.size).toBe(12);
  });

  it("records what holds the slot, so a later run can tell whether it is stale", () => {
    claim("feature");
    const [recorded] = readClaims(dir);
    expect(recorded.path).toBe(join(dir, "feature"));
    expect(recorded.branch).toBe("feature");
  });

  it("reuses a slot whose checkout has vanished", () => {
    claim("stays");
    claimSlot(dir, { path: "/definitely/gone", branch: "went" });
    // Slot 1 names a checkout that does not exist, so the next claim takes it
    // back rather than climbing to 2 and leaking the number.
    expect(claim("next")).toBe(1);
  });

  it("refuses rather than looping forever when every slot is held", () => {
    expect(() => {
      for (let i = 0; i < 5; i += 1) {
        const path = join(dir, `held${i}`);
        mkdirSync(path, { recursive: true });
        claimSlot(dir, { path, branch: `b${i}` }, { maxSlots: 3 });
      }
    }).toThrow(/every slot below 3 is claimed/);
  });

  /*
   * 🔴 The claim used to be created EMPTY by `openSync(file, "wx")` and filled
   * afterwards, so between those calls the file existed and parsed as nothing.
   * A concurrent run reading it there saw an unowned slot and took it. The
   * claim is written to a scratch file and LINKED into place now, so the name
   * only ever appears already complete — this asserts the shape that made the
   * race possible cannot occur.
   */
  it("never leaves a claim file that parses as nothing", () => {
    claim("a");
    for (const name of readdirSync(dir).filter(entry => entry.endsWith(".json"))) {
      const body = readFileSync(join(dir, name), "utf8");
      expect(body.length, `${name} is empty`).toBeGreaterThan(0);
      expect(() => JSON.parse(body), `${name} is not valid JSON`).not.toThrow();
    }
  });

  it("leaves no scratch files behind", () => {
    claim("a");
    claim("b");
    expect(readdirSync(dir).filter(name => name.includes(".tmp"))).toEqual([]);
  });

  it("does not take over a slot whose claim it cannot read", () => {
    writeFileSync(join(dir, "0.json"), "{ not json");
    // Unreadable is treated as owned, so allocation moves past it.
    expect(claimSlot(dir, { path: "/a", branch: "a" })).toBe(1);
  });
});

describe("deciding whether teardown finished, given what was provisioned", () => {
  const results = [
    { container: "pg17", state: "dropped" },
    { container: "mysql", state: "skipped" },
  ];

  /*
   * A container that never received this slot's database has nothing to drop,
   * so skipping it leaves nothing behind. Without this, every removal taken
   * while the containers were down reserved its slot forever, and clearing it
   * meant starting every container to drop databases that were never created.
   */
  it("does not hold a slot for a container that never held its database", () => {
    expect(teardownIncomplete(results, ["pg17"])).toBe(false);
  });

  it("holds the slot when a container that DID hold it was skipped", () => {
    expect(teardownIncomplete(results, ["pg17", "mysql"])).toBe(true);
  });

  /*
   * A claim predating this record cannot say what it provisioned, and unknown
   * is not empty — the conservative answer is to hold the slot.
   */
  it("holds the slot when nothing is recorded, because unknown is not empty", () => {
    expect(teardownIncomplete(results, null)).toBe(true);
  });

  it("holds the slot on a failure whatever was provisioned", () => {
    expect(teardownIncomplete([{ container: "pg17", state: "failed" }], ["pg17"])).toBe(true);
    expect(teardownIncomplete([{ container: "pg17", state: "failed" }], [])).toBe(true);
  });
});

describe("deciding whether teardown finished", () => {
  /*
   * A failure and a skip mean the same thing about the world — the database
   * still exists — even though they print differently. Treating a skip as done
   * is what let a later worktree inherit a populated database.
   */
  it.each([
    [[{ state: "dropped" }, { state: "dropped" }], false],
    [[{ state: "dropped" }, { state: "failed" }], true],
    [[{ state: "dropped" }, { state: "skipped" }], true],
  ])("%j -> incomplete=%s", (results, expected) => {
    expect(teardownIncomplete(results)).toBe(expected);
  });
});

describe("writing the slot into a checkout's local settings", () => {
  it("keeps settings the file already carried", () => {
    expect(
      settingsWithEnv({ permissions: { allow: ["Bash(ls:*)"] }, env: { EDITOR: "vim" } }, { PORT: "3200" })
    ).toEqual({ permissions: { allow: ["Bash(ls:*)"] }, env: { EDITOR: "vim", PORT: "3200" } });
  });

  it("creates the env block when the file had none", () => {
    expect(settingsWithEnv(null, { PORT: "3200" })).toEqual({ env: { PORT: "3200" } });
  });
});
