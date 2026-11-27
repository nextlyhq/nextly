/**
 * Tool names: the shape every served name has, the table's two-way map, a
 * served tool with no row refusing start-up by name, and old names kept for
 * at least one minor release.
 */
import { describe, expect, it } from "vitest";

import { buildNameMap, TOOL_TABLE, toolNameProblem } from "../names";
import { buildToolSet } from "../tool-set";

import {
  FIXTURE_OPERATIONS,
  FIXTURE_TABLE,
  fixtureSource,
  fixtureToolSet,
  GET_ENTRY,
  KIND_OPERATIONS,
  RENAMED,
} from "./fixtures";

describe("the shape of a tool name", () => {
  it("accepts verb-first lower-case names with underscores", () => {
    for (const name of [
      "get_entry",
      "find_entries",
      "list_waiting_for_review",
      "get_v2_thing",
    ]) {
      expect(toolNameProblem(name), name).toBeUndefined();
    }
  });

  it.each([
    ["", "is empty"],
    [
      "posts.create",
      "is not lower-case letters and digits joined by single underscores",
    ],
    [
      "Get_entry",
      "is not lower-case letters and digits joined by single underscores",
    ],
    [
      "get__entry",
      "is not lower-case letters and digits joined by single underscores",
    ],
    [
      "get_entry_",
      "is not lower-case letters and digits joined by single underscores",
    ],
    [
      "get-entry",
      "is not lower-case letters and digits joined by single underscores",
    ],
    ["posts_create", 'does not start with a verb (it starts with "posts")'],
    [`get_${"x".repeat(61)}`, "is 65 characters long, more than 64"],
  ])("refuses %j", (name, problem) => {
    expect(toolNameProblem(name)).toBe(problem);
  });

  it("allows a name of exactly 64 characters", () => {
    expect(toolNameProblem(`get_${"x".repeat(60)}`)).toBeUndefined();
  });

  it("holds every name in the release-one table to the rules", () => {
    expect(TOOL_TABLE.length).toBe(19);
    for (const row of TOOL_TABLE)
      expect(toolNameProblem(row.name), row.name).toBeUndefined();
  });

  it("holds every served fixture name to the rules", () => {
    const tools = fixtureToolSet().tools;
    expect(tools.length).toBeGreaterThan(5);
    for (const tool of tools)
      expect(toolNameProblem(tool.name), tool.name).toBeUndefined();
  });
});

describe("the adapter's table maps names and operations both ways", () => {
  it("finds each served tool's operation by name, and each operation's name by ID", () => {
    const toolSet = fixtureToolSet();
    const served = toolSet.tools.map(tool => ({
      name: tool.name,
      operation: tool.operation,
    }));
    const map = buildNameMap(served, FIXTURE_TABLE);
    for (const { name, operation } of served) {
      expect(map.resolve(name)?.operation).toBe(operation);
      expect(map.nameOf(operation.id)).toBe(name);
    }
    // Each operation once, each name once.
    expect(new Set(served.map(entry => entry.operation.id)).size).toBe(
      served.length
    );
    expect(new Set(served.map(entry => entry.name)).size).toBe(served.length);
  });

  it("serves no operation that is not marked for agents on this door", () => {
    const ids = fixtureToolSet().tools.map(tool => tool.operation.id);
    expect(ids).not.toContain("secret.get");
    expect(ids).not.toContain("local.only");
    expect(ids).toContain("entries.get");
  });

  it("refuses to start with a served tool that has no row, naming the tool", () => {
    const table = FIXTURE_TABLE.filter(row => row.name !== "get_entry");
    expect(() =>
      buildToolSet(fixtureSource(FIXTURE_OPERATIONS), { door: "chat", table })
    ).toThrow(
      /The tool "get_entry" \(operation "entries\.get"\) has no row in the adapter's tool table/
    );
  });

  it("refuses a row that names no operation yet, and one that names another", () => {
    const pending = FIXTURE_TABLE.map(row =>
      row.name === "get_entry" ? { name: "get_entry", operation: null } : row
    );
    expect(() =>
      buildToolSet(fixtureSource([GET_ENTRY]), { door: "chat", table: pending })
    ).toThrow(
      /its row in the adapter's tool table names no operation yet; set it to "entries\.get"/
    );

    const wrong = FIXTURE_TABLE.map(row =>
      row.name === "get_entry"
        ? { name: "get_entry", operation: "entries.find" }
        : row
    );
    expect(() =>
      buildToolSet(fixtureSource([GET_ENTRY]), { door: "chat", table: wrong })
    ).toThrow(
      /is served by operation "entries\.get", but its row in the adapter's tool table names "entries\.find"/
    );
  });

  it("allows a row whose operation doesn't exist yet", () => {
    expect(FIXTURE_TABLE.some(row => row.operation === null)).toBe(true);
    expect(() => fixtureToolSet()).not.toThrow();
  });

  it("refuses two operations behind one name, naming both", () => {
    const twin = { ...KIND_OPERATIONS.get_thing, id: "things.twin" };
    const source = {
      ...fixtureSource([KIND_OPERATIONS.get_thing!, twin]),
      toolNameOf: () => "get_thing",
    };
    expect(() =>
      buildToolSet(source, {
        door: "chat",
        table: [{ name: "get_thing", operation: "things.get" }],
      })
    ).toThrow(
      /"get_thing" is claimed by both "things\.get" and "things\.twin"/
    );
  });
});

describe("a renamed tool's old name", () => {
  it("resolves to the operation and says it was renamed", () => {
    const map = buildNameMap(
      [{ name: "get_renamed", operation: RENAMED }],
      FIXTURE_TABLE
    );
    expect(map.resolve("get_old_name")).toEqual({
      operation: RENAMED,
      name: "get_renamed",
      renamedFrom: "get_old_name",
      removableFrom: "1.3.0",
    });
    expect(map.served.map(entry => entry.name)).toEqual(["get_renamed"]);
  });

  it("must be kept for at least one minor release", () => {
    for (const removableFrom of ["1.2.0", "1.2.9", "1.1.0"]) {
      const soon = {
        ...RENAMED,
        toolNameAliases: [
          { name: "get_old_name", addedIn: "1.2.0", removableFrom },
        ],
      };
      expect(() =>
        buildNameMap([{ name: "get_renamed", operation: soon }], FIXTURE_TABLE)
      ).toThrow(
        new RegExp(
          `may be removed in ${removableFrom.replace(/\./g, "\\.")}, less than one minor release after 1\\.2\\.0`
        )
      );
    }
    const nextMajor = {
      ...RENAMED,
      toolNameAliases: [
        { name: "get_old_name", addedIn: "1.9.0", removableFrom: "2.0.0" },
      ],
    };
    expect(() =>
      buildNameMap(
        [{ name: "get_renamed", operation: nextMajor }],
        FIXTURE_TABLE
      )
    ).not.toThrow();
  });

  it("is held to the name rules and may not take a current name", () => {
    const clash = {
      ...RENAMED,
      toolNameAliases: [
        { name: "get_entry", addedIn: "1.2.0", removableFrom: "1.3.0" },
      ],
    };
    expect(() =>
      buildNameMap(
        [
          { name: "get_entry", operation: GET_ENTRY },
          { name: "get_renamed", operation: clash },
        ],
        FIXTURE_TABLE
      )
    ).toThrow(
      /"get_entry" is claimed by both "entries\.get" and "renamed\.get"/
    );

    const badShape = {
      ...RENAMED,
      toolNameAliases: [
        { name: "thing.get", addedIn: "1.2.0", removableFrom: "1.3.0" },
      ],
    };
    expect(() =>
      buildNameMap(
        [{ name: "get_renamed", operation: badShape }],
        FIXTURE_TABLE
      )
    ).toThrow(
      /The old tool name "thing\.get" of "get_renamed" is not lower-case letters/
    );
  });
});
