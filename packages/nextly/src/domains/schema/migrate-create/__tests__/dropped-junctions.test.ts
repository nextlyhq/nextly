/**
 * Which many-to-many tables a migration that removes entities drops, where, and how its DOWN makes
 * them again.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseSqlSections } from "../../migrate/sql-sections";
import { droppedJunctions, junctionDropsPlaced } from "../dropped-junctions";
import { generateMigration, type MinimalConfigEntity } from "../generate";

const manyToMany = (name: string, target: string, more: object = {}) => ({
  name,
  type: "relationship",
  options: { relationType: "manyToMany", target, ...more },
});
const recorded = (fields: unknown[], more: object = {}) => ({
  source: "code" as const,
  settings: { fields, ...more },
});

const EVENTS = recorded([manyToMany("people", "people")]);
const PEOPLE = recorded([{ name: "title", type: "text" }]);

type Args = Parameters<typeof droppedJunctions>[0];
const judged = (over: Partial<Args> = {}) =>
  droppedJunctions({
    operations: [{ type: "drop_table", tableName: "dc_events" }],
    previous: {
      tables: [
        { name: "dc_events", columns: [] },
        { name: "dc_people", columns: [] },
      ],
    },
    previousEntities: {
      collections: { events: EVENTS, people: PEOPLE },
      singles: {},
      fieldGroups: {},
    } as never,
    remaining: {
      collections: [{ slug: "people", tableName: "dc_people", fields: [] }],
      singles: [],
    },
    droppedAlready: new Set(),
    dialect: "postgresql",
    ...over,
  });
const NONE = { up: [], down: [] };

describe("a removed entity's many-to-many tables", () => {
  it("on PostgreSQL go where only a table of another case is kept", () => {
    const links = manyToMany("people", "people", { junctionTable: "Links" });
    const { up } = judged({
      previousEntities: {
        collections: { events: recorded([links]), people: PEOPLE },
        singles: {},
        fieldGroups: {},
      } as never,
      remaining: {
        collections: [
          {
            slug: "people",
            tableName: "dc_people",
            fields: [
              manyToMany("events", "events", { junctionTable: "links" }),
            ],
          },
        ],
        singles: [],
      },
    });

    expect(up.map(each => each.statement)).toEqual([
      'DROP TABLE IF EXISTS "Links"',
    ]);
  });

  it("stay, with nothing to make again, where their recorded actions take no link table", () => {
    const legacy = manyToMany("people", "people", { onDelete: "set null" });
    const { up, down } = judged({
      previousEntities: {
        collections: { events: recorded([legacy]), people: PEOPLE },
        singles: {},
        fieldGroups: {},
      } as never,
    });

    expect({ up, down }).toEqual(NONE);
  });

  it("go, and come back with both keys", () => {
    const { up, down } = judged();

    expect(up).toEqual([
      {
        links: ["dc_events", "dc_people"],
        statement: 'DROP TABLE IF EXISTS "dc_events_dc_people_people"',
      },
    ]);
    expect(down[0]).toContain(
      'CREATE TABLE IF NOT EXISTS "dc_events_dc_people_people"'
    );
    expect(down[0]).toContain('REFERENCES "dc_events"');
    expect(down[0]).toContain('REFERENCES "dc_people"');
    expect(down.some(statement => /;$|breakpoint/.test(statement))).toBe(false);
  });

  it.each([
    [
      "its entity is still declared",
      {
        remaining: {
          collections: [{ slug: "events", tableName: "dc_moved", fields: [] }],
          singles: [],
        },
      },
    ],
    ["its main table stays", { operations: [] }],
    ["no declarations were recorded", { previousEntities: undefined }],
    [
      "the caller's own statements drop it",
      { droppedAlready: new Set(["dc_events_dc_people_people"]) },
    ],
    [
      "a remaining collection's field names it too, in another case on MySQL",
      {
        dialect: "mysql",
        remaining: {
          collections: [
            {
              slug: "people",
              tableName: "dc_people",
              fields: [
                manyToMany("links", "events", {
                  junctionTable: "DC_events_dc_people_people",
                }),
              ],
            },
          ],
          singles: [],
        },
      },
    ],
    [
      "a remaining Single's field names it too",
      {
        remaining: {
          collections: [],
          singles: [
            {
              slug: "home",
              tableName: "single_home",
              fields: [
                manyToMany("links", "people", {
                  junctionTable: "dc_events_dc_people_people",
                }),
              ],
            },
          ],
        },
      },
    ],
  ])("stay where %s", (_label, over) => {
    expect(judged(over as Partial<Args>)).toEqual(NONE);
  });

  it("stay where the name is an entity's own table", () => {
    const events = recorded([
      manyToMany("people", "people", { junctionTable: "dc_people" }),
    ]);
    expect(
      judged({
        previousEntities: {
          collections: { events, people: PEOPLE },
          singles: {},
          fieldGroups: {},
        } as never,
      })
    ).toEqual(NONE);
  });

  it("go once where two of its fields name one", () => {
    const events = recorded([
      manyToMany("a", "people", { junctionTable: "links" }),
      manyToMany("b", "people", { junctionTable: "links" }),
    ]);
    const { up } = judged({
      previousEntities: {
        collections: { events, people: PEOPLE },
        singles: {},
        fieldGroups: {},
      } as never,
    });
    expect(up.map(drop => drop.statement)).toEqual([
      'DROP TABLE IF EXISTS "links"',
    ]);
  });

  it("are not made again where the table they link to is not one to return to", () => {
    const { up, down } = judged({
      previous: { tables: [{ name: "dc_events", columns: [] }] },
    });
    expect([up.length, down]).toEqual([1, []]);
  });

  it("come back naming the table a linked collection is kept in", () => {
    const { down } = judged({
      previous: {
        tables: [
          { name: "dc_events", columns: [] },
          { name: "dc_folk", columns: [] },
        ],
      },
      previousEntities: {
        collections: {
          events: EVENTS,
          people: recorded([], { dbName: "dc_folk" }),
        },
        singles: {},
        fieldGroups: {},
      } as never,
    });
    expect(down[0]).toContain('REFERENCES "dc_folk"');
  });
});

describe("the drop of a many-to-many table", () => {
  const drop = {
    links: ["dc_events", "dc_people"],
    statement: 'DROP TABLE IF EXISTS "j"',
  };

  it("comes before the first drop of either table it links, after the file's guards", () => {
    expect(
      junctionDropsPlaced(
        ["SELECT guard()", 'DROP TABLE "dc_people"', 'DROP TABLE "dc_events"'],
        [drop],
        "sqlite"
      )
    ).toEqual([
      "SELECT guard()",
      'DROP TABLE IF EXISTS "j"',
      'DROP TABLE "dc_people"',
      'DROP TABLE "dc_events"',
    ]);
  });
});

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

describe.each(DIALECTS)(
  "a migration that removes a collection with a many-to-many field (%s)",
  dialect => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "nextly-junctions-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    const entity = (
      slug: string,
      fields: MinimalConfigEntity["fields"]
    ): MinimalConfigEntity => ({
      slug,
      tableName: `dc_${slug}`,
      fields,
      settings: { source: "builder", settings: { slug, fields } as never },
    });
    const people = entity("people", [{ name: "title", type: "text" }]);
    const events = entity("events", [
      manyToMany("people", "people") as MinimalConfigEntity["fields"][number],
    ]);

    /** The file of `step`, with `appended` as a Schema Builder save hands its own statements. */
    async function written(
      step: number,
      collections: MinimalConfigEntity[],
      appended: object = {}
    ) {
      const result = await generateMigration({
        name: `step_${step}`,
        dialect,
        migrationsDir: dir,
        collections,
        singles: [],
        components: [],
        nonInteractive: true,
        ...appended,
        now: new Date(Date.UTC(2026, 10, 6, 12, step)),
      });
      return parseSqlSections(await readFile(result!.sqlPath, "utf-8"));
    }

    const LINKS = "dc_events_dc_people_people";
    const all = (sql: string, what: RegExp) =>
      [...sql.matchAll(what)].map(match => match.index);

    it("drops the links' table once, before the main table, and makes it again once", async () => {
      await written(1, [people, events]);

      const { upSql, downSql } = await written(2, [people]);

      const links = all(upSql, new RegExp(`DROP TABLE.*${LINKS}`, "g"));
      const main = all(upSql, /DROP TABLE.*["`]dc_events["`]/g);
      expect([links.length, main.length], upSql).toEqual([1, 1]);
      expect(links[0]).toBeLessThan(main[0]);
      expect(
        all(downSql, new RegExp(`CREATE TABLE.*${LINKS}`, "g")),
        downSql
      ).toHaveLength(1);
    });

    it("adds neither where the Schema Builder's own statements do both", async () => {
      await written(1, [people, events]);

      const { upSql, downSql } = await written(2, [people], {
        appendedStatements: {
          up: { first: [`DROP TABLE IF EXISTS ${LINKS}`], last: [] },
          down: { first: [], last: [`CREATE TABLE ${LINKS} (id int)`] },
        },
      });

      expect(
        all(upSql, new RegExp(`DROP TABLE.*${LINKS}`, "g")),
        upSql
      ).toHaveLength(1);
      expect(
        all(downSql, new RegExp(`CREATE TABLE.*${LINKS}`, "g")),
        downSql
      ).toHaveLength(1);
    });
  }
);

describe("a scoped run that removes a collection", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nextly-junctions-scoped-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps a link table a collection outside its scope names too", async () => {
    const entity = (
      slug: string,
      fields: MinimalConfigEntity["fields"]
    ): MinimalConfigEntity => ({
      slug,
      tableName: `dc_${slug}`,
      fields,
      settings: { source: "builder", settings: { slug, fields } as never },
    });
    const shared = (target: string) =>
      manyToMany("links", target, {
        junctionTable: "links",
      }) as MinimalConfigEntity["fields"][number];
    const people = entity("people", [shared("events")]);
    const events = entity("events", [shared("people")]);
    const run = (
      step: number,
      collections: MinimalConfigEntity[],
      scoped: boolean
    ) =>
      generateMigration({
        name: `step_${step}`,
        dialect: "postgresql",
        migrationsDir: dir,
        collections,
        singles: [],
        components: [],
        nonInteractive: true,
        ...(scoped
          ? {
              scope: {
                kind: "collection" as const,
                slug: "events",
                tables: new Set(["dc_events"]),
              },
            }
          : {}),
        now: new Date(Date.UTC(2026, 10, 6, 12, step)),
      });
    await run(1, [people, events], false);

    const result = await run(2, [people], true);

    const { upSql } = parseSqlSections(
      await readFile(result!.sqlPath, "utf-8")
    );
    expect(upSql).toMatch(/DROP TABLE.*"dc_events"/);
    expect(upSql).not.toMatch(/DROP TABLE[^;]*"links"/);
  });
});
