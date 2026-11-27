/**
 * Core's operations against the levels table: each one's level, "Always
 * allow" mark, effects, doors and chat mark, and the door rules the table
 * states for the whole list.
 */
import { describe, expect, it } from "vitest";

import { CORE_OPERATIONS } from "../core";
import { assembleOperationList } from "../list";

import {
  activityDeleteLike,
  readOperation,
  settingsSetLike,
  writeOperation,
} from "./fixtures";
import {
  CORE_LEVELS_TABLE,
  levelsTableProblems,
  outsideDeploySet,
  type LevelsRow,
} from "./levels-table";

const READ_ROW: LevelsRow = {
  level: "read",
  alwaysAllow: true,
  raises: [],
  effects: {
    destroys: false,
    idempotent: true,
    outside: false,
    spendsAi: false,
  },
  doors: ["local", "site"],
  chatExposed: false,
};

describe("the levels table", () => {
  it("has exactly one matching row for every core operation", async () => {
    const list = await assembleOperationList({ core: CORE_OPERATIONS });
    expect(levelsTableProblems(list.operations, CORE_LEVELS_TABLE)).toEqual([]);
  });

  // The controls: the comparison above is only evidence if it reports each
  // kind of difference on an operation where the answer is known.
  it("reports an operation that has no row", async () => {
    const list = await assembleOperationList({ core: [readOperation()] });
    expect(levelsTableProblems(list.operations, {})).toEqual([
      '"posts.list" has no row in the levels table',
    ]);
  });

  it("reports a row whose operation is gone", async () => {
    const list = await assembleOperationList({ core: [] });
    expect(
      levelsTableProblems(list.operations, { "posts.list": READ_ROW })
    ).toEqual([
      'the levels table has a row for "posts.list", which is not in the list',
    ]);
  });

  it.each([
    ["level", { level: "draft" }],
    ["Always allow", { alwaysAllow: false }],
    ["destroys", { effects: { ...READ_ROW.effects, destroys: true } }],
    ["idempotent", { effects: { ...READ_ROW.effects, idempotent: false } }],
    ["outside", { effects: { ...READ_ROW.effects, outside: true } }],
    ["spendsAi", { effects: { ...READ_ROW.effects, spendsAi: true } }],
    ["doors", { doors: ["local"] }],
    ["chat mark", { chatExposed: true }],
    ["raise rules", { raises: [{ level: "change", alwaysAllow: true }] }],
  ] satisfies [string, Partial<LevelsRow>][])(
    "reports a declaration whose %s differs from its row",
    async (_fact, change) => {
      const list = await assembleOperationList({ core: [readOperation()] });
      expect(
        levelsTableProblems(list.operations, { "posts.list": READ_ROW })
      ).toEqual([]);
      const [problem, ...rest] = levelsTableProblems(list.operations, {
        "posts.list": { ...READ_ROW, ...change },
      });
      expect(rest).toEqual([]);
      expect(problem).toMatch(/^"posts\.list" differs from its row/);
    }
  );
});

describe("the doors core's operations declare", () => {
  it("puts no core operation outside the fixed set on the deploy door", async () => {
    const list = await assembleOperationList({ core: CORE_OPERATIONS });
    expect(outsideDeploySet(list.operations)).toEqual([]);
  });

  it("names an operation on the deploy door that is not in the fixed set (control)", async () => {
    const maintenance = {
      kind: "maintenance",
      reason: "Brings the schema up to the code.",
    } as const;
    const list = await assembleOperationList({
      core: [
        writeOperation({
          id: "migrate",
          command: ["migrate"],
          doors: ["local", "deploy"],
          permission: maintenance,
        }),
        writeOperation({
          id: "cache.purge",
          command: ["cache", "purge"],
          doors: ["local", "deploy"],
          permission: maintenance,
        }),
      ],
    });
    expect(outsideDeploySet(list.operations)).toEqual(["cache.purge"]);
  });

  // The list refuses such a declaration outright; start-up-checks.test.ts
  // shows that refusal on a fixture.
  it("keeps every operation that changes project files off the site and chat doors", async () => {
    const list = await assembleOperationList({ core: CORE_OPERATIONS });
    const projectOnline = list.operations
      .filter(op => op.permission.kind === "project")
      .filter(op => op.doors.some(door => door === "site" || door === "chat"))
      .map(op => op.id);
    expect(projectOnline).toEqual([]);
  });
});

describe("the chat mark", () => {
  it("is off for an operation that does not declare it", async () => {
    const op = readOperation({ doors: ["local", "site", "chat"] });
    expect(op.chatExposed).toBeUndefined();
    const list = await assembleOperationList({ core: [op] });
    expect(list.byId("posts.list")?.chatExposed).toBe(false);
  });

  it("is on only where the declaration says so", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation({ doors: ["local", "chat"], chatExposed: true }),
        writeOperation({ doors: ["local", "chat"], chatExposed: false }),
      ],
    });
    expect(list.operations.map(op => [op.id, op.chatExposed])).toEqual([
      ["posts.list", true],
      ["posts.publish", false],
    ]);
  });
});

describe("the levels table on operations whose risk depends on the run", () => {
  const settingsRow: LevelsRow = {
    level: "change",
    alwaysAllow: true,
    raises: [{ level: "critical", alwaysAllow: false }],
    effects: {
      destroys: true,
      idempotent: true,
      outside: false,
      spendsAi: false,
    },
    doors: ["local", "site"],
    chatExposed: false,
  };
  const activityRow: LevelsRow = {
    level: "critical",
    alwaysAllow: false,
    raises: [],
    effects: {
      destroys: true,
      idempotent: true,
      outside: false,
      spendsAi: false,
    },
    doors: ["site", "local"],
    chatExposed: false,
  };

  it('matches a raise rule\'s level and its "Always allow" refusal (control)', async () => {
    const list = await assembleOperationList({
      core: [settingsSetLike, activityDeleteLike],
    });
    expect(
      levelsTableProblems(list.operations, {
        "settings.set": settingsRow,
        "activity.delete": activityRow,
      })
    ).toEqual([]);
  });

  it('reports a security setting whose rule lost its refusal of "Always allow"', async () => {
    const rule = settingsSetLike.raise?.[0];
    if (!rule) throw new Error("the settings fixture has no raise rule");
    const list = await assembleOperationList({
      core: [
        { ...settingsSetLike, raise: [{ ...rule, alwaysAllow: undefined }] },
      ],
    });
    expect(
      levelsTableProblems(list.operations, { "settings.set": settingsRow })
    ).toEqual([expect.stringMatching(/^"settings\.set" differs from its row/)]);
  });

  it('reports an operation that lost its own refusal of "Always allow"', async () => {
    const list = await assembleOperationList({
      core: [{ ...activityDeleteLike, alwaysAllow: undefined }],
    });
    expect(
      levelsTableProblems(list.operations, { "activity.delete": activityRow })
    ).toEqual([
      expect.stringMatching(/^"activity\.delete" differs from its row/),
    ]);
  });

  it("does not depend on the order of keys", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation({
          effects: {
            spendsAi: false,
            outside: false,
            idempotent: true,
            destroys: false,
          },
        }),
      ],
    });
    expect(
      levelsTableProblems(list.operations, {
        "posts.list": {
          chatExposed: false,
          doors: ["site", "local"],
          effects: {
            idempotent: true,
            destroys: false,
            spendsAi: false,
            outside: false,
          },
          raises: [],
          alwaysAllow: true,
          level: "read",
        },
      })
    ).toEqual([]);
  });
});
