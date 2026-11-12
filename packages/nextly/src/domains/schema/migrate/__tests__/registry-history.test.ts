/**
 * What the applied snapshots, in run order, say a migration changed in the
 * registry: drops, Builder settings cleared, field types changed, entities
 * added. Each rule is judged against the plausible broken reading beside it.
 */
import { describe, expect, it } from "vitest";

import type {
  EntitySettingsRecord,
  RecordedEntitySettings,
} from "../../migrate-create/entity-settings";
import {
  addedEntities,
  clearedSettings,
  droppedEntities,
  typeChangedEntities,
} from "../registry-history";

const code = (fields: unknown[] = []): RecordedEntitySettings => ({
  source: "code",
  settings: { fields } as RecordedEntitySettings["settings"],
});

const builder = (
  settings: Record<string, unknown> = {}
): RecordedEntitySettings => ({
  source: "builder",
  settings: { fields: [], ...settings } as RecordedEntitySettings["settings"],
});

const record = (
  collections: Record<string, RecordedEntitySettings> = {},
  singles: Record<string, RecordedEntitySettings> = {},
  fieldGroups: Record<string, RecordedEntitySettings> = {}
): EntitySettingsRecord => ({ collections, singles, fieldGroups });

describe("droppedEntities", () => {
  it("names an entity a record held and the next no longer holds", () => {
    const dropped = droppedEntities([
      record({ posts: code(), tags: code() }, { site: code() }),
      record({ posts: code() }),
    ]);
    expect([...dropped.collection]).toEqual(["tags"]);
    expect([...dropped.single]).toEqual(["site"]);
  });

  // Read from the newest record alone, a drop several migrations back would
  // be missed; read as "absent from newest", an entity never recorded would
  // be named.
  it("names a drop several migrations back, and nothing no record ever held", () => {
    const dropped = droppedEntities([
      record({ posts: code(), tags: code() }),
      record({ posts: code() }),
      record({ posts: code(), notes: code() }),
    ]);
    expect([...dropped.collection]).toEqual(["tags"]);
  });

  it("does not name an entity dropped and recorded again later", () => {
    const dropped = droppedEntities([
      record({ tags: code() }),
      record({}),
      record({ tags: code() }),
    ]);
    expect(dropped.collection.size).toBe(0);
  });
});

describe("addedEntities", () => {
  it("names what the rolled-back records hold and the point does not", () => {
    const added = addedEntities(
      [record({ posts: code(), tags: code() }, {}, { hero: code() })],
      record({ posts: code() })
    );
    expect([...added.collection]).toEqual(["tags"]);
    expect([...added.fieldGroup]).toEqual(["hero"]);
  });
});

describe("clearedSettings", () => {
  it("clears what an earlier record of a Builder entity said and the target does not", () => {
    const cleared = clearedSettings(record({ events: builder() }), [
      record({ events: builder({ description: "Things", admin: { a: 1 } }) }),
    ]);
    expect(cleared.get("collection:events")).toEqual(
      new Set(["description", "admin"])
    );
  });

  // A setting no record ever said may have been stored by other means; the
  // Builder's own upsert leaves it, and so does this.
  it("clears nothing no earlier record said", () => {
    const cleared = clearedSettings(record({ events: builder() }), [
      record({ events: builder() }),
    ]);
    expect(cleared.size).toBe(0);
  });

  it("clears nothing the target still says, and nothing of a code entity", () => {
    const cleared = clearedSettings(
      record({
        events: builder({ description: "Still" }),
        posts: code(),
      }),
      [
        record({
          events: builder({ description: "Before" }),
          posts: {
            source: "code",
            settings: { fields: [], description: "Posts" },
          },
        }),
      ]
    );
    expect(cleared.size).toBe(0);
  });
});

describe("typeChangedEntities", () => {
  it("names an entity a field of which changes type, at any depth", () => {
    const changed = typeChangedEntities(
      record(
        { scores: code([{ name: "points", type: "text" }]) },
        {},
        {
          hero: code([
            {
              name: "cta",
              type: "group",
              fields: [{ name: "count", type: "text" }],
            },
          ]),
        }
      ),
      record(
        { scores: code([{ name: "points", type: "number" }]) },
        {},
        {
          hero: code([
            {
              name: "cta",
              type: "group",
              fields: [{ name: "count", type: "number" }],
            },
          ]),
        }
      )
    );
    expect([...changed.collection]).toEqual(["scores"]);
    expect([...changed.fieldGroup]).toEqual(["hero"]);
  });

  // The column changes shape with the type unchanged: a select holding many
  // values, or a relationship to several collections.
  it("names an entity a field of which turns to hold many values or relate to several", () => {
    const changed = typeChangedEntities(
      record({
        tags: code([{ name: "kind", type: "select" }]),
        links: code([
          { name: "to", type: "relationship", relationTo: "posts" },
        ]),
      }),
      record({
        tags: code([{ name: "kind", type: "select", hasMany: true }]),
        links: code([
          {
            name: "to",
            type: "relationship",
            relationTo: ["posts", "pages"],
          },
        ]),
      })
    );
    expect([...changed.collection].sort()).toEqual(["links", "tags"]);
  });

  // Every key that may change how a field is stored counts, not a list of
  // the ones known today: a decimal number, a required column.
  it("names an entity a field of which changes its storage another way", () => {
    const changed = typeChangedEntities(
      record({
        prices: code([{ name: "amount", type: "number" }]),
        notes: code([{ name: "body", type: "text" }]),
      }),
      record({
        prices: code([{ name: "amount", type: "number", dbType: "decimal" }]),
        notes: code([{ name: "body", type: "text", required: true }]),
      })
    );
    expect([...changed.collection].sort()).toEqual(["notes", "prices"]);
  });

  it("names no entity whose field changed only its label or default", () => {
    const changed = typeChangedEntities(
      record({ posts: code([{ name: "title", type: "text" }]) }),
      record({
        posts: code([
          { name: "title", type: "text", label: "Title", defaultValue: "x" },
        ]),
      })
    );
    expect(changed.collection.size).toBe(0);
  });

  it("names no entity whose fields changed only a help text", () => {
    const changed = typeChangedEntities(
      record({ posts: code([{ name: "title", type: "text" }]) }),
      record({
        posts: code([
          { name: "title", type: "text", admin: { description: "Help" } },
        ]),
      })
    );
    expect(changed.collection.size).toBe(0);
  });

  // A field added or removed changes the field list, not a type: its row is
  // written at the run's end like any other.
  it("names no entity whose fields were only added or removed", () => {
    const changed = typeChangedEntities(
      record({ posts: code([{ name: "title", type: "text" }]) }),
      record({ posts: code([{ name: "body", type: "text" }]) })
    );
    expect(changed.collection.size).toBe(0);
  });
});
