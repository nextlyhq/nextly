/**
 * `migrate:check` and `migrate:create` read the Schema Builder's definition file by one set of
 * rules: a definition one refuses the other refuses with the same message, a Builder entity a
 * code-first one of the same kind and slug shadows is warned about naming its kind, and a Builder
 * entity the newest snapshot records but neither the configuration nor the file declares is refused
 * by both, naming the entity and the file, rather than planned as a drop of its table.
 *
 * The commands are driven themselves over a project directory, the config handed to the loader;
 * neither connects, so each needs only the dialect.
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
} from "../../../config";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { _resetEnvCache } from "../../../shared/lib/env";
import { exitWithError } from "../../errors";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCheck } from "../migrate-check";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
// `../program` imports every command, `migrate` with its whole graph among
// them; the commands under test need only its context factory, and are handed
// their context here anyway.
vi.mock("../../program", () => ({
  createContext: () => ({
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      success: () => {},
    },
  }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const URLS = {
  sqlite: (dir: string) => `file:${join(dir, "unused.db")}`,
  postgresql: () => "postgres://unused:unused@localhost:1/unused",
  mysql: () => "mysql://unused:unused@localhost:1/unused",
} as const;

const EMPTY = defineConfig({
  collections: [],
  db: { migrationsDir: "./migrations" },
});

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-builder-judged-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
});

afterEach(() => {
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

function useDialect(dialect: keyof typeof URLS): void {
  process.env.DB_DIALECT = dialect;
  process.env.DATABASE_URL = URLS[dialect](dir);
  _resetEnvCache();
}

interface Ran {
  /** The exit code the command ended with, if it ended with one. */
  code: number | undefined;
  /** Every warning it gave. */
  warned: string[];
  /** Every line it reported, a dry run's plan among them. */
  informed: string[];
  /** The error it ended with, as printed in the error shape on standard error. */
  printed: string[];
}

/** Run a command over the project; its exit code, if any, what it said and its printed error. */
async function run(
  command: (context: CommandContext) => Promise<void>,
  config: unknown
): Promise<Ran> {
  loaded.config = config;
  const warned: string[] = [];
  const informed: string[] = [];
  const printed: string[] = [];
  const quiet = () => {};
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      warn: (message: string) => {
        warned.push(message);
      },
      info: (message: string) => {
        informed.push(message);
      },
      error: quiet,
      success: quiet,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  const errors = vi.spyOn(console, "error").mockImplementation(message => {
    printed.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  try {
    await command(context);
    return { code: undefined, warned, informed, printed };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { code: Number(match[1]), warned, informed, printed };
    throw error;
  } finally {
    exit.mockRestore();
    errors.mockRestore();
  }
}

/**
 * What a command's action does with an error its run threw: print it and exit. An exit the run
 * already took (the stubbed `process.exit` throws) goes on as it is.
 */
function endAsTheAction(context: CommandContext, error: unknown): never {
  if (error instanceof Error && /^exit \d+$/.test(error.message)) throw error;
  return exitWithError(context.logger, error);
}

/**
 * `migrate:create` where nobody can be asked, as `--non-interactive` runs it. A refusal of the
 * plan is thrown on for the command's action to print, so it ends here as the action ends it
 * (`migrateCreateAction`).
 */
function create(
  config: unknown,
  name = "builder",
  options: { dryRun?: true } = {}
): Promise<Ran> {
  return run(async context => {
    setNonInteractive(true);
    try {
      await runMigrateCreate(name, { cwd: dir, ...options }, context);
    } catch (error) {
      endAsTheAction(context, error);
    } finally {
      setNonInteractive(false);
    }
  }, config);
}

/** `migrate:check`, ended as its action ends it (`migrateCheckAction`). */
function check(config: unknown): Promise<Ran> {
  return run(async context => {
    try {
      await runMigrateCheck({ cwd: dir }, context);
    } catch (error) {
      endAsTheAction(context, error);
    }
  }, config);
}

/** The migration files the project holds. */
function sqlFiles(): string[] {
  try {
    return readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql"));
  } catch {
    return [];
  }
}

async function writeDefinitions(manifest: unknown): Promise<void> {
  await writeFile(join(dir, "ui-schema.json"), JSON.stringify(manifest));
}

describe("a Builder definition whose relationship target is missing", () => {
  const MANIFEST = {
    collections: [
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          { name: "author", type: "relationship", relationTo: "authors" },
        ],
      },
    ],
    singles: [],
    components: [],
  };

  it("is refused by both commands with the same message, and no migration is written", async () => {
    useDialect("sqlite");
    await writeDefinitions(MANIFEST);

    const checked = await check(EMPTY);
    const created = await create(EMPTY);

    expect(checked.code).toBe(1);
    expect(created.code).toBe(1);
    const refusal = checked.printed.join("\n");
    expect(refusal).toContain("BUILDER_RELATION_TARGET_UNKNOWN");
    expect(refusal).toContain(
      "posts.author relates to unknown target 'authors'"
    );
    expect(created.printed.join("\n")).toBe(refusal);
    expect(sqlFiles()).toEqual([]);
  });

  it("is refused by both commands when the earlier Builder's options.target names it", async () => {
    useDialect("sqlite");
    // The shape the parser accepts and the generator keys a column to.
    await writeDefinitions({
      collections: [
        {
          slug: "posts",
          fields: [
            {
              name: "author",
              type: "relationship",
              options: { target: "authors" },
            },
          ],
        },
      ],
      singles: [],
      components: [],
    });

    const checked = await check(EMPTY);
    const created = await create(EMPTY);

    expect(checked.code).toBe(1);
    expect(created.code).toBe(1);
    const refusal = checked.printed.join("\n");
    expect(refusal).toContain("BUILDER_RELATION_TARGET_UNKNOWN");
    expect(refusal).toContain(
      "posts.author relates to unknown target 'authors'"
    );
    expect(created.printed.join("\n")).toBe(refusal);
    expect(sqlFiles()).toEqual([]);
  });

  it("is reported by a dry run in the words the real run prints, and nothing is written", async () => {
    useDialect("sqlite");
    await writeDefinitions(MANIFEST);

    const dry = await create(EMPTY, "builder", { dryRun: true });

    // A dry run reports the real run's refusal and exits 0.
    expect(dry.code).toBe(0);
    const reported = dry.informed.join("\n");
    expect(reported).toContain("BUILDER_RELATION_TARGET_UNKNOWN");
    expect(reported).toContain(
      "posts.author relates to unknown target 'authors'"
    );
    expect(sqlFiles()).toEqual([]);
  });
});

describe("a Builder field of a type no plugin offers", () => {
  const MANIFEST = {
    collections: [
      { slug: "reviews", fields: [{ name: "score", type: "acme-rating" }] },
    ],
    singles: [],
    components: [],
  };

  it("is refused by both commands with the same message, a dry run included", async () => {
    useDialect("sqlite");
    await writeDefinitions(MANIFEST);

    const checked = await check(EMPTY);
    const created = await create(EMPTY);
    const dry = await create(EMPTY, "builder", { dryRun: true });

    const refusal = checked.printed.join("\n");
    expect(checked.code).toBe(1);
    expect(refusal).toContain("CONFIG_INVALID");
    expect(refusal).toContain("acme-rating");
    for (const ran of [created, dry]) {
      expect(ran.code).toBe(1);
      expect(ran.printed.join("\n")).toBe(refusal);
    }
    expect(sqlFiles()).toEqual([]);
  });
});

describe("a shadowed Builder entry whose relationship target is missing", () => {
  it("is ignored with the rest of the entry, by both commands", async () => {
    useDialect("sqlite");
    // The code-first `posts` wins; the Builder's, and its relationship to a
    // collection nobody declares, contribute nothing.
    await writeDefinitions({
      collections: [
        {
          slug: "posts",
          fields: [
            { name: "author", type: "relationship", relationTo: "authors" },
          ],
        },
      ],
      singles: [],
      components: [],
    });
    const config = defineConfig({
      collections: [
        defineCollection({
          slug: "posts",
          fields: [{ name: "title", type: "text" }],
        }),
      ],
      db: { migrationsDir: "./migrations" },
    });

    const created = await create(config);
    const checked = await check(config);

    for (const ran of [created, checked]) {
      expect(ran.printed.join("\n")).toBe("");
      expect(ran.code).toBeUndefined();
      expect(ran.warned.some(w => w.includes("collection 'posts'"))).toBe(true);
    }
  });
});

describe("a Builder entry removed by hand that another still relates to", () => {
  it("is refused as lost by both commands, not as a missing target", async () => {
    useDialect("sqlite");
    const posts = {
      slug: "posts",
      fields: [{ name: "author", type: "relationship", relationTo: "authors" }],
    };
    const authors = {
      slug: "authors",
      fields: [{ name: "name", type: "text" }],
    };
    await writeDefinitions({
      collections: [authors, posts],
      singles: [],
      components: [],
    });
    expect((await create(EMPTY)).code).toBeUndefined();
    const written = sqlFiles();
    // `authors` removed from the file; `posts` still relates to it.
    await writeDefinitions({
      collections: [posts],
      singles: [],
      components: [],
    });

    const checked = await check(EMPTY);
    const created = await create(EMPTY, "after_removal");

    for (const ran of [checked, created]) {
      expect(ran.code).toBe(1);
      const refusal = ran.printed.join("\n");
      expect(refusal).toContain("BUILDER_DEFINITION_MISSING");
      expect(refusal).toContain("collection 'authors'");
      expect(refusal).not.toContain("BUILDER_RELATION_TARGET_UNKNOWN");
    }
    expect(created.printed.join("\n")).toBe(checked.printed.join("\n"));
    expect(sqlFiles()).toEqual(written);
  });
});

describe("a Builder entity a code-first one of its kind shadows", () => {
  const field = { name: "summary", type: "text" } as const;
  const MANIFEST = {
    collections: [{ slug: "cases", fields: [field] }],
    singles: [{ slug: "about", fields: [field] }],
    components: [{ slug: "teaser", fields: [field] }],
  };
  const SHADOWING = defineConfig({
    collections: [defineCollection({ slug: "cases", fields: [field] })],
    singles: [defineSingle({ slug: "about", fields: [field] })],
    fieldGroups: [defineFieldGroup({ slug: "teaser", fields: [field] })],
    db: { migrationsDir: "./migrations" },
  } as Parameters<typeof defineConfig>[0]);

  const EXPECTED = [
    "./ui-schema.json declares a collection 'cases' that a code-first collection of the same slug shadows; the code definition wins.",
    "./ui-schema.json declares a Single 'about' that a code-first Single of the same slug shadows; the code definition wins.",
    "./ui-schema.json declares a field group 'teaser' that a code-first field group of the same slug shadows; the code definition wins.",
  ];

  it("is warned about by migrate:create, naming its kind and slug", async () => {
    useDialect("sqlite");
    await writeDefinitions(MANIFEST);

    const created = await create(SHADOWING);

    expect(created.code).toBeUndefined();
    for (const line of EXPECTED) expect(created.warned).toContain(line);
  });

  it("is warned about by migrate:check the same way, not refused", async () => {
    useDialect("sqlite");
    await writeDefinitions(MANIFEST);
    // The code-first entities written into a migration, so the check finds no drift.
    expect((await create(SHADOWING)).code).toBeUndefined();

    const checked = await check(SHADOWING);

    expect(checked.printed.join("\n")).toBe("");
    expect(checked.code).toBeUndefined();
    for (const line of EXPECTED) expect(checked.warned).toContain(line);
  });

  it("is not shadowed by a code-first entity of another kind", async () => {
    useDialect("sqlite");
    // A Builder Single named as a code-first collection is its own entity, with its own table.
    await writeDefinitions({
      collections: [],
      singles: [{ slug: "cases", fields: [field] }],
      components: [],
    });
    const config = defineConfig({
      collections: [defineCollection({ slug: "cases", fields: [field] })],
      db: { migrationsDir: "./migrations" },
    });
    expect((await create(config)).code).toBeUndefined();

    const checked = await check(config);

    expect(checked.printed.join("\n")).toBe("");
    expect(checked.code).toBeUndefined();
    expect(checked.warned.filter(w => w.includes("shadows"))).toEqual([]);
  });
});

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "a Builder entity the definition file lost, on %s",
  dialect => {
    const field = { name: "summary", type: "text" } as const;

    it.each([
      [
        "collection",
        "cases",
        { collections: [{ slug: "cases", fields: [field] }] },
      ],
      ["Single", "about", { singles: [{ slug: "about", fields: [field] }] }],
      [
        "field group",
        "teaser",
        { components: [{ slug: "teaser", fields: [field] }] },
      ],
    ] as const)(
      "a %s is refused by both commands, naming it and the file",
      async (kind, slug, entities) => {
        useDialect(dialect);
        await writeDefinitions({
          collections: [],
          singles: [],
          components: [],
          ...entities,
        });
        expect((await create(EMPTY)).code).toBeUndefined();
        const written = sqlFiles();
        expect(written).toHaveLength(1);
        await rm(join(dir, "ui-schema.json"));

        const checked = await check(EMPTY);
        const created = await create(EMPTY, "after_loss");

        for (const ran of [checked, created]) {
          expect(ran.code).toBe(1);
          const refusal = ran.printed.join("\n");
          expect(refusal).toContain("BUILDER_DEFINITION_MISSING");
          expect(refusal).toContain(`${kind} '${slug}'`);
          expect(refusal).toContain("ui-schema.json");
        }
        expect(created.printed.join("\n")).toBe(checked.printed.join("\n"));
        // No migration planning the drop of its table.
        expect(sqlFiles()).toEqual(written);
      }
    );

    it("a Builder entity the configuration now declares is not refused", async () => {
      useDialect(dialect);
      // A number field: its column is the same by the Builder's rule and the code-first one, so
      // moving the collection into code changes no column. A text field would (unbounded by the
      // Builder, `varchar(255)` in code), which `migrate:create` rightly asks consent for.
      const rating = { name: "rating", type: "number" } as const;
      await writeDefinitions({
        collections: [{ slug: "cases", fields: [rating] }],
        singles: [],
        components: [],
      });
      expect((await create(EMPTY)).code).toBeUndefined();
      await rm(join(dir, "ui-schema.json"));
      // Moved into code: the configuration declares it, so nothing was lost.
      const moved = defineConfig({
        collections: [defineCollection({ slug: "cases", fields: [rating] })],
        db: { migrationsDir: "./migrations" },
      });

      const created = await create(moved, "moved");
      const checked = await check(moved);

      // Neither command fails at all: an exit of 0 ("No changes detected") or none is a run that
      // reached the end. The cases above are the control, the same project with `EMPTY` instead
      // of `moved`, refused at the same check.
      for (const ran of [created, checked]) {
        expect(ran.printed.join("\n")).toBe("");
        expect([undefined, 0]).toContain(ran.code);
      }
    });
  }
);
