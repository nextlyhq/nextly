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
import { orphanScopeOf } from "../permission-orphans";

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

describe("orphanScopeOf", () => {
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
