/**
 * Which entities an applied migration changed, read from its snapshot against
 * the newest snapshot before it: the rows a development run of `nextly migrate`
 * brings to the snapshot beside the ones it adds.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "../../migrate-create/entity-settings";
import {
  addAppliedEntityChanges,
  noAppliedEntityChanges,
  outstandingEntityChanges,
  type AppliedEntityChanges,
} from "../applied-entity-changes";

const entity = (
  fields: string[],
  description = ""
): RecordedEntitySettings => ({
  source: "code",
  settings: {
    description,
    fields: fields.map(name => ({ name, type: "text" })),
  },
});

const record = (
  collections: Record<string, RecordedEntitySettings>,
  singles: Record<string, RecordedEntitySettings> = {}
): EntitySettingsRecord => ({ collections, singles, fieldGroups: {} });

/** Each kind's changed slugs, sorted, so a case reads as the answer it wants. */
function listed(changes: AppliedEntityChanges): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(changes).map(([kind, slugs]) => [kind, [...slugs].sort()])
  );
}

describe("the entities an applied migration changed", () => {
  it("names every entity the first snapshot records", () => {
    const changes = noAppliedEntityChanges();
    addAppliedEntityChanges(changes, {
      snapshot: {
        entities: record(
          { posts: entity(["title"]), tags: entity(["label"]) },
          { site: entity(["tagline"]) }
        ),
      },
      before: null,
    });
    expect(listed(changes)).toEqual({
      collection: ["posts", "tags"],
      single: ["site"],
      fieldGroup: [],
    });
  });

  it("names only the entity whose settings differ from the snapshot before", () => {
    const changes = noAppliedEntityChanges();
    addAppliedEntityChanges(changes, {
      snapshot: {
        entities: record({
          posts: entity(["title", "body"]),
          tags: entity(["label"]),
        }),
      },
      before: {
        entities: record({ posts: entity(["title"]), tags: entity(["label"]) }),
      },
    });
    expect(listed(changes).collection).toEqual(["posts"]);
  });

  it("names a setting's change as well as a field's", () => {
    const changes = noAppliedEntityChanges();
    addAppliedEntityChanges(changes, {
      snapshot: { entities: record({ tags: entity(["label"], "All tags") }) },
      before: { entities: record({ tags: entity(["label"], "Tags") }) },
    });
    expect(listed(changes).collection).toEqual(["tags"]);
  });

  // The snapshot before predates recorded settings, so it says nothing of
  // them: every entity the applied one records is named.
  it("names every entity where the snapshot before has no record", () => {
    const changes = noAppliedEntityChanges();
    addAppliedEntityChanges(changes, {
      snapshot: { entities: record({ posts: entity(["title"]) }) },
      before: {},
    });
    expect(listed(changes).collection).toEqual(["posts"]);
  });

  it("names nothing for a snapshot without the record, or an entity it no longer records", () => {
    const changes = noAppliedEntityChanges();
    addAppliedEntityChanges(changes, {
      snapshot: {},
      before: { entities: record({ posts: entity(["title"]) }) },
    });
    addAppliedEntityChanges(changes, {
      snapshot: { entities: record({ posts: entity(["title"]) }) },
      before: {
        entities: record({ posts: entity(["title"]), tags: entity(["label"]) }),
      },
    });
    expect(listed(changes)).toEqual({
      collection: [],
      single: [],
      fieldGroup: [],
    });
  });

  it("gathers the changes of every migration a run applies", () => {
    const changes = noAppliedEntityChanges();
    const first = record({ posts: entity(["title"]) });
    const second = record({
      posts: entity(["title"]),
      tags: entity(["label"]),
    });
    addAppliedEntityChanges(changes, {
      snapshot: { entities: first },
      before: null,
    });
    addAppliedEntityChanges(changes, {
      snapshot: { entities: second },
      before: { entities: first },
    });
    expect(listed(changes).collection).toEqual(["posts", "tags"]);
  });
});

describe("the rows the applied migrations still owe", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-owed-rows-"));
    mkdirSync(join(dir, "meta"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A snapshot of today's shape beside migration `base`, recording `entities`. */
  function snapshot(base: string, entities: EntitySettingsRecord): void {
    writeFileSync(
      join(dir, "meta", `${base}.snapshot.json`),
      JSON.stringify({
        version: 1,
        migrationHash: "a".repeat(64),
        snapshot: { tables: [] },
        entities,
      })
    );
  }
  const applied =
    (...names: string[]) =>
    (file: string) =>
      Promise.resolve(names.map(name => `${name}.sql`).includes(file));

  const first = "20260101_000000_000_create";
  const second = "20260102_000000_000_add_body";
  const third = "20260103_000000_000_add_tags";
  beforeEach(() => {
    snapshot(first, record({ posts: entity(["title"]) }));
    snapshot(second, record({ posts: entity(["title", "body"]) }));
    snapshot(
      third,
      record({ posts: entity(["title", "body"]), tags: entity(["label"]) })
    );
  });

  it("are what the applied migrations after the stored version changed", async () => {
    const owed = await outstandingEntityChanges({
      migrationsDir: dir,
      isApplied: applied(first, second, third),
      writtenThrough: first,
    });
    expect(listed(owed).collection).toEqual(["posts", "tags"]);
  });

  // A run that applied `second` and failed to write its row left the version
  // at `first`: the next run still owes posts' row, though it applies nothing.
  it("include a migration a failed run applied without writing its rows", async () => {
    const owed = await outstandingEntityChanges({
      migrationsDir: dir,
      isApplied: applied(first, second),
      writtenThrough: first,
    });
    expect(listed(owed).collection).toEqual(["posts"]);
  });

  it("are none once the version names the newest applied migration", async () => {
    const owed = await outstandingEntityChanges({
      migrationsDir: dir,
      isApplied: applied(first, second),
      writtenThrough: second,
    });
    expect(listed(owed)).toEqual({
      collection: [],
      single: [],
      fieldGroup: [],
    });
  });

  it("are every applied migration's changes where no version names one", async () => {
    const owed = await outstandingEntityChanges({
      migrationsDir: dir,
      isApplied: applied(first, second, third),
      writtenThrough: null,
    });
    expect(listed(owed).collection).toEqual(["posts", "tags"]);
  });

  it("leave out a migration not applied", async () => {
    const owed = await outstandingEntityChanges({
      migrationsDir: dir,
      isApplied: applied(first),
      writtenThrough: null,
    });
    expect(listed(owed).collection).toEqual(["posts"]);
  });
});
