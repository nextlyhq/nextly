/**
 * Field groups nest to any depth, and one placed inside itself is refused where it is written.
 *
 * Every road that writes a field group's definition is driven against a real database: the
 * Builder's create, its "apply schema changes" save, a PATCH, and a start. A refusal is checked by
 * what the database holds afterwards — the registry row and the table as they were — not only by
 * the error, since a refusal that still wrote would satisfy an error check alone.
 *
 * A cycle among Builder field groups saved before cycles were refused cannot be made through a
 * save any more, so it is planted the way such a save stored it: straight into the registry row.
 * A start then names it and goes on, and the next save of a field group in it is refused.
 *
 * Each case owns its database, because a start is a second boot over what the first one stored,
 * and the harness's own provisioning drops its database at the next boot. Self-skips per dialect
 * on the standard rule: SQLite always runs, the servers run when their URL is set.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineConfig,
  defineFieldGroup,
  fieldGroup,
  text,
  type FieldGroupConfig,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { Logger } from "../../../shared/types";

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/** A database every boot of one case connects to, dropped when the case ends. */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  vi.stubEnv("DB_DIALECT", dialect);
  if (dialect === "sqlite") {
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const scratch = await createScratchDatabase(dialect, "nextly_fgc");
  vi.stubEnv("DATABASE_URL", scratch.url);
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: scratch.url,
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await scratch.drop();
    },
  };
}

/** A field group holding a title, and the field group `next` placed directly when given. */
function builderFields(next?: string): Record<string, unknown>[] {
  return [
    { name: "title", type: "text" },
    ...(next === undefined
      ? []
      : [{ name: next, type: "component", component: next }]),
  ];
}

/** The same, defined in code. */
function codeFieldGroup(slug: string, next?: string): FieldGroupConfig {
  return defineFieldGroup({
    slug,
    fields: [
      text({ name: "title" }),
      ...(next === undefined
        ? []
        : [fieldGroup({ name: next, component: next })]),
    ],
  });
}

/** What `run` threw. */
async function thrownBy(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected a refusal, and the call succeeded");
}

/** The refusal of a cycle, naming it. */
function cycleRefusal(cycle: string): unknown {
  return expect.objectContaining({
    code: "VALIDATION_ERROR",
    publicData: {
      errors: [
        expect.objectContaining({
          code: "FIELD_GROUP_CYCLE",
          message: expect.stringContaining(cycle),
        }),
      ],
    },
  });
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`field groups nest to any depth, and a cycle is refused — ${dialect}`, () => {
    let database: CaseDatabase;
    let instance: TestNextly | undefined;

    /** Start the app over this case's database, with `fieldGroups` defined in code. */
    async function start(
      fieldGroups: FieldGroupConfig[] = [],
      logger?: Logger,
      plugins: PluginDefinition[] = []
    ): Promise<TestNextly> {
      // A start evaluates the app's `defineConfig` first, as its config file does; the harness
      // boots from the parts and would not.
      defineConfig({ collections: [], fieldGroups });
      // Keeps the adapter open: the next boot connects to the same database.
      clearServices();
      instance = await createTestNextly({
        adapter: database.adapter as never,
        fieldGroups,
        plugins,
        ...(logger === undefined ? {} : { logger }),
      });
      return instance;
    }

    async function create(slug: string, next?: string): Promise<void> {
      await dispatchComponents(
        "createComponent",
        {},
        { slug, label: slug, fields: builderFields(next) }
      );
    }

    async function stored(slug: string) {
      const registry = (instance as TestNextly).getService(
        "fieldGroupRegistryService"
      );
      return (await registry.getComponentBySlug(slug)) ?? undefined;
    }

    /** The Builder's save: "apply schema changes" with `fields`, from the version it loaded. */
    async function apply(slug: string, fields: unknown[]): Promise<unknown> {
      const loaded = await stored(slug);
      return dispatchComponents(
        "applyComponentSchemaChanges",
        { slug },
        { fields, confirmed: true, schemaVersion: loaded?.schemaVersion }
      );
    }

    /** The names of a stored field group's fields, as the registry holds them. */
    async function fieldNames(slug: string): Promise<string[]> {
      const row = await stored(slug);
      return ((row?.fields ?? []) as { name?: string }[]).map(
        field => field.name ?? ""
      );
    }

    beforeEach(async () => {
      database = await openDatabase(dialect);
    });

    afterEach(async () => {
      await shutdownServices().catch(() => {});
      instance = undefined;
      vi.unstubAllEnvs();
      _resetEnvCache();
      await database?.close();
    });

    it("saves field groups nested five levels deep through create, apply and PATCH", async () => {
      await start();
      await create("l5");
      await create("l4", "l5");
      await create("l3", "l4");
      await create("l2", "l3");
      await create("l1", "l2");

      await apply("l1", [
        ...builderFields("l2"),
        { name: "subtitle", type: "text" },
      ]);
      // A PATCH moves no main-table column, so it resends the definition as it stands.
      await dispatchComponents(
        "updateComponent",
        { slug: "l3" },
        { label: "Level three", fields: builderFields("l4") }
      );

      expect(await fieldNames("l1")).toEqual(["title", "l2", "subtitle"]);
      expect((await stored("l3"))?.label).toBe("Level three");
      expect(await fieldNames("l3")).toEqual(["title", "l4"]);
      expect(await fieldNames("l4")).toEqual(["title", "l5"]);
    });

    it("refuses an apply that closes a cycle, naming it, and changes nothing", async () => {
      await start();
      await create("b");
      await create("a", "b");
      const before = await stored("b");

      expect(await thrownBy(apply("b", builderFields("a")))).toEqual(
        cycleRefusal("b → a → b")
      );

      const after = await stored("b");
      expect(await fieldNames("b")).toEqual(["title"]);
      expect(after?.schemaVersion).toBe(before?.schemaVersion);
    });

    it("refuses a PATCH that closes a cycle, and changes nothing", async () => {
      await start();
      await create("b");
      await create("a", "b");

      expect(
        await thrownBy(
          dispatchComponents(
            "updateComponent",
            { slug: "b" },
            { fields: builderFields("a") }
          )
        )
      ).toEqual(cycleRefusal("b → a → b"));
      expect(await fieldNames("b")).toEqual(["title"]);
    });

    it("refuses creating a field group placed in itself, leaving no row and no table", async () => {
      await start();

      expect(await thrownBy(create("loop", "loop"))).toEqual(
        cycleRefusal("loop → loop")
      );
      expect(await stored("loop")).toBeUndefined();
      expect(await database.adapter.tableExists("comp_loop")).toBe(false);
    });

    it("starts with code field groups nested five levels deep", async () => {
      const started = await start([
        codeFieldGroup("l1", "l2"),
        codeFieldGroup("l2", "l3"),
        codeFieldGroup("l3", "l4"),
        codeFieldGroup("l4", "l5"),
        codeFieldGroup("l5"),
      ]);
      // Positive control: the start reached the definitions it is about.
      expect(await fieldNames("l1")).toEqual(["title", "l2"]);
      expect(started).toBeDefined();
    });

    it("refuses a start whose code closes a cycle with a Builder field group", async () => {
      await start();
      // Saved while `hero` did not exist: a reference to a field group not yet defined is allowed.
      await create("card", "hero");
      expect(await fieldNames("card")).toEqual(["title", "hero"]);

      expect(await thrownBy(start([codeFieldGroup("hero", "card")]))).toEqual(
        cycleRefusal("hero → card → hero")
      );
    });

    it("refuses a start whose plugin extends a Builder field group into a cycle", async () => {
      await start();
      await create("b");
      await create("a", "b");
      // Adds to `b` a placement of `a`, which already places `b`.
      const extender: PluginDefinition = {
        name: "@t/extender",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          extend: [
            {
              target: "b",
              fields: [{ name: "a", type: "component", component: "a" }],
            },
          ],
        },
      };

      const refused = await thrownBy(start([], undefined, [extender]));
      expect(refused).toEqual(
        expect.objectContaining({
          code: "VALIDATION_ERROR",
          publicData: {
            errors: [
              expect.objectContaining({
                code: "FIELD_GROUP_CYCLE",
                message: expect.stringMatching(/a → b → a|b → a → b/),
              }),
            ],
          },
        })
      );
    });

    it("names a cycle the Builder stored before such a cycle was refused, starts, and refuses its next save", async () => {
      await start();
      await create("ping");
      await create("pong", "ping");
      // As a save made before the rule stored it: straight into the registry row.
      const registry = (instance as TestNextly).getService(
        "fieldGroupRegistryService"
      );
      await registry.updateComponent("ping", {
        fields: codeFieldGroup("ping", "pong").fields,
      });

      const warn = vi.fn();
      const logger: Logger = {
        debug: () => {},
        info: () => {},
        warn,
        error: () => {},
      };
      await start([], logger);

      const named = warn.mock.calls
        .map(([message]) => String(message))
        .filter(message => message.includes("place each other in a cycle"));
      expect(named).toHaveLength(1);
      expect(named[0]).toMatch(/ping → pong → ping|pong → ping → pong/);

      // The next save of a field group in it that keeps the cycle is refused...
      expect(await thrownBy(apply("ping", builderFields("pong")))).toEqual(
        cycleRefusal("ping → pong → ping")
      );
      // ...and the save that breaks it goes through.
      await apply("ping", builderFields());
      expect(await fieldNames("ping")).toEqual(["title"]);
    });
  });
}
