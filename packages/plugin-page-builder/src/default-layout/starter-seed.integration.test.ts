/**
 * A fresh site's starter header and footer, against a real instance on every
 * configured dialect.
 *
 * What separates a correct release from a plausible broken one:
 * - a fresh site's default is "Main", holding a published "Starter header"
 *   and "Starter footer", each marked for its area, and the record of both;
 * - a page drawn through the real published route shows the site's name (or
 *   "Your site name"), its pages oldest first (five in the header, four in
 *   the footer), "Contact us" and "© <year> <name>";
 * - the starter is made once: a repair that re-seeds a lost default makes an
 *   empty set and no component, and a site drawing its own header and footer
 *   gets an empty Main and no starter;
 * - a seed failing at any write leaves no set, component or record behind,
 *   and the next run makes exactly one starter;
 * - two runs racing to make the starter end with one: the record's insert
 *   decides, and the loser removes what it made.
 *
 * @module default-layout/starter-seed.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { eq } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { Suspense, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { deleteUnplacedComponent } from "../component-delete/system-delete";
import { fenceStore } from "../host-rewrite/fence";
import { readLayoutChoices } from "../layout-choices-route";
import { layoutRemovalStore } from "../layout-removal/store";
import { DEFAULT_COMPONENT_STORE } from "../library-route";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilderLayouts } from "../page-layouts";
import { pageBuilder } from "../plugin";
import { siteOptions } from "../schema/tables";

import { ensureDefaultLayout, type EnsureDefaultDeps } from "./ensure-default";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./settings-single";
import {
  STARTER_OPTION,
  starterRecordStore,
  type StarterRecord,
  type StarterRecordStore,
} from "./starter-record";
import type { StarterParts } from "./starter-seed";
import {
  readLayoutSettings,
  writeLayoutSettings,
  type DefaultLayoutDirectApi,
} from "./store";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

type Row = Record<string, unknown>;

/** What a probe plugin reaches: the page builder's own tables. */
interface Probe {
  db?: PluginDatabase;
  dialect?: Parameters<typeof layoutRemovalStore>[1];
}

function probePlugin(probe: Probe): PluginDefinition {
  return definePlugin({
    name: "@test/starter-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      probe.db = ctx.db;
      probe.dialect = ctx.dialect;
    },
  });
}

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h1" },
});

describe.each(getConfiguredTestDialects())(
  "a fresh site's starter header and footer (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    const probe: Probe = {};

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    function db(): PluginDatabase {
      if (probe.db === undefined) throw new Error("the probe did not boot");
      return probe.db;
    }

    function dialectOf(): Parameters<typeof layoutRemovalStore>[1] {
      if (probe.dialect === undefined) throw new Error("no dialect");
      return probe.dialect;
    }

    /** The parts the installed plugin seeds with, over the probe's tables. */
    function starterParts(
      record: StarterRecordStore = starterRecordStore(db(), dialectOf())
    ): StarterParts {
      return {
        components: COMPONENTS_SLUG,
        record,
        removeComponent: (nextly, id) =>
          deleteUnplacedComponent(
            {
              nextly,
              runs: fenceStore(db(), dialectOf()),
              components: COMPONENTS_SLUG,
            },
            id
          ),
      };
    }

    function deps(
      t: TestNextly,
      overrides: Partial<EnsureDefaultDeps> = {}
    ): EnsureDefaultDeps {
      return {
        nextly: t.nextly,
        slugs: SLUGS,
        pagesSlug: PAGES_SLUG,
        removals: layoutRemovalStore(db(), dialectOf()),
        warn: () => {},
        starter: starterParts(),
        ...overrides,
      };
    }

    /** A fresh site, its boot's own seed settled. */
    async function boot(
      mode: "page-builder" | "code" = "page-builder"
    ): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        seedPublic: true,
        plugins: [
          pageBuilder(mode === "code" ? { siteHeaderFooter: "code" } : {}),
          probePlugin(probe),
        ],
      });
      // Joins the boot's own run, which `onReady` starts without awaiting.
      await ensureDefaultLayout(
        deps(current, mode === "code" ? { starter: undefined } : {})
      );
      return current;
    }

    async function all(t: TestNextly, collection: string): Promise<Row[]> {
      const found = await t.nextly.find({
        collection,
        status: "all",
        limit: 100,
        depth: 0,
        overrideAccess: true,
      });
      return found.items as Row[];
    }

    async function recordRow(): Promise<string | null> {
      const row = await db()
        .select(siteOptions)
        .where(eq(db().table(siteOptions).name, STARTER_OPTION))
        .first();
      const value = (row as { value?: unknown } | null)?.value;
      return typeof value === "string" ? value : null;
    }

    /**
     * Put a code-mode site back to "never seeded": no seed or default
     * recorded, no starter, no components. The empty Main its boot made
     * stays, holding the name, so the next seed is "Main 2".
     */
    async function asNeverSeeded(t: TestNextly): Promise<void> {
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { seededLayout: null, defaultLayout: null }
      );
      expect(await all(t, COMPONENTS_SLUG)).toEqual([]);
      expect(await recordRow()).toBeNull();
    }

    /** The default set, as stored. */
    async function defaultSet(t: TestNextly): Promise<Row> {
      const { defaultLayout } = await readLayoutSettings(t.nextly, SLUGS);
      const row = (await all(t, LAYOUTS_SLUG)).find(
        item => item.id === defaultLayout
      );
      if (row === undefined) throw new Error("no default set");
      return row;
    }

    /** The areas of a set, as `{ area: componentId }`. */
    function areasOf(set: Row): Record<string, string> {
      const areas = (set.areas ?? []) as { area: string; component: unknown }[];
      return Object.fromEntries(
        areas.map(({ area, component }) => [
          area,
          typeof component === "object" && component !== null
            ? String((component as { id: unknown }).id)
            : String(component),
        ])
      );
    }

    /**
     * A published page, a second after the last: some databases keep
     * creation times to the second, and "oldest first" needs them apart.
     */
    async function page(t: TestNextly, title: string): Promise<void> {
      await new Promise(resolve => setTimeout(resolve, 1100));
      await t.nextly.create({
        collection: PAGES_SLUG,
        data: {
          title,
          slug: title.toLowerCase(),
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [heading(`${title}-body`, `Body of ${title}`)],
          },
          status: "published",
        },
        overrideAccess: true,
      });
    }

    async function render(t: TestNextly, slug: string): Promise<string> {
      const route = createPublicBlocksPage({
        collections: [PAGES_SLUG],
        field: "content",
        nextly: t.nextly as never,
        blocks: createBlockResolver(coreBlocks),
        layouts: pageBuilderLayouts({ nextly: t.nextly }),
      });
      // Streamed, so the page's async blocks (the links, the lists) draw.
      let element = (await route.ContentPage({
        params: { slug: [slug] },
      })) as ReactElement<{ children: ReactElement }>;
      if (element.type === Suspense) {
        const body = element.props.children;
        const Body = body.type as (props: unknown) => Promise<ReactElement>;
        element = (await Body(body.props)) as typeof element;
      }
      const stream = await renderToReadableStream(element, {
        onError(error) {
          throw error;
        },
      });
      await stream.allReady;
      return await new Response(stream).text();
    }

    /** The text of the `<header>` or `<footer>` a page drew. */
    function partOf(html: string, tag: "header" | "footer"): string {
      // The region the layout draws, whose own element is a header or footer.
      const found = new RegExp(
        `<${tag} data-nextly-region="${tag}">[\\s\\S]*</${tag}></div></${tag}>`
      ).exec(html);
      if (found === null) throw new Error(`no <${tag}> in the page`);
      return found[0];
    }

    /** The words of some markup, in order, without its tags. */
    function words(html: string): string {
      return html
        .replace(/<[^>]+>/g, " ")
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    }

    it("gives a fresh site Main as its default, holding a published Starter header and Starter footer", async () => {
      const t = await boot();
      const main = await defaultSet(t);
      expect(main).toMatchObject({
        title: "Main",
        slug: "main",
        status: "published",
      });
      const { seededLayout } = await readLayoutSettings(t.nextly, SLUGS);
      expect(seededLayout).toBe(main.id);

      const components = await all(t, COMPONENTS_SLUG);
      expect(
        components
          .map(c => [c.title, c.slug, c.area, c.status])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      ).toEqual([
        ["Starter footer", "starter-footer", "footer", "published"],
        ["Starter header", "starter-header", "header", "published"],
      ]);
      const byTitle = new Map(components.map(c => [c.title, String(c.id)]));
      expect(areasOf(main)).toEqual({
        header: byTitle.get("Starter header"),
        footer: byTitle.get("Starter footer"),
      });
      const record = await starterRecordStore(db(), dialectOf()).read();
      expect(record).toMatchObject({
        header: { id: byTitle.get("Starter header") },
        footer: { id: byTitle.get("Starter footer") },
      });
    });

    it(
      "draws the starter around a page: the name, the pages oldest first, Contact us and the year",
      { timeout: 30_000 },
      async () => {
        const t = await boot();
        for (const title of ["Home", "About", "Work"]) await page(t, title);
        const year = String(new Date().getUTCFullYear());

        // No site name yet.
        const unnamed = await render(t, "home");
        const header = partOf(unnamed, "header");
        expect(words(header)).toBe("Your site name Home About Work Contact us");
        expect(header).toContain('href="/"');
        expect(header).toContain('href="/contact"');
        expect(words(partOf(unnamed, "footer"))).toBe(
          `Your site name Pages Home About Work © ${year} Your site name`
        );

        // A name, and more pages than either part shows.
        const settings = t.getService("generalSettingsService") as {
          updateSettings(data: Record<string, unknown>): Promise<unknown>;
        };
        await settings.updateSettings({ applicationName: "Acme Studio" });
        for (const title of ["Team", "Blog", "Jobs"]) await page(t, title);
        const named = await render(t, "about");
        expect(words(partOf(named, "header"))).toBe(
          "Acme Studio Home About Work Team Blog Contact us"
        );
        expect(words(partOf(named, "footer"))).toBe(
          `Acme Studio Pages Home About Work Team © ${year} Acme Studio`
        );
      }
    );

    /**
     * The Direct API reading past access: what the editor is told is the
     * question here, not who may read it, which the route's own tests pin.
     */
    function asTheSystem(t: TestNextly): never {
      return new Proxy(t.nextly, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (args: Record<string, unknown>) =>
            (value as (a: unknown) => unknown).call(target, {
              ...args,
              overrideAccess: true,
              user: undefined,
            });
        },
      }) as never;
    }

    it("tells the editor the regions show the untouched starter, until a change to one is published", async () => {
      const t = await boot();
      const record = await starterRecordStore(db(), dialectOf()).read();
      if (record === null || record === "made") throw new Error("no record");
      const choices = () =>
        readLayoutChoices(
          {
            caller: { can: async () => true, identity: async () => ({}) },
            self: { collections: {}, singles: {} },
          } as never,
          asTheSystem(t),
          {
            selected: null,
            store: DEFAULT_COMPONENT_STORE,
            limits: DEFAULT_LIMITS,
            starter: () => starterRecordStore(db(), dialectOf()).read(),
          }
        );
      const before = (await choices()).meta.regionComponents;
      expect(before[record.header.id]?.untouchedStarter).toBe("header");
      expect(before[record.footer.id]?.untouchedStarter).toBe("footer");

      const header = (await all(t, COMPONENTS_SLUG)).find(
        c => c.id === record.header.id
      );
      const content = header?.content as { nodes: Row[] };
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: record.header.id,
        data: {
          content: { ...content, nodes: [heading("mine", "My header")] },
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      const after = (await choices()).meta.regionComponents;
      expect(after[record.header.id]?.untouchedStarter).toBeUndefined();
      expect(after[record.footer.id]?.untouchedStarter).toBe("footer");
    });

    it("re-seeds a lost default as an empty set, and never makes a second starter", async () => {
      const t = await boot();
      const main = await defaultSet(t);
      // Deleted by a path that runs no hooks, as an import or a script might.
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      const table = (await registry.getCollectionBySlug(LAYOUTS_SLUG))!
        .tableName;
      await t.adapter.delete(table, {
        and: [{ column: "id", op: "=", value: String(main.id) }],
      });
      const components = (await all(t, COMPONENTS_SLUG)).length;
      expect(await ensureDefaultLayout(deps(t))).toBe("seeded");

      const reseeded = await defaultSet(t);
      expect(reseeded.id).not.toBe(main.id);
      expect(reseeded.title).toBe("Main");
      expect(areasOf(reseeded)).toEqual({});
      expect((await all(t, COMPONENTS_SLUG)).length).toBe(components);
      expect(await ensureDefaultLayout(deps(t))).toBe("kept");
    });

    it("gives a site drawing its own header and footer an empty Main and no starter", async () => {
      const t = await boot("code");
      const main = await defaultSet(t);
      expect(main).toMatchObject({ title: "Main", status: "published" });
      expect(areasOf(main)).toEqual({});
      expect(await all(t, COMPONENTS_SLUG)).toEqual([]);
      expect(await recordRow()).toBeNull();
    });

    it("leaves nothing half-made when any write of the seed fails, and makes one starter on the next run", async () => {
      const t = await boot("code");
      await asNeverSeeded(t);
      const sets = (await all(t, LAYOUTS_SLUG)).length;

      // Each of the seed's writes, failed in turn: the two components, the
      // set, the record and the settings.
      const steps = ["header", "footer", "set", "record", "settings"] as const;
      for (const failing of steps) {
        let createCount = 0;
        const failingApi = new Proxy(t.nextly, {
          get(target, key, receiver) {
            if (key === "create") {
              return async (args: { collection: string }) => {
                createCount += 1;
                const step =
                  args.collection === LAYOUTS_SLUG
                    ? "set"
                    : createCount === 1
                      ? "header"
                      : "footer";
                if (step === failing) throw new Error(`the ${step} failed`);
                return target.create(args as never);
              };
            }
            if (key === "updateSingle" && failing === "settings") {
              return async () => {
                throw new Error("the settings failed");
              };
            }
            return Reflect.get(target, key, receiver) as unknown;
          },
        }) as DefaultLayoutDirectApi;
        const real = starterRecordStore(db(), dialectOf());
        const record: StarterRecordStore = {
          ...real,
          claim: async made => {
            if (failing === "record") throw new Error("the record failed");
            return real.claim(made);
          },
        };
        await expect(
          ensureDefaultLayout(
            deps(t, { nextly: failingApi, starter: starterParts(record) })
          )
        ).rejects.toThrow(`the ${failing} failed`);
        expect(await all(t, COMPONENTS_SLUG), failing).toEqual([]);
        expect((await all(t, LAYOUTS_SLUG)).length, failing).toBe(sets);
        expect(await recordRow(), failing).toBeNull();
        expect(
          (await readLayoutSettings(t.nextly, SLUGS)).seededLayout,
          failing
        ).toBeNull();
      }

      expect(await ensureDefaultLayout(deps(t))).toBe("seeded");
      expect((await all(t, COMPONENTS_SLUG)).length).toBe(2);
      expect((await all(t, LAYOUTS_SLUG)).length).toBe(sets + 1);
      expect(await recordRow()).not.toBeNull();
    });

    it("ends two runs racing to make the starter with exactly one: the record's insert decides", async () => {
      const t = await boot("code");
      await asNeverSeeded(t);
      const store = starterRecordStore(db(), dialectOf());

      // Two inserts at once: one lands.
      const a: StarterRecord = {
        header: { id: "a-h", fingerprint: "1" },
        footer: { id: "a-f", fingerprint: "1" },
      };
      const b: StarterRecord = {
        header: { id: "b-h", fingerprint: "2" },
        footer: { id: "b-f", fingerprint: "2" },
      };
      const landed = await Promise.all([store.claim(a), store.claim(b)]);
      expect(landed.filter(Boolean)).toHaveLength(1);
      await store.release(landed[0] === true ? a : b);
      expect(await recordRow()).toBeNull();

      // The other process's claim lands just before this run's.
      const sets = (await all(t, LAYOUTS_SLUG)).length;
      const losing: StarterRecordStore = {
        ...store,
        claim: async made => {
          expect(await store.claim(a)).toBe(true);
          return store.claim(made);
        },
      };
      expect(
        await ensureDefaultLayout(deps(t, { starter: starterParts(losing) }))
      ).toBe("kept");
      expect(await all(t, COMPONENTS_SLUG)).toEqual([]);
      expect((await all(t, LAYOUTS_SLUG)).length).toBe(sets);
      expect(await store.read()).toEqual(a);
    });
  }
);
