/**
 * What an applied migration's snapshot declares, and which owners it speaks
 * for: the app always, each plugin it records, and each plugin the point before
 * it held, read from the snapshot before it or, where the point before is the
 * registry record's, from the record's baseline.
 */
import { describe, expect, it } from "vitest";

import type {
  OwnerPermissions,
  PermissionRecord,
} from "../../migrate-create/declared-permissions";
import type { EntitySettingsRecord } from "../../migrate-create/entity-settings";
import {
  keepingUnrecordedPlugins,
  leftoverOrphanScopeOf,
  orphanScopeOf,
} from "../permission-orphans";

const ENTITIES: EntitySettingsRecord = {
  collections: {},
  singles: {},
  fieldGroups: {},
};

function owned(
  ...permissions: [action: string, resource: string][]
): OwnerPermissions {
  return Object.fromEntries(
    permissions.map(([action, resource]) => [
      `${action}-${resource}`,
      {
        action,
        resource,
        name: `${action} ${resource}`,
        description: null,
        group: null,
        danger: false,
      },
    ])
  );
}

function record(parts: Partial<PermissionRecord>): PermissionRecord {
  return { app: {}, plugins: {}, collections: {}, singles: {}, ...parts };
}

const snapshot = (permissions?: PermissionRecord) => ({
  entities: ENTITIES,
  ...(permissions === undefined ? {} : { permissions }),
});

describe("leftoverOrphanScopeOf", () => {
  const gone = {
    collection: new Set(["posts"]),
    single: new Set<string>(),
  };
  const posts = owned(
    ["read", "posts"],
    ["update", "posts"],
    ["publish", "posts"]
  );

  it("names what any applied record declares for an entity that is gone, and speaks for no owner", () => {
    const scope = leftoverOrphanScopeOf(
      [
        record({
          collections: { posts, pages: owned(["read", "pages"]) },
          singles: { posts: owned(["update", "posts"]) },
        }),
        undefined,
        record({ plugins: { forms: owned(["sync", "forms"]) } }),
      ],
      gone
    );

    expect(scope).toEqual({
      declared: [],
      declaredByPlugin: new Map(),
      owners: new Set(),
      plugins: new Set(["forms"]),
      retired: [
        { action: "read", resource: "posts" },
        { action: "update", resource: "posts" },
        { action: "publish", resource: "posts" },
      ],
    });
  });

  it.each([
    ["a Single", { singles: { posts: owned(["read", "posts"]) } }],
    ["a plugin", { plugins: { flow: owned(["read", "posts"]) } }],
    ["the app", { app: owned(["read", "posts"]) }],
  ])("leaves what the newest declares for %s", (_whose, newest) => {
    const scope = leftoverOrphanScopeOf(
      [record({ collections: { posts } }), record(newest)],
      gone
    );

    expect(scope?.retired).toEqual([
      { action: "update", resource: "posts" },
      { action: "publish", resource: "posts" },
    ]);
  });

  it("is kept from what a plugin the newest does not record declares", () => {
    const scope = leftoverOrphanScopeOf(
      [record({ collections: { posts } }), record({})],
      gone
    );
    const flow = {
      name: "flow",
      contributes: { permissions: [{ action: "publish", resource: "posts" }] },
    };

    const { kept } = keepingUnrecordedPlugins(scope!, {
      plugins: [flow as never],
    });

    expect(kept).toEqual([
      expect.objectContaining({ action: "publish", resource: "posts" }),
    ]);
  });

  it("is none where nothing is gone, or the newest says nothing of permissions", () => {
    const nothing = {
      collection: new Set<string>(),
      single: new Set<string>(),
    };
    const before = record({ collections: { posts } });

    expect(
      leftoverOrphanScopeOf([before, record({})], nothing)
    ).toBeUndefined();
    expect(leftoverOrphanScopeOf([before, undefined], gone)).toBeUndefined();
    expect(leftoverOrphanScopeOf([], gone)).toBeUndefined();
  });
});

describe("orphanScopeOf", () => {
  it("names the permissions of each collection and Single the point before declares and it does not", () => {
    const before = snapshot(
      record({
        app: owned(["audit", "reports"]),
        collections: {
          posts: owned(["read", "posts"]),
          pages: owned(["read", "pages"]),
        },
        singles: { site: owned(["update", "site"]) },
      })
    );
    const scope = orphanScopeOf({
      snapshot: snapshot(
        record({ collections: { pages: owned(["read", "pages"]) } })
      ),
      before,
      previous: null,
      record: undefined,
    });

    expect(scope?.retired).toEqual([
      { action: "read", resource: "posts" },
      { action: "update", resource: "site" },
    ]);
  });

  it("names none where the point before it says nothing", () => {
    const scope = orphanScopeOf({
      snapshot: snapshot(record({})),
      before: snapshot(),
      previous: null,
      record: undefined,
    });

    expect(scope?.retired ?? []).toEqual([]);
  });

  it("declares every permission the snapshot records, whoever owns it", () => {
    const scope = orphanScopeOf({
      snapshot: snapshot(
        record({
          app: owned(["audit", "reports"]),
          plugins: { "@acme/forms": owned(["export", "submissions"]) },
          collections: { posts: owned(["read", "posts"]) },
          singles: { site: owned(["update", "site"]) },
        })
      ),
      before: null,
      previous: null,
      record: undefined,
    });

    expect(scope?.declared).toEqual(
      expect.arrayContaining([
        { action: "audit", resource: "reports" },
        { action: "export", resource: "submissions" },
        { action: "read", resource: "posts" },
        { action: "update", resource: "site" },
      ])
    );
    expect(scope?.declared).toHaveLength(4);
  });

  it("speaks for the app, each plugin it records and each plugin the snapshot before it recorded", () => {
    const scope = orphanScopeOf({
      snapshot: snapshot(
        record({ plugins: { "@acme/kept": owned(["sync", "feeds"]) } })
      ),
      before: snapshot(
        record({
          plugins: {
            "@acme/kept": owned(["sync", "feeds"]),
            "@acme/removed": owned(["export", "logs"]),
          },
        })
      ),
      previous: "20260101_a",
      record: { point: null, baseline: undefined },
    });

    expect([...(scope?.owners ?? [])].sort()).toEqual([
      "@acme/kept",
      "@acme/removed",
      "app",
    ]);
    expect(scope?.heldSlugs).toBeUndefined();
  });

  it("speaks for what the registry baseline held where the point before is the record's", () => {
    const baseline = {
      collections: {},
      singles: {},
      fieldGroups: {},
      permissions: ["export-logs", "read-users"],
    };
    const scope = orphanScopeOf({
      snapshot: snapshot(record({})),
      // The snapshot before carries no permission record.
      before: { entities: ENTITIES },
      previous: "20260101_a",
      record: { point: "20260101_a", baseline },
    });

    expect([...(scope?.heldSlugs ?? [])]).toEqual([
      "export-logs",
      "read-users",
    ]);
    expect([...(scope?.owners ?? [])]).toEqual(["app"]);
  });

  it("reads no baseline kept at another point", () => {
    const scope = orphanScopeOf({
      snapshot: snapshot(record({})),
      before: null,
      previous: "20260102_b",
      record: {
        point: "20260101_a",
        baseline: {
          collections: {},
          singles: {},
          fieldGroups: {},
          permissions: ["export-logs"],
        },
      },
    });

    expect(scope?.heldSlugs).toBeUndefined();
  });

  it("orphans nothing from a snapshot without the registry metadata or a permission record", () => {
    expect(
      orphanScopeOf({
        snapshot: { permissions: record({}) },
        before: null,
        previous: null,
        record: undefined,
      })
    ).toBeUndefined();
    expect(
      orphanScopeOf({
        snapshot: snapshot(),
        before: null,
        previous: null,
        record: undefined,
      })
    ).toBeUndefined();
  });
});
