/**
 * Two owners claiming one name are refused at startup, naming both.
 *
 * Driven through `compileExtensionSchema`, the compile boot runs, so each
 * table is seeded from a real config: a collection's table is named by the
 * resolver the pipeline creates it with, a plugin's prefix by the rule boot
 * applies. A refusal checked against a hand-built store would pass while boot
 * named the tables some other way.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../../plugins/plugin-context";
import { col, defineTable, type TableDefinition } from "../dsl";
import type { SchemaHook } from "../draft";
import { compileExtensionSchema } from "../publish";

const notes = (name = "notes"): TableDefinition =>
  defineTable(name, { id: col.id(), body: col.shortText() });

function plugin(
  name: string,
  schema: { prefix?: string; tables?: TableDefinition[] }
): PluginDefinition {
  return definePlugin({
    name,
    version: "0.0.0",
    nextly: "*",
    contributes: { schema: { tables: [notes()], ...schema } },
  });
}

function compile(input: {
  plugins?: PluginDefinition[];
  collections?: { slug: string; dbName?: string }[];
  app?: SchemaHook[];
}) {
  return compileExtensionSchema({
    dialect: "sqlite",
    plugins: input.plugins ?? [],
    config: {
      collections: (input.collections ?? []).map(c => ({ ...c, fields: [] })),
      ...(input.app ? { db: { schema: { extend: input.app } } } : {}),
    },
    logger: { warn: () => {} },
  });
}

/** The refusal's message, or a failure if the compile did not refuse. */
async function refusal(run: Promise<unknown>): Promise<string> {
  const error = await run.then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  if (!(error instanceof NextlyError)) {
    throw new Error(
      error === undefined
        ? "expected the compile to refuse, and it succeeded"
        : `expected a NextlyError, got ${String(error)}`
    );
  }
  const data = error.publicData as { errors?: { message: string }[] };
  return data.errors?.map(e => e.message).join(" ") ?? "";
}

/** The SQL names of every table the compile declared. */
async function tableNames(run: ReturnType<typeof compile>): Promise<string[]> {
  return ((await run)?.tables ?? []).map(table => table.name).sort();
}

describe("two plugins and one prefix", () => {
  it("is refused at startup, naming both plugins", async () => {
    const message = await refusal(
      compile({
        plugins: [
          plugin("forms-one", { prefix: "forms" }),
          plugin("forms-two", { prefix: "forms" }),
        ],
      })
    );
    expect(message).toMatch(
      /Plugins "forms-one" and "forms-two" both claim the schema prefix "forms"/
    );
  });

  it("is refused when one prefix is derived and the other declared", async () => {
    // `acme-forms` derives `acme_forms` from its name.
    const message = await refusal(
      compile({
        plugins: [
          plugin("acme-forms", {}),
          plugin("other", { prefix: "acme_forms" }),
        ],
      })
    );
    expect(message).toMatch(/"acme-forms" and "other" both claim/);
  });

  it("control: two prefixes compile, each plugin's table under its own", async () => {
    expect(
      await tableNames(
        compile({
          plugins: [
            plugin("forms-one", { prefix: "forms" }),
            plugin("forms-two", { prefix: "forms2" }),
          ],
        })
      )
    ).toEqual(["forms2__notes", "forms__notes"]);
  });
});

describe("two declarations that differ only in case", () => {
  it("are refused in one plugin, naming both spellings", async () => {
    const message = await refusal(
      compile({
        plugins: [plugin("forms", { tables: [notes("Notes"), notes()] })],
      })
    );
    expect(message).toMatch(
      /"forms__notes" \(the same table as "forms__Notes" once case is ignored\) is already declared by plugin "forms"/
    );
  });

  it("are refused between two app declarations", async () => {
    const message = await refusal(
      compile({
        app: [
          ({ schema }) => {
            schema.addTable(notes("app_notes"));
            schema.addTable(notes("App_Notes"));
          },
        ],
      })
    );
    expect(message).toMatch(
      /"App_Notes" \(the same table as "app_notes" once case is ignored\) is already declared by the app/
    );
  });

  it("are refused between an app table and a core one", async () => {
    const message = await refusal(
      compile({
        app: [({ schema }) => schema.addTable(notes("Users"))],
      })
    );
    expect(message).toMatch(
      /"Users" \(the same table as "users" once case is ignored\) is already declared by core/
    );
  });

  it("are refused between an adopted table and a declared one", async () => {
    const message = await refusal(
      compile({
        app: [
          ({ schema }) => {
            schema.adoptTable(notes("legacy_notes"));
            schema.addTable(notes("Legacy_Notes"));
          },
        ],
      })
    );
    expect(message).toMatch(/"Legacy_Notes" .* is adopted by the app/);
  });

  it("control: two names that differ by more than case compile", async () => {
    expect(
      await tableNames(
        compile({
          plugins: [
            plugin("forms", { tables: [notes("Notes"), notes("notes_2")] }),
          ],
        })
      )
    ).toEqual(["forms__Notes", "forms__notes_2"]);
  });
});

describe("an app table named like another owner's", () => {
  it("is refused against a collection's table, naming the collection", async () => {
    const message = await refusal(
      compile({
        collections: [{ slug: "posts" }],
        app: [({ schema }) => schema.addTable(notes("dc_posts"))],
      })
    );
    expect(message).toMatch(
      /Table "dc_posts" is already declared by the collection "posts"; the app cannot declare it again/
    );
  });

  it("is refused under the collection prefix where no collection holds the name", async () => {
    // The pipeline reconciles every `dc_` table against the collections, so
    // one the app declared would be proposed for dropping.
    const message = await refusal(
      compile({
        collections: [{ slug: "posts" }],
        app: [({ schema }) => schema.addTable(notes("dc_archive"))],
      })
    );
    expect(message).toMatch(/prefix the schema pipeline manages/);
  });

  it("is refused against the table a collection's dbName names, in any case", async () => {
    // A collection's dbName is its table's name, under the collection prefix
    // the resolver enforces: `notes` is the table `dc_notes`, which the slug
    // `posts` would never have named.
    for (const name of ["dc_notes", "DC_Notes"]) {
      const message = await refusal(
        compile({
          collections: [{ slug: "posts", dbName: "notes" }],
          app: [({ schema }) => schema.addTable(notes(name))],
        })
      );
      expect(message).toMatch(/already declared by the collection "posts"/);
    }
  });

  it("is refused when a second app declaration takes the name", async () => {
    const message = await refusal(
      compile({
        app: [
          ({ schema }) => schema.addTable(notes("app_notes")),
          ({ schema }) => schema.addTable(notes("app_notes")),
        ],
      })
    );
    expect(message).toMatch(
      /Table "app_notes" is already declared by the app; the app cannot declare it again/
    );
  });

  it("is refused against a plugin's table", async () => {
    const message = await refusal(
      compile({
        plugins: [plugin("forms", {})],
        app: [({ schema }) => schema.addTable(notes("forms__notes"))],
      })
    );
    expect(message).toMatch(/already declared by plugin "forms"/);
  });

  it("control: an app table beside a collection with a dbName compiles", async () => {
    expect(
      await tableNames(
        compile({
          collections: [{ slug: "posts", dbName: "notes" }],
          app: [({ schema }) => schema.addTable(notes("app_notes"))],
        })
      )
    ).toEqual(["app_notes"]);
  });
});
