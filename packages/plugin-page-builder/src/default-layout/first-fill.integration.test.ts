/**
 * The first header or footer an author publishes takes the starter's place
 * in the site default, once, against a real instance on every configured
 * dialect.
 *
 * What separates a correct release from a plausible broken one:
 * - a first published header (and footer) replaces the untouched starter in
 *   Main, published, and the starter stays in Components, published;
 * - it fills an empty area too, and a component made published first and
 *   marked "Use as: Header" later counts as its first publish as a header;
 * - a second header published later, a draft, a starter the author edited,
 *   an authored default and a site drawing its own header change nothing;
 * - two publishes racing for one area fill it exactly once, and a header's
 *   fill and a footer's racing each keep the other's;
 * - the publisher is told once.
 *
 * @module default-layout/first-fill.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { deleteUnplacedComponent } from "../component-delete/system-delete";
import { fenceStore } from "../host-rewrite/fence";
import { layoutRemovalStore } from "../layout-removal/store";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

import { ensureDefaultLayout } from "./ensure-default";
import { fillMarkStore, type FillMarkStore } from "./fill-mark";
import { fillDefaultOnFirstPublish } from "./first-fill";
import { OWN_SET_COMPONENT_CONTEXT_KEY } from "./first-fill-hook";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./settings-single";
import { starterRecordStore, type StarterRecord } from "./starter-record";
import type { StarterParts } from "./starter-seed";
import { readLayoutSettings, writeLayoutSettings } from "./store";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

type Row = Record<string, unknown>;

/** What a probe plugin reaches: the page builder's own tables. */
interface Probe {
  db?: PluginDatabase;
  dialect?: Parameters<typeof fillMarkStore>[1];
}

function probePlugin(probe: Probe): PluginDefinition {
  return definePlugin({
    name: "@test/first-fill-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    dependsOn: { [PAGE_BUILDER_PLUGIN_NAME]: "*" },
    init(ctx) {
      probe.db = ctx.db;
      probe.dialect = ctx.dialect;
    },
  });
}

/** The author every publish here is made as, unless a test says otherwise. */
const AUTHOR = { id: "author-1" };

const heading = (id: string, text: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text, level: "h1" },
});

/** A component document holding one heading. */
const documentOf = (id: string, text: string) => ({
  formatVersion: 1,
  kind: "component",
  nodes: [heading(id, text)],
});

describe.each(getConfiguredTestDialects())(
  "the first published header or footer fills the default (%s)",
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

    function dialectOf(): Parameters<typeof fillMarkStore>[1] {
      if (probe.dialect === undefined) throw new Error("no dialect");
      return probe.dialect;
    }

    function marks(): FillMarkStore {
      return fillMarkStore(db(), dialectOf());
    }

    /** The parts the installed plugin seeds its starter with. */
    function starterParts(): StarterParts {
      return {
        components: COMPONENTS_SLUG,
        record: starterRecordStore(db(), dialectOf()),
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

    async function starter(): Promise<StarterRecord> {
      const record = await starterRecordStore(db(), dialectOf()).read();
      if (record === null || record === "made") throw new Error("no starter");
      return record;
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
      // Joins the boot's own seed, which `onReady` starts without awaiting,
      // with what the installed plugin seeds with.
      await ensureDefaultLayout({
        nextly: current.nextly,
        slugs: SLUGS,
        pagesSlug: PAGES_SLUG,
        removals: layoutRemovalStore(db(), dialectOf()),
        warn: () => {},
        ...(mode === "code" ? {} : { starter: starterParts() }),
      });
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

    /** A set's areas, as `{ area: componentId }`. */
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

    /** A set, as its live row is stored. */
    async function set(t: TestNextly, id: string): Promise<Row> {
      const found = (await all(t, LAYOUTS_SLUG)).find(row => row.id === id);
      if (found === undefined) throw new Error(`no set ${id}`);
      return found;
    }

    /** Main, the seeded default. */
    async function main(t: TestNextly): Promise<Row> {
      const { seededLayout } = await readLayoutSettings(t.nextly, SLUGS);
      if (seededLayout === null) throw new Error("no seed");
      return set(t, seededLayout);
    }

    /** Create a component, as the Direct API does for any caller. */
    async function component(
      t: TestNextly,
      title: string,
      data: { area?: "header" | "footer"; status: "published" | "draft" }
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title,
          slug: title.toLowerCase().replace(/\s+/g, "-"),
          content: documentOf(`${title}-node`, title),
          ...(data.area === undefined ? {} : { area: data.area }),
          status: data.status,
        },
        overrideAccess: true,
        user: AUTHOR,
      });
      return String((created.item as Row).id);
    }

    async function publish(
      t: TestNextly,
      id: string,
      data: Record<string, unknown> = {}
    ): Promise<void> {
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { ...data, status: "published", _overwrite: true },
        overrideAccess: true,
        user: AUTHOR,
      });
    }

    it("puts the first published header and footer in Main, once, and keeps the starter published", async () => {
      const t = await boot();
      const record = await starter();
      const mainId = String((await main(t)).id);

      const header = await component(t, "Acme header", {
        area: "header",
        status: "published",
      });
      expect(areasOf(await main(t))).toEqual({
        header,
        footer: record.footer.id,
      });
      expect((await main(t)).status).toBe("published");

      const footer = await component(t, "Acme footer", {
        area: "footer",
        status: "published",
      });
      expect(areasOf(await main(t))).toEqual({ header, footer });

      // The default is still Main: the fill writes its areas, never which
      // set is the default.
      const settings = await readLayoutSettings(t.nextly, SLUGS);
      expect(settings.defaultLayout).toBe(mainId);

      // The starter stays in Components, published, so it can be chosen again.
      const components = new Map(
        (await all(t, COMPONENTS_SLUG)).map(row => [row.id, row])
      );
      expect(components.get(record.header.id)?.status).toBe("published");
      expect(components.get(record.footer.id)?.status).toBe("published");

      // A second header and footer, published later, change nothing.
      await component(t, "Second header", {
        area: "header",
        status: "published",
      });
      await component(t, "Second footer", {
        area: "footer",
        status: "published",
      });
      expect(areasOf(await main(t))).toEqual({ header, footer });
      expect(await marks().read()).toEqual({
        header: { component: header, tell: AUTHOR.id },
        footer: { component: footer, tell: AUTHOR.id },
      });
    });

    it("fills nothing for a header made for a set of its own, and still fills for the next first header", async () => {
      const t = await boot();
      const record = await starter();
      const before = areasOf(await main(t));
      expect(before.header).toBe(record.header.id);

      // Published by a person, as a set's own "Create a header" makes it.
      await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Landing header",
          slug: "landing-header",
          content: documentOf("landing-header-node", "Landing header"),
          area: "header",
          status: "published",
        },
        overrideAccess: true,
        user: AUTHOR,
        context: { [OWN_SET_COMPONENT_CONTEXT_KEY]: true },
      });
      expect(areasOf(await main(t))).toEqual(before);
      expect((await marks().read()).header).toBeUndefined();

      // The hook still runs for an ordinary first header, so the case above
      // reached it and was told apart, not missed.
      const header = await component(t, "Acme header", {
        area: "header",
        status: "published",
      });
      expect(areasOf(await main(t)).header).toBe(header);
    });

    it("waits for a draft header's publish, and counts a component marked as the header after it was published", async () => {
      const t = await boot();
      const record = await starter();

      const draft = await component(t, "Draft header", {
        area: "header",
        status: "draft",
      });
      expect(areasOf(await main(t)).header).toBe(record.header.id);
      await publish(t, draft);
      expect(areasOf(await main(t)).header).toBe(draft);

      // Made from a selection: created published, with no use yet.
      const made = await component(t, "Made footer", { status: "published" });
      expect(areasOf(await main(t)).footer).toBe(record.footer.id);
      await publish(t, made, { area: "footer" });
      expect(areasOf(await main(t)).footer).toBe(made);
    });

    it("fills an empty area of Main", async () => {
      const t = await boot();
      const record = await starter();
      const seed = await main(t);
      await t.nextly.update({
        collection: LAYOUTS_SLUG,
        id: String(seed.id),
        data: {
          areas: [{ area: "footer", component: record.footer.id }],
          status: "published",
          _overwrite: true,
        },
        overrideAccess: true,
      });
      expect(areasOf(await main(t))).toEqual({ footer: record.footer.id });

      const header = await component(t, "Acme header", {
        area: "header",
        status: "published",
      });
      expect(areasOf(await main(t))).toEqual({
        footer: record.footer.id,
        header,
      });
    });

    it("never replaces a starter the author edited and published", async () => {
      const t = await boot();
      const record = await starter();
      await publish(t, record.header.id, {
        content: documentOf("mine", "My header"),
      });

      await component(t, "Acme header", {
        area: "header",
        status: "published",
      });
      expect(areasOf(await main(t)).header).toBe(record.header.id);
      // The area was not filled, so nothing is marked.
      expect((await marks().read()).header).toBeUndefined();

      // A footer still fills: the edit was the header's.
      const footer = await component(t, "Acme footer", {
        area: "footer",
        status: "published",
      });
      expect(areasOf(await main(t)).footer).toBe(footer);
    });

    it("never touches a default the author chose, nor Main while it is not the default", async () => {
      const t = await boot();
      const record = await starter();
      const own = await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: {
          title: "Own",
          slug: "own",
          areas: [{ area: "header", component: record.header.id }],
          status: "published",
        },
        overrideAccess: true,
      });
      const ownId = String((own.item as Row).id);
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: ownId }
      );
      const mainBefore = areasOf(await main(t));

      await component(t, "Acme footer", {
        area: "footer",
        status: "published",
      });
      await component(t, "Acme header", {
        area: "header",
        status: "published",
      });
      expect(areasOf(await set(t, ownId))).toEqual({
        header: record.header.id,
      });
      expect(areasOf(await main(t))).toEqual(mainBefore);
      expect(await marks().read()).toEqual({});
    });

    it("lets exactly one of two racing first headers fill Main", async () => {
      const t = await boot();
      const [a, b] = await Promise.all([
        component(t, "Header A", { area: "header", status: "published" }),
        component(t, "Header B", { area: "header", status: "published" }),
      ]);
      const filled = areasOf(await main(t)).header;
      expect([a, b]).toContain(filled);
      expect(await marks().read()).toEqual({
        header: { component: filled, tell: AUTHOR.id },
      });
    });

    it("lets one fill land when two pass every check at the same moment: the mark's insert decides", async () => {
      const t = await boot();
      const record = await starter();
      // Drafts, so no publish fills on its own; then both fills at once, each
      // past its checks before either claims.
      const a = await component(t, "Header A", {
        area: "header",
        status: "draft",
      });
      const b = await component(t, "Header B", {
        area: "header",
        status: "draft",
      });
      const deps = {
        nextly: t.nextly,
        slugs: SLUGS,
        components: COMPONENTS_SLUG,
        componentField: "content",
        marks: marks(),
        starter: starterRecordStore(db(), dialectOf()),
      };
      const filled = await Promise.all([
        fillDefaultOnFirstPublish(deps, {
          id: a,
          area: "header",
          by: AUTHOR.id,
        }),
        fillDefaultOnFirstPublish(deps, {
          id: b,
          area: "header",
          by: AUTHOR.id,
        }),
      ]);
      expect(filled.filter(Boolean)).toHaveLength(1);
      const winner = filled[0] ? a : b;
      expect(areasOf(await main(t))).toEqual({
        header: winner,
        footer: record.footer.id,
      });
      expect((await marks().read()).header?.component).toBe(winner);
    });

    it("keeps both when a first header and a first footer fill Main at once", async () => {
      const t = await boot();
      const [header, footer] = await Promise.all([
        component(t, "Acme header", { area: "header", status: "published" }),
        component(t, "Acme footer", { area: "footer", status: "published" }),
      ]);
      expect(areasOf(await main(t))).toEqual({ header, footer });
    });

    it("fills nothing for a publish nobody made, and tells the person who published, once", async () => {
      const t = await boot();
      const record = await starter();
      // A seed or a script: the Direct API with no user.
      await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Seeded header",
          slug: "seeded-header",
          content: documentOf("seeded-node", "Seeded header"),
          area: "header",
          status: "published",
        },
        overrideAccess: true,
      });
      expect(areasOf(await main(t)).header).toBe(record.header.id);
      expect(await marks().read()).toEqual({});

      const footer = await component(t, "Acme footer", {
        area: "footer",
        status: "published",
      });
      expect(areasOf(await main(t)).footer).toBe(footer);
      expect(await marks().take("author-2")).toEqual([]);
      // Two asks at once, as two tabs might: one of them is told.
      const [first, second] = await Promise.all([
        marks().take(AUTHOR.id),
        marks().take(AUTHOR.id),
      ]);
      expect([...first, ...second]).toEqual([
        { area: "footer", component: footer },
      ]);
      expect(await marks().take(AUTHOR.id)).toEqual([]);
    });

    it("fills nothing on a site that draws its own header and footer", async () => {
      const t = await boot("code");
      await component(t, "Acme header", {
        area: "header",
        status: "published",
      });
      expect(areasOf(await main(t))).toEqual({});
      expect(await marks().read()).toEqual({});
    });
  }
);
