/**
 * A type change of a field of a field group two collections use, beside a Single that uses it too: each
 * host's values are rows of the group's one table, so one save converts all of them, and the file it
 * writes converts another database's own, whichever host holds them. A value one host alone holds that
 * cannot convert stops the change for all, nothing changed.
 *
 * What separates the right answer from a plausible wrong one: a conversion narrowed to the host the
 * group was saved from, or judged from one, leaves the others' values in the old type's form.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { resolveDataLossConsent } from "../migrate/data-loss-consent";
import { rewritesValuesOn } from "../value-conversion/type-change/field-type-changes";

const GROUP = "tcg_box";
const HOSTS = ["tcg_posts", "tcg_pages"] as const;
const SINGLE = "tcg_hero";
const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const box = { name: "box", type: "component", component: GROUP };

describe.each(getConfiguredTestDialects())(
  "a type change of a field of a field group two collections and a Single use (%s)",
  dialect => {
    const converts = it.skipIf(!rewritesValuesOn(dialect));
    let instance: TestNextly | undefined;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-type-change-group-"));
      vi.stubEnv("NODE_ENV", "development");
    });

    afterEach(async () => {
      await instance?.destroy();
      instance = undefined;
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    async function boot(): Promise<TestNextly> {
      instance = await createTestNextly({ dialect, basePath, db: DB });
      return instance;
    }

    /** The group with a list `v`, and its three hosts. */
    async function createAll(): Promise<void> {
      await dispatchComponents(
        "createComponent",
        {},
        { slug: GROUP, label: "Box", fields: [{ name: "v", type: "chips" }] }
      );
      for (const name of HOSTS) {
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          { name, label: name, fields: [box] }
        );
      }
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SINGLE, label: "Hero", fields: [box] }
      );
    }

    /** One entry in each host, holding these values of `v`. */
    async function write(
      t: TestNextly,
      values: Record<string, unknown>
    ): Promise<void> {
      for (const host of HOSTS) {
        await t.nextly.create({
          collection: host,
          data: { title: "a", box: { v: values[host] } },
        } as never);
      }
      await t.nextly.updateSingle({
        slug: SINGLE,
        data: { box: { v: values[SINGLE] }, _overwrite: true },
      } as never);
    }

    /** Each host's `v`, read through the Direct API. */
    async function read(t: TestNextly): Promise<Record<string, unknown>> {
      const found: Record<string, unknown> = {};
      for (const host of HOSTS) {
        const { items } = (await t.nextly.find({
          collection: host,
          limit: 10,
        } as never)) as unknown as { items: { box?: { v?: unknown } }[] };
        found[host] = items[0]?.box?.v ?? null;
      }
      const single = (await t.nextly.findSingle({
        slug: SINGLE,
      } as never)) as {
        box?: { v?: unknown };
        item?: { box?: { v?: unknown } };
      };
      found[SINGLE] = (single.item ?? single).box?.v ?? null;
      return found;
    }

    /** The group's save of `v` as a text, answering its refusal where it has one. */
    async function save(
      t: TestNextly,
      type: string,
      confirmed?: Record<string, unknown>
    ): Promise<unknown> {
      const stored = (await t
        .getService("fieldGroupRegistryService")
        .getComponent(GROUP)) as { schemaVersion?: number };
      const outcome = await dispatchComponents(
        "applyComponentSchemaChanges",
        { slug: GROUP },
        {
          fields: [{ name: "v", type }],
          confirmed: true,
          schemaVersion: stored.schemaVersion,
          ...(confirmed === undefined
            ? {}
            : { confirmedTypeChanges: [{ field: "v", ...confirmed }] }),
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
      clearRegistryRowCache();
      return outcome;
    }

    async function written(): Promise<number> {
      return (await readdir(join(basePath, "migrations"))).filter(file =>
        file.endsWith(".sql")
      ).length;
    }

    async function migrate(t: TestNextly, step?: number): Promise<void> {
      const adapter = t.adapter as unknown as DrizzleAdapter;
      await migrateCore({
        ...(step === undefined ? {} : { step }),
        extensionSchema: undefined,
        dialect: adapter.getCapabilities().dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir: join(basePath, "migrations"),
        logger: createLogger({ quiet: true }),
        lockMode: "fail-fast",
        consent: resolveDataLossConsent({ flag: true, env: {} }),
        interactive: false,
        throwOnFailure: true,
      } as never);
      clearRegistryRowCache();
    }

    converts("converts every host's values in one save", async () => {
      const t = await boot();
      await createAll();
      await write(t, {
        tcg_posts: ["a"],
        tcg_pages: ["b"],
        [SINGLE]: ["c"],
      });

      expect(await save(t, "text")).toBeUndefined();

      expect(await read(t)).toEqual({
        tcg_posts: "a",
        tcg_pages: "b",
        [SINGLE]: "c",
      });
    });

    converts(
      "refuses a value one host alone holds that cannot convert, and changes no host's",
      async () => {
        const t = await boot();
        await createAll();
        const values = {
          tcg_posts: ["a"],
          tcg_pages: ["b", "c"],
          [SINGLE]: ["d"],
        };
        await write(t, values);
        // As the app reads them before the save: the refusal leaves each as it was.
        const before = await read(t);

        expect(JSON.stringify(await save(t, "text"))).toMatch(
          /lists of several items.*1 row/
        );

        expect(await read(t)).toEqual(before);
      }
    );

    converts(
      "converts another database's hosts' own values when nextly migrate replays the file",
      async () => {
        const first = await boot();
        await createAll();
        const created = await written();
        await write(first, {
          tcg_posts: ["a"],
          tcg_pages: ["b"],
          [SINGLE]: ["c"],
        });
        expect(await save(first, "text")).toBeUndefined();
        await first.destroy();
        instance = undefined;

        const second = await boot();
        await migrate(second, created);
        await write(second, {
          tcg_posts: ["p"],
          tcg_pages: ["q", "r"],
          [SINGLE]: ["s"],
        });
        const before = await read(second);
        await expect(migrate(second)).rejects.toThrow();
        expect(await read(second)).toEqual(before);

        const { items } = (await second.nextly.find({
          collection: "tcg_pages",
          limit: 1,
        } as never)) as unknown as { items: { id: string }[] };
        await second.nextly.update({
          collection: "tcg_pages",
          id: items[0]?.id,
          data: { box: { v: ["q"] }, _overwrite: true },
        } as never);
        await migrate(second);
        expect(await read(second)).toEqual({
          tcg_posts: "p",
          tcg_pages: "q",
          [SINGLE]: "s",
        });
      }
    );

    it.runIf(!rewritesValuesOn(dialect))(
      "refuses the change where no road rewrites values, every host's value as it was",
      async () => {
        const t = await boot();
        await createAll();
        const values = {
          tcg_posts: ["a"],
          tcg_pages: ["b"],
          [SINGLE]: ["c"],
        };
        await write(t, values);
        const before = await read(t);

        expect(JSON.stringify(await save(t, "text"))).toContain(
          "can't be deployed yet"
        );

        expect(await read(t)).toEqual(before);
      }
    );
  }
);
