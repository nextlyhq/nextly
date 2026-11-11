// Every permission the configuration declares, by owner, as a migration snapshot records it, and
// the change a migration names. Only an app's or a plugin's own permissions are named, and only an
// added or a removed one makes a change; an entity's built-in permissions follow the entity.
import { describe, expect, it } from "vitest";

import type { CollectedPermission } from "../../../../plugins/permissions/collect-permissions";
import { reviewWorkflow } from "../../../workflows/preset";
import {
  describePermissionChange,
  isPermissionRecord,
  permissionChanges,
  permissionRecordOf,
  permissionsForRun,
  type PermissionRecord,
} from "../declared-permissions";

const custom = (
  owner: string,
  action: string,
  resource: string,
  extra: Partial<CollectedPermission> = {}
): CollectedPermission => ({
  action,
  resource,
  slug: `${action}-${resource}`,
  name: `${action} ${resource}`,
  owner,
  source: owner === "app" ? "app" : "plugin",
  group: "General",
  danger: false,
  ...extra,
});

const formBuilder = "@nextlyhq/plugin-form-builder";

const record = (customs: CollectedPermission[]): PermissionRecord =>
  permissionRecordOf({
    collections: [{ slug: "posts" }],
    singles: [],
    workflows: [],
    custom: customs,
  });

describe("permissionRecordOf", () => {
  const recorded = permissionRecordOf({
    collections: [{ slug: "posts" }, { slug: "users" }],
    singles: [{ slug: "site-settings" }],
    workflows: [
      { workflow: reviewWorkflow(), collections: ["posts"], singles: [] },
    ],
    custom: [
      custom("app", "export", "reports", { description: "Export reports" }),
      custom(formBuilder, "export", "submissions", {
        group: "Forms",
        danger: true,
      }),
    ],
  });

  it("records each collection's and Single's built-in permissions under the entity", () => {
    expect(Object.keys(recorded.collections.posts)).toEqual(
      expect.arrayContaining([
        "create-posts",
        "read-posts",
        "update-posts",
        "delete-posts",
        "publish-posts",
        "unpublish-posts",
      ])
    );
    expect(Object.keys(recorded.singles["site-settings"]).sort()).toEqual([
      "publish-site-settings",
      "read-site-settings",
      "unpublish-site-settings",
      "update-site-settings",
    ]);
    expect(recorded.collections.posts["read-posts"]).toEqual({
      action: "read",
      resource: "posts",
      name: "Read Posts",
      description: "Permission to read posts",
      group: null,
      danger: false,
    });
  });

  it("records a workflow's permissions under the entity it is attached to, in the workflow group", () => {
    expect(
      recorded.collections.posts["publish-without-review-posts"]
    ).toMatchObject({ action: "publish-without-review", group: "workflow" });
  });

  it("records the app's and each plugin's own permissions under their owner, whole", () => {
    expect(recorded.app).toEqual({
      "export-reports": {
        action: "export",
        resource: "reports",
        name: "export reports",
        description: "Export reports",
        group: "General",
        danger: false,
      },
    });
    expect(recorded.plugins[formBuilder]["export-submissions"]).toEqual({
      action: "export",
      resource: "submissions",
      name: "export submissions",
      description: null,
      group: "Forms",
      danger: true,
    });
  });

  it("records no system resource as an entity, and no field group", () => {
    // `users` is a system resource: its permissions are Nextly's own list, which follows the
    // release and is not recorded.
    expect(recorded.collections.users).toBeUndefined();
    expect(Object.keys(recorded)).toEqual([
      "app",
      "plugins",
      "collections",
      "singles",
    ]);
  });

  it("keeps an entity's built-in permission its own when another owner names it", () => {
    const both = record([custom(formBuilder, "read", "posts")]);
    expect(both.collections.posts["read-posts"]).toBeDefined();
    expect(both.plugins[formBuilder]).toBeUndefined();
  });

  it("keeps a workflow action an app or plugin declares as theirs", () => {
    const claimed = permissionRecordOf({
      collections: [{ slug: "posts" }],
      singles: [],
      workflows: [
        { workflow: reviewWorkflow(), collections: ["posts"], singles: [] },
      ],
      custom: [custom("app", "publish-without-review", "posts")],
    });
    expect(claimed.app["publish-without-review-posts"]).toBeDefined();
    expect(
      claimed.collections.posts["publish-without-review-posts"]
    ).toBeUndefined();
  });
});

describe("permissionChanges", () => {
  const before = record([custom(formBuilder, "export", "submissions")]);

  it("names a permission a plugin's new release adds", () => {
    const after = record([
      custom(formBuilder, "export", "submissions"),
      custom(formBuilder, "archive", "submissions"),
    ]);
    expect(permissionChanges(before, after)).toEqual([
      {
        owner: formBuilder,
        added: ["archive-submissions"],
        removed: [],
        kind: "owner",
      },
    ]);
  });

  it("names a permission a plugin's new release removes", () => {
    expect(permissionChanges(before, record([]))).toEqual([
      {
        owner: formBuilder,
        added: [],
        removed: ["export-submissions"],
        kind: "owner",
      },
    ]);
  });

  it("names the app's own permissions as an owner of its own", () => {
    expect(
      permissionChanges(
        record([]),
        record([custom("app", "export", "reports")])
      )
    ).toEqual([
      { owner: "app", added: ["export-reports"], removed: [], kind: "owner" },
    ]);
  });

  it("makes no change of a label, a description or a group alone", () => {
    const relabelled = record([
      custom(formBuilder, "export", "submissions", {
        name: "Download submissions",
        description: "now described",
        group: "Data",
      }),
    ]);
    expect(permissionChanges(before, relabelled)).toEqual([]);
  });

  it("makes no change of an entity's built-in permissions, which follow the entity", () => {
    const more = permissionRecordOf({
      collections: [{ slug: "posts" }, { slug: "pages" }],
      singles: [],
      workflows: [],
      custom: [custom(formBuilder, "export", "submissions")],
    });
    expect(permissionChanges(before, more)).toEqual([]);
  });

  it("records every declared permission once over a snapshot that predates the record", () => {
    expect(permissionChanges(undefined, before)).toEqual([
      { kind: "recorded" },
    ]);
  });

  it("records them over a snapshot that predates the record when only entities declare any", () => {
    expect(permissionChanges(undefined, record([]))).toEqual([
      { kind: "recorded" },
    ]);
  });

  it("names every permission as added when there is no earlier snapshot", () => {
    expect(permissionChanges(null, before)).toEqual([
      {
        owner: formBuilder,
        added: ["export-submissions"],
        removed: [],
        kind: "owner",
      },
    ]);
  });

  it("names nothing when the run knows no permissions", () => {
    expect(permissionChanges(before, undefined)).toEqual([]);
  });
});

describe("describePermissionChange", () => {
  it.each([
    [
      { owner: formBuilder, added: ["a-x", "b-x"], removed: ["c-x"] },
      `${formBuilder}: + a-x, + b-x, - c-x`,
    ],
    [{ owner: "app", added: [], removed: ["d-y"] }, "app: - d-y"],
  ])("reads %j", (change, line) => {
    expect(describePermissionChange({ ...change, kind: "owner" })).toBe(line);
  });

  it("reads a first recording as such", () => {
    expect(describePermissionChange({ kind: "recorded" })).toBe(
      "every declared permission recorded"
    );
  });
});

describe("isPermissionRecord", () => {
  it("accepts a record and refuses a malformed one", () => {
    expect(isPermissionRecord(record([custom("app", "x", "y")]))).toBe(true);
    expect(isPermissionRecord({ app: {}, plugins: [] })).toBe(false);
    expect(
      isPermissionRecord({
        app: { "x-y": { action: "x" } },
        plugins: {},
        collections: {},
        singles: {},
      })
    ).toBe(false);
  });
});

// A Schema Builder save knows the entity it saves, not the configuration's plugins: its snapshot
// carries the latest record forward, with only that entity's built-in permissions brought to what
// it now is, and names no change.
describe("permissionsForRun", () => {
  const latest = permissionRecordOf({
    collections: [{ slug: "posts" }],
    singles: [],
    workflows: [
      { workflow: reviewWorkflow(), collections: ["posts"], singles: [] },
    ],
    custom: [custom(formBuilder, "export", "submissions")],
  });

  it("writes the record it is given and names what changed since the latest", () => {
    const given = record([]);
    expect(permissionsForRun({ given, latest })).toEqual({
      record: given,
      changes: [
        {
          owner: formBuilder,
          added: [],
          removed: ["export-submissions"],
          kind: "owner",
        },
      ],
    });
  });

  it("carries the latest record forward, with a saved new collection's built-in permissions", () => {
    const run = permissionsForRun({
      given: undefined,
      latest,
      scope: { kind: "collection", slug: "pages", present: true },
    });
    expect(run.changes).toEqual([]);
    expect(run.record?.plugins).toEqual(latest.plugins);
    expect(Object.keys(run.record?.collections.pages ?? {})).toContain(
      "read-pages"
    );
    expect(run.record?.collections.posts).toEqual(latest.collections.posts);
  });

  it("keeps a saved collection's workflow permissions as recorded", () => {
    const run = permissionsForRun({
      given: undefined,
      latest,
      scope: { kind: "collection", slug: "posts", present: true },
    });
    expect(run.record?.collections.posts).toEqual(latest.collections.posts);
  });

  it("removes a deleted collection's permissions", () => {
    const run = permissionsForRun({
      given: undefined,
      latest,
      scope: { kind: "collection", slug: "posts", present: false },
    });
    expect(run.record?.collections).toEqual({});
  });

  it("writes no record over a latest snapshot that has none, and names nothing", () => {
    expect(
      permissionsForRun({
        given: undefined,
        latest: undefined,
        scope: { kind: "collection", slug: "pages", present: true },
      })
    ).toEqual({ record: undefined, changes: [] });
  });
});

// The host app and a plugin are different owners whatever the plugin is called, and a permission
// is its action and resource, which two different pairs can spell with the same slug.
describe("owners and identities", () => {
  it("compares the app's own permissions apart from a plugin named app", () => {
    const before = record([
      custom("app", "export", "reports"),
      custom("app", "sync", "jobs", { source: "plugin" }),
    ]);
    const after = record([
      custom("app", "export", "reports"),
      custom("app", "archive", "reports"),
      custom("app", "sync", "jobs", { source: "plugin" }),
    ]);
    expect(permissionChanges(before, after)).toEqual([
      {
        kind: "owner",
        owner: "app",
        added: ["archive-reports"],
        removed: [],
      },
    ]);
  });

  it("names a plugin called app apart from the app itself", () => {
    const changes = permissionChanges(
      record([]),
      record([
        custom("app", "export", "reports"),
        custom("app", "sync", "jobs", { source: "plugin" }),
      ])
    );
    expect(changes.map(describePermissionChange)).toEqual([
      "app: + export-reports",
      "plugin app: + sync-jobs",
    ]);
  });

  it("names a permission whose action and resource changed under the same slug", () => {
    const before = record([custom(formBuilder, "export-data", "reports")]);
    const after = record([custom(formBuilder, "export", "data-reports")]);
    expect(Object.keys(before.plugins[formBuilder])).toEqual(
      Object.keys(after.plugins[formBuilder])
    );
    expect(permissionChanges(before, after)).toEqual([
      {
        kind: "owner",
        owner: formBuilder,
        added: ["export-data-reports"],
        removed: ["export-data-reports"],
      },
    ]);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "records a plugin named %s like any other",
    name => {
      const named = record([custom(name, "export", "reports")]);
      expect(Object.keys(named.plugins)).toEqual([name]);
      expect(Object.keys(named.plugins[name])).toEqual(["export-reports"]);
    }
  );

  it("carries a saved collection named __proto__ forward as an entity of its own", () => {
    const run = permissionsForRun({
      given: undefined,
      latest: record([]),
      scope: { kind: "collection", slug: "__proto__", present: true },
    });
    expect(Object.keys(run.record?.collections ?? {}).sort()).toEqual([
      "__proto__",
      "posts",
    ]);
  });
});
