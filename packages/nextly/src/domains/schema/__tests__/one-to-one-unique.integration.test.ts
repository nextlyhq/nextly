/**
 * A Schema Builder one-to-one is unique exactly while it is one-to-one, on every dialect.
 *
 * A relationship created one-to-one, or edited into one, refuses a second entry pointing at a
 * target another entry already points at, and the preview names the uniqueness before the apply
 * runs. Edited back to many-to-one, the column takes repeats again. An edit into a one-to-one over
 * entries that already repeat a target is refused before anything runs, naming the field and how
 * many targets repeat; entries that point at nothing never count as repeats. A translated one-to-one
 * is unique within each language. A one-to-one made before this change, whose uniqueness is an
 * inline constraint, plans no operation for it on a later save.
 *
 * Driven through the Builder's dispatcher, as the admin's save is, against a real database.
 *
 * @module domains/schema/__tests__/one-to-one-unique.integration.test
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { clearServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { NextlyError } from "../../../errors/nextly-error";
import { clearCachedSnapshot } from "../../../init/schema-snapshot-cache";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import { getColumnDescriptor } from "../services/field-column-descriptor";
import { _resetApplyDesiredSchemaForTests } from "../pipeline/index";

/**
 * The profiles' table as the Builder created it before a one-to-one's uniqueness was declared:
 * the statements its DDL emitted, captured per dialect.
 */
const beforeThisChange = JSON.parse(
  readFileSync(
    resolve(__dirname, "fixtures/one-to-one-before-unique.json"),
    "utf-8"
  )
) as { statements: Record<TestDialect, string[]> };

const PEOPLE = "o2o_people";
const PROFILES = "o2o_profiles";
const PROFILES_TABLE = `dc_${PROFILES}`;

/**
 * The profiles' relationship to a person as the Builder's editor sends it on a save: one-to-one is
 * a relationship to one entry marked unique, many-to-one the same without the mark.
 */
const person = (relationType: "oneToOne" | "manyToOne", localized = false) => ({
  name: "person",
  type: "relationship",
  relationTo: PEOPLE,
  ...(relationType === "oneToOne" ? { unique: true } : {}),
  ...(localized ? { localized: true } : {}),
});

/**
 * The same relationship as the Builder's create stores it, with its cardinality in
 * `options.relationType`: the shape every relationship the earlier Builder made still has.
 */
const storedPerson = (
  relationType: "oneToOne" | "manyToOne",
  localized = false
) => ({
  name: "person",
  type: "relationship",
  ...(localized ? { localized: true } : {}),
  options: { target: PEOPLE, relationType, onDelete: "set null" },
});

const profileFields = (
  relationType: "oneToOne" | "manyToOne",
  localized = false
) => [{ name: "title", type: "text" }, person(relationType, localized)];

let current: TestNextly | undefined;
let projectRoot: string;

beforeEach(async () => {
  // The Builder writes the app's schema files; they go to a folder of the test's own.
  projectRoot = await mkdtemp(join(tmpdir(), "nextly-one-to-one-"));
  vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
  // An apply with the same desired schema as an earlier case's would otherwise be skipped.
  clearCachedSnapshot();
  _resetApplyDesiredSchemaForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  clearServices();
  clearCachedSnapshot();
  vi.unstubAllEnvs();
  await rm(projectRoot, { recursive: true, force: true });
});

/**
 * One Builder call as a development server runs it, where a save applies its DDL at once and the
 * running instance registers what it created.
 */
async function builder(
  method: string,
  params: object,
  body: unknown
): Promise<unknown> {
  vi.stubEnv("NODE_ENV", "development");
  try {
    return await dispatchCollections(
      {} as ServiceContainer,
      method,
      params as never,
      body
    );
  } finally {
    vi.unstubAllEnvs();
  }
}

/**
 * Boot, and create the people and the profiles that point at them through the Builder: the
 * profiles created, then given their relationship by a save, as today's editor builds a
 * collection. With `legacy`, the relationship is created as the earlier Builder stored it.
 */
async function boot(
  dialect: TestDialect,
  relationType: "oneToOne" | "manyToOne",
  options: { localized?: boolean; legacy?: boolean } = {}
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    basePath: projectRoot,
    ...(options.localized
      ? { localization: { locales: ["en", "de"], defaultLocale: "en" } }
      : {}),
  });
  await builder(
    "createCollection",
    {},
    { name: PEOPLE, label: "People", fields: [{ name: "name", type: "text" }] }
  );
  await builder(
    "createCollection",
    {},
    {
      name: PROFILES,
      label: "Profiles",
      ...(options.localized ? { localized: true } : {}),
      fields: [
        { name: "title", type: "text" },
        ...(options.legacy
          ? [storedPerson(relationType, options.localized)]
          : []),
      ],
    }
  );
  if (!options.legacy) {
    await apply(
      current,
      profileFields(relationType, options.localized),
      options.localized
    );
  }
  return current;
}

/** The profiles' registry version, which an apply echoes back. */
async function schemaVersion(t: TestNextly): Promise<number> {
  const q = (name: string) =>
    t.adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const [row] = await t.adapter.executeQuery<{ v: unknown }>(
    `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${PROFILES}'`
  );
  return Number(row?.v ?? 1);
}

/** The Builder's preview of a change to the profiles' fields. */
async function preview(fields: unknown[], localized?: boolean) {
  return (await builder(
    "previewSchemaChanges",
    { collectionName: PROFILES },
    { fields, ...(localized === undefined ? {} : { localized }) }
  )) as Response;
}

/** The Builder's apply of a change to the profiles' fields, as the admin confirms it. */
async function apply(t: TestNextly, fields: unknown[], localized?: boolean) {
  const result = await builder(
    "applySchemaChanges",
    { collectionName: PROFILES },
    {
      fields,
      confirmed: true,
      schemaVersion: await schemaVersion(t),
      ...(localized === undefined ? {} : { localized }),
    }
  );
  clearRegistryRowCache();
  return result;
}

/** A person, by id. */
async function aPerson(t: TestNextly, name: string): Promise<string> {
  const created = await t.nextly.create({ collection: PEOPLE, data: { name } });
  return (created.item as { id: string }).id;
}

/** A profile pointing at `target` (or at nothing), in `locale` when given. */
async function aProfile(
  t: TestNextly,
  target: string | null,
  locale?: string
): Promise<string> {
  const created = await t.nextly.create({
    collection: PROFILES,
    data: { title: "a profile", person: target },
    ...(locale ? { locale } : {}),
  });
  return (created.item as { id: string }).id;
}

/** Whether the write was refused because the target is already taken. */
async function refusedAsRepeat(write: Promise<unknown>): Promise<boolean> {
  const outcome = await write.then(
    () => undefined,
    (error: unknown) => error
  );
  if (outcome === undefined) return false;
  if (!NextlyError.is(outcome)) throw outcome;
  expect(outcome.code).toBe("DUPLICATE");
  return true;
}

/** Each unique index on the profiles' `person` column, as introspection reads the live table. */
async function personUniques(t: TestNextly): Promise<string[]> {
  const live = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect,
    [PROFILES_TABLE]
  );
  return (live.tables[0]?.indexes ?? [])
    .filter(index => index.unique && index.columns.join() === "person")
    .map(index => index.name);
}

/** The preview's words, as the admin's dialog shows them. */
async function previewText(response: Response): Promise<string> {
  return JSON.stringify(await response.json());
}

describeEachDialect(
  "a one-to-one is unique exactly while it is one-to-one",
  dialect => {
    it("refuses a second profile pointing at a person a profile created one-to-one already points at", async () => {
      const t = await boot(dialect, "oneToOne");
      const ada = await aPerson(t, "Ada");
      await aProfile(t, ada);

      expect(await refusedAsRepeat(aProfile(t, ada))).toBe(true);
      // Another person is free.
      expect(await refusedAsRepeat(aProfile(t, await aPerson(t, "Bo")))).toBe(
        false
      );
    }, 120_000);

    it("makes a many-to-one edited into a one-to-one unique, and the preview says so first", async () => {
      const t = await boot(dialect, "manyToOne");
      const ada = await aPerson(t, "Ada");
      await aProfile(t, ada);

      const said = await previewText(await preview(profileFields("oneToOne")));
      expect(said).toContain(
        `\\"person\\" becomes one-to-one: its column will be made unique`
      );
      await apply(t, profileFields("oneToOne"));

      expect(await refusedAsRepeat(aProfile(t, ada))).toBe(true);
    }, 120_000);

    it("lets a one-to-one edited into a many-to-one take a repeat, and the preview says so first", async () => {
      const t = await boot(dialect, "oneToOne");
      const ada = await aPerson(t, "Ada");
      await aProfile(t, ada);

      const said = await previewText(await preview(profileFields("manyToOne")));
      expect(said).toContain(
        `\\"person\\" is no longer one-to-one: its column will no longer be unique`
      );
      await apply(t, profileFields("manyToOne"));

      expect(await refusedAsRepeat(aProfile(t, ada))).toBe(false);
      expect(await personUniques(t)).toEqual([]);
    }, 120_000);

    it("refuses an edit into a one-to-one over profiles that repeat a person, naming the field and the count, and changes nothing", async () => {
      const t = await boot(dialect, "manyToOne");
      const ada = await aPerson(t, "Ada");
      const bo = await aPerson(t, "Bo");
      for (const target of [ada, ada, ada, bo, bo]) await aProfile(t, target);

      const outcome = await apply(t, profileFields("oneToOne")).then(
        () => undefined,
        (error: unknown) => error
      );

      expect(NextlyError.is(outcome)).toBe(true);
      const refusal = outcome as NextlyError;
      expect(refusal.code).toBe("VALIDATION_ERROR");
      expect(refusal.publicData).toMatchObject({
        errors: [
          {
            path: "fields.person",
            message: expect.stringContaining(
              `"person" can't become one-to-one: 2 targets are each pointed at by more than one entry.`
            ),
          },
        ],
      });
      // Nothing ran: still many-to-one, and still taking repeats.
      expect(await personUniques(t)).toEqual([]);
      expect(await refusedAsRepeat(aProfile(t, ada))).toBe(false);
    }, 120_000);

    it("never counts profiles that point at nothing as repeats", async () => {
      const t = await boot(dialect, "manyToOne");
      for (let i = 0; i < 3; i++) await aProfile(t, null);
      await aProfile(t, await aPerson(t, "Ada"));

      await apply(t, profileFields("oneToOne"));

      expect(await personUniques(t)).toHaveLength(1);
      // Still free to point at nothing, again and again.
      expect(await refusedAsRepeat(aProfile(t, null))).toBe(false);
    }, 120_000);

    it("plans nothing for a one-to-one made before this change, and keeps it unique", async () => {
      const t = await boot(dialect, "oneToOne", { legacy: true });
      // The profiles' table as the Builder created it before: the one-to-one unique by an inline
      // constraint, beside a plain index on the column.
      const statements = beforeThisChange.statements[dialect];
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await t.adapter.executeQuery(`DROP TABLE ${q(PROFILES_TABLE)}`);
      for (const statement of statements.filter(s =>
        s.includes(PROFILES_TABLE)
      )) {
        await t.adapter.executeQuery(statement);
      }
      const before = await personUniques(t);
      const ada = await aPerson(t, "Ada");
      await aProfile(t, ada);

      // A save that changes something else on the same table.
      const fields = [
        ...profileFields("oneToOne"),
        { name: "bio", type: "text" },
      ];
      const said = await previewText(await preview(fields));
      expect(said).not.toContain("one-to-one");
      await apply(t, fields);

      expect(await personUniques(t)).toEqual(before);
      expect(await refusedAsRepeat(aProfile(t, ada))).toBe(true);
    }, 120_000);

    it("plans nothing for a unique email field an inline constraint enforces, and keeps it unique", async () => {
      const t = await boot(dialect, "oneToOne");
      const HANDLES = "o2o_handles";
      const table = `dc_${HANDLES}`;
      const handleFields = [
        { name: "title", type: "text" },
        { name: "handle", type: "email", unique: true },
      ];
      await builder(
        "createCollection",
        {},
        { name: HANDLES, label: "Handles", fields: handleFields }
      );
      // Its table as a release that kept a unique field's uniqueness inline made it: the captured
      // profiles table, its relationship column swapped for the email column, typed as the column
      // descriptor types it today, with the constraint inline and no key.
      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      const handleType = getColumnDescriptor(
        { name: "handle", type: "email" } as never,
        dialect,
        "collection"
      )?.dialectType;
      const old = beforeThisChange.statements[dialect]
        .filter(statement => statement.includes(PROFILES_TABLE))
        // Every statement but the plain index on the relationship's column.
        .filter(statement => !/^CREATE INDEX\b[^\n]*_person\b/.test(statement))
        .map(statement =>
          statement
            .replace(/,\s*CONSTRAINT [^\n]*FOREIGN KEY[^\n]*/, "")
            .replace(
              /^(["`])person\1 [^,\n]*/m,
              `${q("handle")} ${handleType} UNIQUE`
            )
            .replaceAll(PROFILES_TABLE, table)
        );
      await t.adapter.executeQuery(`DROP TABLE ${q(table)}`);
      for (const statement of old) await t.adapter.executeQuery(statement);
      const handleUniques = async () =>
        (
          await introspectLiveSnapshot(t.adapter.getDrizzle(), dialect, [table])
        ).tables[0]?.indexes
          ?.filter(index => index.unique && index.columns.join() === "handle")
          .map(index => index.name) ?? [];
      const before = await handleUniques();
      await t.nextly.create({
        collection: HANDLES,
        data: { title: "a", handle: "taken@example.com" },
      });

      // A save that changes something else on the same table.
      const fields = [...handleFields, { name: "bio", type: "text" }];
      const version = Number(
        (
          await t.adapter.executeQuery<{ v: unknown }>(
            `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${HANDLES}'`
          )
        )[0]?.v ?? 1
      );
      await builder(
        "applySchemaChanges",
        { collectionName: HANDLES },
        { fields, confirmed: true, schemaVersion: version }
      );

      expect(await handleUniques()).toEqual(before);
      expect(
        await refusedAsRepeat(
          t.nextly.create({
            collection: HANDLES,
            data: { title: "b", handle: "taken@example.com" },
          })
        )
      ).toBe(true);
    }, 120_000);

    it("opens a one-to-one the earlier Builder stored with its target and Unique, and an unchanged save plans nothing", async () => {
      const t = await boot(dialect, "oneToOne", { legacy: true });
      const ada = await aPerson(t, "Ada");
      await aProfile(t, ada);
      const before = await personUniques(t);

      // What the Builder's editor reads.
      const read = (await (
        (await builder(
          "getCollection",
          { collectionName: PROFILES },
          undefined
        )) as Response
      ).json()) as { fields: Record<string, unknown>[] };
      const opened = read.fields.find(field => field.name === "person");
      expect(opened).toMatchObject({ relationTo: PEOPLE, unique: true });

      // Saved unchanged, as the editor sends it back.
      const unchanged = [
        { name: "title", type: "text" },
        {
          name: "person",
          type: "relationship",
          relationTo: opened?.relationTo,
          unique: opened?.unique,
        },
      ];
      expect(await previewText(await preview(unchanged))).not.toContain(
        "one-to-one"
      );
      await apply(t, unchanged);

      expect(await personUniques(t)).toEqual(before);
      expect(await refusedAsRepeat(aProfile(t, ada))).toBe(true);
    }, 120_000);

    it("opens a many-to-many the earlier Builder stored exactly as it was stored", async () => {
      // Its links live in a junction table, which a relationship holding many keeps as a list on
      // the row: read as one, an unchanged save would plan moving every link.
      const t = await boot(dialect, "manyToOne", { legacy: true });
      const stored = {
        name: "people",
        type: "relationship",
        options: { target: PEOPLE, relationType: "manyToMany" },
      };
      await builder(
        "createCollection",
        {},
        { name: "o2o_teams", label: "Teams", fields: [stored] }
      );

      const read = (await (
        (await builder(
          "getCollection",
          { collectionName: "o2o_teams" },
          undefined
        )) as Response
      ).json()) as { fields: Record<string, unknown>[] };
      const opened = read.fields.find(field => field.name === "people");

      expect(opened).toMatchObject(stored);
      expect(opened).not.toHaveProperty("relationTo");
      expect(opened).not.toHaveProperty("hasMany");
      expect(t).toBeDefined();
    }, 120_000);

    it("opens a Single's one-to-one the earlier Builder stored with its target and Unique", async () => {
      await boot(dialect, "oneToOne", { legacy: true });
      vi.stubEnv("NODE_ENV", "development");
      try {
        await dispatchSingles(
          "createSingle",
          {},
          {
            slug: "o2o_home",
            label: "Home",
            fields: [{ name: "title", type: "text" }, storedPerson("oneToOne")],
          }
        );
      } finally {
        vi.unstubAllEnvs();
      }

      const read = (await (
        (await dispatchSingles(
          "getSingleSchema",
          { slug: "o2o_home" },
          undefined
        )) as Response
      ).json()) as { fields: Record<string, unknown>[] };

      expect(read.fields.find(field => field.name === "person")).toMatchObject({
        relationTo: PEOPLE,
        unique: true,
      });
    }, 120_000);

    // MySQL refuses adding a translated relationship to a translated collection as if the new
    // column were reshaped (field-leaves-translation-rules); re-enable once that refusal is fixed.
    const translatedRelationshipRefused = dialect === "mysql";

    // -------------------------------------------------------------------------
    // Translated
    // -------------------------------------------------------------------------

    it.skipIf(translatedRelationshipRefused)(
      "makes a translated one-to-one unique within each language",
      async () => {
        const t = await boot(dialect, "oneToOne", { localized: true });
        const ada = await aPerson(t, "Ada");
        const profile = await aProfile(t, ada, "en");

        // The same profile's other language may point at the same person.
        await t.nextly.update({
          collection: PROFILES,
          id: profile,
          locale: "de",
          data: { person: ada, _overwrite: true },
        });
        // Another profile may not, in either language.
        expect(await refusedAsRepeat(aProfile(t, ada, "en"))).toBe(true);
        expect(await refusedAsRepeat(aProfile(t, ada, "de"))).toBe(true);
      },
      120_000
    );

    it.skipIf(translatedRelationshipRefused)(
      "makes a translated many-to-one edited into a one-to-one unique within each language",
      async () => {
        const t = await boot(dialect, "manyToOne", { localized: true });
        const ada = await aPerson(t, "Ada");
        const profile = await aProfile(t, ada, "en");

        await apply(t, profileFields("oneToOne", true), true);

        await t.nextly.update({
          collection: PROFILES,
          id: profile,
          locale: "de",
          data: { person: ada, _overwrite: true },
        });
        expect(await refusedAsRepeat(aProfile(t, ada, "en"))).toBe(true);
      },
      120_000
    );

    it.skipIf(translatedRelationshipRefused)(
      "keeps a one-to-one unique as translation is turned on and then off",
      async () => {
        const t = await boot(dialect, "oneToOne", { localized: true });
        const ada = await aPerson(t, "Ada");
        await aProfile(t, ada, "en");

        // Translation on for the field: its uniqueness follows its column to each language.
        await apply(t, profileFields("oneToOne", true), true);
        expect(await refusedAsRepeat(aProfile(t, ada, "en"))).toBe(true);

        // And off again: back on the main table, unique there.
        await apply(t, profileFields("oneToOne", false), true);
        expect(await refusedAsRepeat(aProfile(t, ada, "en"))).toBe(true);
      },
      120_000
    );
  }
);
