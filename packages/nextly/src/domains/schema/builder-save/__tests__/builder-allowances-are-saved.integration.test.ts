/**
 * What the Schema Builder's own saves take that the code rules refuse, so a definition file the
 * commands judge (`builderDefinitionProblems`) is not refused for what the product itself wrote.
 *
 * Each shape is sent through the Builder's own entry points, creating an entity and changing its
 * fields, and the definition file the save wrote is then judged as a command judges it.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { builderDefinitionProblems } from "../../../../shared/lib/config-problems";
import { _resetEnvCache } from "../../../../shared/lib/env";

const DEFINITION = "./schema/builder.json";
type Container = Parameters<typeof dispatchCollections>[0];

let instance: TestNextly | undefined;
let basePath: string;
const previousEnv = {
  dialect: process.env.DB_DIALECT,
  url: process.env.DATABASE_URL,
};

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "nextly-builder-allowances-"));
  // The Builder's save applies its change, and records it, in development.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
  vi.unstubAllEnvs();
  for (const [key, value] of [
    ["DB_DIALECT", previousEnv.dialect],
    ["DATABASE_URL", previousEnv.url],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  _resetEnvCache();
  await rm(basePath, { recursive: true, force: true });
});

describe.each(getConfiguredTestDialects())(
  "the Schema Builder's own saves (%s)",
  dialect => {
    async function boot(): Promise<void> {
      const db = { migrationsDir: "./migrations", uiSchemaFile: DEFINITION };
      if (dialect !== "sqlite") {
        instance = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db,
        });
        return;
      }
      const url = `file:${join(basePath, "test.db")}`;
      process.env.DB_DIALECT = "sqlite";
      process.env.DATABASE_URL = url;
      _resetEnvCache();
      const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
        typeof createAdapter
      >[0]);
      instance = await createTestNextly({ adapter, basePath, db });
    }

    const text = (name: string) => ({ name, type: "text" });
    const laidOut = { type: "group", fields: [text("subtitle")] };

    /** One kind of entity, through the entry points its Builder saves by. */
    interface Kind {
      list: "collections" | "singles" | "components";
      create(fields: unknown[]): Promise<unknown>;
      change(fields: unknown[]): Promise<unknown>;
    }
    const changed = (fields: unknown[]) => ({
      fields,
      confirmed: true,
      schemaVersion: 1,
    });
    const KINDS: Record<string, Kind> = {
      collection: {
        list: "collections",
        create: fields =>
          dispatchCollections(
            {} as Container,
            "createCollection",
            {},
            { name: "cases", label: "Cases", fields }
          ),
        change: fields =>
          dispatchCollections(
            {} as Container,
            "applySchemaChanges",
            { collectionName: "cases" },
            changed(fields)
          ),
      },
      Single: {
        list: "singles",
        create: fields =>
          dispatchSingles(
            "createSingle",
            {},
            { slug: "cases", label: "Cases", fields }
          ),
        change: fields =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "cases" },
            changed(fields)
          ),
      },
      "field group": {
        list: "components",
        create: fields =>
          dispatchComponents(
            "createComponent",
            {},
            { slug: "cases", label: "Cases", fields }
          ),
        // The version its editor loaded it at.
        change: async fields => {
          const loaded = await (instance as TestNextly)
            .getService("fieldGroupRegistryService")
            .getComponentBySlug("cases");
          return dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "cases" },
            { fields, confirmed: true, schemaVersion: loaded?.schemaVersion }
          );
        },
      },
    };
    const kindOf = (name: string): Kind => {
      const kind = KINDS[name];
      if (kind === undefined) throw new Error(name);
      return kind;
    };

    /** The fields the definition file the saves wrote holds for the entity. */
    const written = (kind: Kind) =>
      (
        JSON.parse(readFileSync(join(basePath, DEFINITION), "utf8")) as Record<
          Kind["list"],
          Array<{ fields: unknown[] }>
        >
      )[kind.list][0]?.fields;
    /** What a command that reads the entities would report of it. */
    const reported = () =>
      builderDefinitionProblems(
        JSON.parse(readFileSync(join(basePath, DEFINITION), "utf8")) as object,
        {},
        DEFINITION
      ).map(problem => [problem.code, problem.path] as const);

    it.each(["collection", "Single", "field group"])(
      "take a field named by a SQL keyword on a %s, and the file is not refused for it",
      async name => {
        await boot();
        const kind = kindOf(name);
        const fields = [text("heading"), text("select"), text("order")];
        await kind.create([text("heading")]);

        await kind.change(fields);

        expect(written(kind)).toEqual(fields);
        expect(reported()).toEqual([]);
      }
    );

    it.each(["collection", "field group"])(
      "take a group with no name at the top of a %s, and the file is not refused for it",
      async name => {
        await boot();
        const kind = kindOf(name);
        const fields = [text("heading"), laidOut];
        await kind.create([text("heading")]);

        await kind.change(fields);

        expect(written(kind)).toEqual(fields);
        expect(reported()).toEqual([]);
      }
    );

    // The one place a kind's saves refuse what the check allows: a definition written by hand with
    // one there is served (the column builders read through it), so it is not refused, and a file
    // that works keeps working.
    it("refuse a group with no name at the top of a Single, which the check lets a hand-written file hold", async () => {
      await boot();
      const kind = kindOf("Single");
      const fields = [text("heading"), laidOut];
      const refusal = {
        code: "VALIDATION_ERROR",
        publicData: { errors: [{ path: "fields[1].name", code: "REQUIRED" }] },
      };

      await expect(kind.create(fields)).rejects.toMatchObject(refusal);
      await kind.create([text("heading")]);
      await expect(kind.change(fields)).rejects.toMatchObject(refusal);

      expect(written(kind)).toEqual([text("heading")]);
      expect(
        builderDefinitionProblems(
          { singles: [{ slug: "cases", fields }] },
          {},
          DEFINITION
        ).map(problem => [problem.code, problem.path])
      ).toEqual([]);
    });

    it.each(
      ["collection", "Single", "field group"].flatMap(name =>
        ["group", "repeater"].map(type => [name, type] as const)
      )
    )(
      "take a group with no name inside a new %s's %s, and the file is not refused for it",
      async (name, type) => {
        await boot();
        const kind = kindOf(name);
        const holder = { name: "holder", type, fields: [laidOut] };

        await kind.create([holder]);

        expect(written(kind)).toEqual([holder]);
        expect(reported()).toEqual([]);
      }
    );

    // The one place the Builder's saves and the check part on purpose: a file holding the mark is
    // refused, so the mark is taken out before an upgrade runs over it.
    it.each(
      ["collection", "Single", "field group"].flatMap(name =>
        ["repeater", "group"].map(type => [name, type] as const)
      )
    )(
      "take a %s's %s marked translatable as a whole, and the file is refused for it, by name",
      async (name, type) => {
        await boot();
        const kind = kindOf(name);
        const fields = [
          text("heading"),
          { name: "holder", type, localized: true, fields: [text("inner")] },
        ];

        await kind.create(fields);

        expect(written(kind)).toEqual(fields);
        expect(reported()).toEqual([
          [
            "FIELD_STRUCTURE_NOT_TRANSLATABLE",
            `schema/builder.json ${kind.list}[0].fields[1].localized`,
          ],
        ]);
      }
    );

    it.each(["collection", "Single", "field group"])(
      "take a %s's field group placement marked translatable as a whole, and the file is not refused for it",
      async name => {
        await boot();
        const kind = kindOf(name);
        await dispatchComponents(
          "createComponent",
          {},
          { slug: "card", label: "Card", fields: [text("inner")] }
        );
        const fields = [
          text("heading"),
          {
            name: "hero",
            type: "component",
            localized: true,
            component: "card",
          },
        ];

        await kind.create(fields);

        const file = JSON.parse(
          readFileSync(join(basePath, DEFINITION), "utf8")
        ) as Record<Kind["list"], Array<{ slug: string; fields: unknown[] }>>;
        const at = file[kind.list].findIndex(({ slug }) => slug === "cases");
        expect(file[kind.list][at]?.fields).toEqual(fields);
        expect(reported()).toEqual([]);
      }
    );
  }
);
