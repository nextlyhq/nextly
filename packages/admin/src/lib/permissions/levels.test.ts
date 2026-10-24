/**
 * The roles screen's levels and how each maps to permissions.
 *
 * Every row of the level table is asserted both ways: the actions a level
 * saves, and the level those actions read back as. A mapping that only went
 * one way would let a saved level read as Custom on the next load.
 */
import { describe, expect, it } from "vitest";

import {
  type AccessLevel,
  type LevelKind,
  type LevelPermission,
  levelOf,
  levelsFor,
  permissionsFor,
  standardActions,
} from "./levels";

/** A resource's permissions, one per action, each id naming its action. */
function resource(...actions: string[]): LevelPermission[] {
  return actions.map(action => ({ id: `id-${action}`, action }));
}

const COLLECTION = resource(
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish"
);
const SINGLE = resource("read", "update", "publish", "unpublish");
const SYSTEM = resource("create", "read", "update", "delete");

/** The level table: what each level of each kind saves. */
const TABLE: Array<[LevelKind, AccessLevel, LevelPermission[], string[]]> = [
  ["collection", "none", COLLECTION, []],
  ["collection", "view", COLLECTION, ["read"]],
  ["collection", "edit", COLLECTION, ["create", "read", "update", "delete"]],
  [
    "collection",
    "publish",
    COLLECTION,
    ["create", "read", "update", "delete", "publish", "unpublish"],
  ],
  ["single", "none", SINGLE, []],
  ["single", "view", SINGLE, ["read"]],
  ["single", "edit", SINGLE, ["read", "update"]],
  ["single", "publish", SINGLE, ["read", "update", "publish", "unpublish"]],
  ["system", "none", SYSTEM, []],
  ["system", "view", SYSTEM, ["read"]],
  ["system", "edit", SYSTEM, ["create", "read", "update", "delete"]],
];

describe("the levels each kind offers", () => {
  it("offers a collection and a Single every level", () => {
    expect(levelsFor("collection")).toEqual([
      "none",
      "view",
      "edit",
      "publish",
    ]);
    expect(levelsFor("single")).toEqual(["none", "view", "edit", "publish"]);
  });

  it("offers a built-in resource no Can publish", () => {
    expect(levelsFor("system")).toEqual(["none", "view", "edit"]);
  });
});

describe.each(TABLE)("%s at %s", (kind, level, available, actions) => {
  it("saves exactly that level's permissions", () => {
    expect(permissionsFor(kind, level, available)).toEqual(
      actions.map(action => `id-${action}`)
    );
  });

  it("reads back as the same level", () => {
    expect(levelOf(kind, actions)).toBe(level);
  });
});

describe("reading a row's level", () => {
  it("reads a set matching no level as Custom", () => {
    expect(levelOf("collection", ["read", "update"])).toBe("custom");
    expect(levelOf("collection", ["read", "publish"])).toBe("custom");
    // Settings with read and update: no level gives exactly those two.
    expect(levelOf("system", ["read", "update"])).toBe("custom");
  });

  it("does not read a Single's create or delete into a level", () => {
    // A Single has neither, so they are not standard for it: what remains,
    // read and update, is Can edit.
    expect(levelOf("single", ["read", "update", "create", "delete"])).toBe(
      "edit"
    );
  });

  it("leaves actions outside the level under the switch", () => {
    // A plugin's own action does not change what the level reads, and
    // without it the same row reads the same level.
    expect(levelOf("collection", ["read", "export-submissions"])).toBe("view");
    expect(levelOf("collection", ["export-submissions"])).toBe("none");
  });

  it("does not read publish as a level on a built-in resource", () => {
    // Not standard there, so it sits under the switch.
    expect(
      levelOf("system", ["read", "create", "update", "delete", "publish"])
    ).toBe("edit");
  });

  it("reads a built-in resource's legacy manage as Can edit", () => {
    // A role `nextly upgrade` has not converted yet: manage gave read, create,
    // update and delete, so the row shows that, never No access.
    expect(levelOf("system", ["manage"])).toBe("edit");
    expect(levelOf("system", ["manage", "read"])).toBe("edit");
  });

  it("counts a built-in resource's legacy manage among the actions its level decides", () => {
    // So a row moved off Can edit loses it with the rest, rather than keeping
    // edit access through it under the switch.
    expect(standardActions("system").has("manage")).toBe(true);
    expect(standardActions("collection").has("manage")).toBe(false);
  });

  it("does not read manage into a collection's level", () => {
    expect(levelOf("collection", ["manage"])).toBe("none");
  });
});

describe("saving a level", () => {
  it("ticks only the permissions the resource has", () => {
    // A collection with no publish permission yet: Can publish ticks what
    // exists and nothing else.
    expect(
      permissionsFor("collection", "publish", resource("read", "update"))
    ).toEqual(["id-read", "id-update"]);
  });

  it("returns no action outside the level", () => {
    const withExtra = [...COLLECTION, ...resource("export-submissions")];
    expect(permissionsFor("collection", "edit", withExtra)).not.toContain(
      "id-export-submissions"
    );
  });

  it("moves a legacy manage row to plain permissions when its level changes", () => {
    // Settings as it is seeded before `nextly upgrade`: read and manage, both
    // held. The row reads Can edit; set to Can view, what the caller keeps is
    // the held actions outside the level, and manage is not among them.
    const seeded = resource("read", "manage");
    const held = ["read", "manage"];
    expect(levelOf("system", held)).toBe("edit");
    const kept = held.filter(action => !standardActions("system").has(action));
    const saved = [...kept, ...permissionsFor("system", "view", seeded)];
    expect(saved).toEqual(["id-read"]);
  });

  it("never saves manage, whatever the level", () => {
    const withPlain = resource("create", "read", "update", "delete", "manage");
    for (const level of levelsFor("system")) {
      expect(permissionsFor("system", level, withPlain)).not.toContain(
        "id-manage"
      );
    }
  });

  it("refuses a level the kind does not offer", () => {
    expect(() => permissionsFor("system", "publish", SYSTEM)).toThrow(
      'a system row offers no "publish" level'
    );
  });
});
