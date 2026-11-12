/**
 * Which entities an applied migration changed, read from its snapshot against
 * the newest snapshot before it: the rows a development run of `nextly migrate`
 * brings to the snapshot beside the ones it adds.
 */
import { describe, expect, it } from "vitest";

import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "../../migrate-create/entity-settings";
import {
  addAppliedEntityChanges,
  noAppliedEntityChanges,
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
