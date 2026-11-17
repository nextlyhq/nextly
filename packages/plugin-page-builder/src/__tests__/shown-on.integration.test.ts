/**
 * Where the builder shows a Single's values, against a real instance: the
 * bindings sweep writes each saved document's uses to `binding_uses`, the
 * route reads them by the Single's slug through Nextly's own request handler
 * with a signed session, and a reader is shown only the places they may
 * read, the rest as a number.
 *
 * What only a server shows: the table on each dialect, the uses written in
 * the sweep's pass after a real save, the caller's read of each document,
 * and the index the panel's one query uses. The migration is applied and
 * undone with the command a deployment runs by
 * `breakpoint-removals-migration.integration.test.ts`.
 *
 * @module __tests__/shown-on.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import type { PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { defineCollection, defineSingle, group, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BINDINGS_REPORT_JOB } from "../bindings-report/job";
import { COMPONENTS_SLUG } from "../collections/components";
import { asOverwrite } from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { migrations } from "../schema/migrations";
import { shownOnPath, type ShownOnAnswer } from "../shown-on-contract";

type Node = Record<string, unknown>;

const ORIGIN = "http://localhost";
const PAGES = "pages";
const SECRETS = "sho_secrets";
const GROUPED = "sho_grouped";
const HOMEPAGE = "sho_homepage";
const TABLE = "page_builder__binding_uses";

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

/** A heading showing the Homepage Single's headline, named as Layers shows it. */
const boundHeading = (id: string, name?: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  ...(name === undefined ? {} : { name }),
  props: { text: "Own", level: 2 },
  bindings: {
    text: { $bind: "headline", source: "single", sourceKey: HOMEPAGE },
  },
});

const documentOf = (kind: "page" | "component", nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
});

/** The report's job, as a jobs pass runs it. */
function sweepPass(plugin: PluginDefinition): () => Promise<unknown> {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === BINDINGS_REPORT_JOB
  );
  if (job === undefined) throw new Error("the page builder has no report job");
  return async () =>
    job.handler(
      null as never,
      {
        user: null,
        now: new Date(),
        deadline: new Date(Date.now() + 60_000),
        content: {},
      } as never
    );
}

describe.each(getConfiguredTestDialects())(
  "where the builder shows a Single's values (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let pass: () => Promise<unknown>;
    let owner: string;

    beforeAll(async () => {
      const plugin = pageBuilder();
      pass = sweepPass(plugin);
      t = await createTestNextly({
        dialect,
        plugins: [plugin],
        collections: [
          defineCollection({
            slug: SECRETS,
            fields: [
              text({ name: "title" }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
          // A blocks field inside a group, which no one may read on its own.
          defineCollection({
            slug: GROUPED,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              group({
                name: "hero",
                fields: [
                  text({ name: "tagline" }),
                  {
                    name: "body",
                    type: BLOCKS_TYPE,
                    access: { read: () => false },
                  } as never,
                ],
              }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: HOMEPAGE,
            fields: [text({ name: "headline" })],
          }),
        ],
      });
      owner = await person("owner");
      // The Single's one row, as a site that has saved it holds it.
      await (
        t.nextly as unknown as {
          updateSingle(args: Record<string, unknown>): Promise<unknown>;
        }
      ).updateSingle({
        slug: HOMEPAGE,
        data: asOverwrite({ headline: "Accurate surveys" }),
        overrideAccess: true,
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    async function person(name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return created.item.id;
    }

    let roles = 0;
    async function grant(userId: string, slugs: string[]): Promise<void> {
      const permissions = await t.nextly.permissions.find({ limit: 1000 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      roles += 1;
      const role = await t.nextly.roles.create({
        data: {
          name: `Role ${roles}`,
          slug: `sho-${roles}`,
          permissionIds: ids,
        },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
    }

    async function sessionOf(userId: string): Promise<string> {
      const user = await t.nextly.users.findByID({ id: userId });
      if (user === null) throw new Error(`no user ${userId}`);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** The route, as the Single's panel calls it, and the text it answered. */
    async function shownOn(
      userId: string,
      all = false
    ): Promise<{ status: number; text: string; body: ShownOnAnswer }> {
      const handlers = createDynamicHandlers();
      const [path, search] = shownOnPath(HOMEPAGE, all).split("?");
      const sub = (path ?? "").split("/").filter(Boolean);
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${sub.join("/")}${search === undefined ? "" : `?${search}`}`;
      const response = await handlers.GET(
        new Request(url, {
          headers: { cookie: await sessionOf(userId), origin: ORIGIN },
        }),
        {
          params: Promise.resolve({
            params: ["plugins", ...PAGE_BUILDER_PLUGIN_NAME.split("/"), ...sub],
          }),
        }
      );
      const raw = await response.text();
      return {
        status: response.status,
        text: raw,
        body: (raw === "" ? {} : JSON.parse(raw)) as ShownOnAnswer,
      };
    }

    async function page(title: string, nodes: Node[]): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: PAGES,
          data: {
            title,
            slug: title.toLowerCase().replaceAll(" ", "-"),
            content: documentOf("page", nodes),
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    it("says it is still checking pages until the first complete check, then lists a saved page's block", async () => {
      // Before any jobs pass has checked every document.
      const before = await shownOn(owner);
      expect(before.status, before.text).toBe(200);
      expect(before.body.checking).toBe(true);

      const home = await page("Home", [boundHeading("hero", "Hero section")]);
      await pass();

      const after = await shownOn(owner);
      expect(after.status, after.text).toBe(200);
      expect(after.body.checking).toBe(false);
      expect(after.body.places).toEqual([
        expect.objectContaining({
          kind: "collection",
          slug: PAGES,
          documentId: home,
          title: "Home",
          block: "Hero section",
          nodeId: "hero",
          blocksField: "content",
        }),
      ]);
    });

    it("follows each save: a block named by its type, and a binding taken out", async () => {
      const id = await page("About", [boundHeading("intro")]);
      await pass();
      const listed = await shownOn(owner);
      expect(
        listed.body.places.find(place => place.documentId === id)?.block
      ).toBe("Heading");

      await t.nextly.update({
        collection: PAGES,
        id,
        data: asOverwrite({
          content: documentOf("page", [
            {
              id: "intro",
              type: "core/heading",
              version: 1,
              props: { text: "Own", level: 2 },
            },
          ]),
          // Published: a draft alone leaves the published page showing it.
          status: "published",
        }),
        overrideAccess: true,
      });
      await pass();
      const gone = await shownOn(owner);
      expect(gone.body.places.map(place => place.documentId)).not.toContain(id);
    });

    it("lists a binding inside a component once, on the component, not on the pages placing it", async () => {
      const component = idOf(
        await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Main header",
            slug: "main-header",
            content: documentOf("component", [
              boundHeading("cta", "Call to action"),
            ]),
            status: "published",
          },
          overrideAccess: true,
        })
      );
      const placing = (id: string): Node => ({
        id,
        type: COMPONENT_INSTANCE_TYPE,
        version: 1,
        props: { componentId: component },
      });
      const first = await page("Pricing", [placing("p1")]);
      const second = await page("Contact", [placing("p2")]);
      await pass();

      const answer = await shownOn(owner, true);
      const onComponent = answer.body.places.filter(
        place => place.documentId === component
      );
      expect(onComponent).toEqual([
        expect.objectContaining({
          slug: COMPONENTS_SLUG,
          title: "Main header",
          block: "Call to action",
          nodeId: "cta",
        }),
      ]);
      const ids = answer.body.places.map(place => place.documentId);
      expect(ids).not.toContain(first);
      expect(ids).not.toContain(second);
    });

    it("lists only what a reader may read, and counts a page they can't as a number only", async () => {
      const secret = idOf(
        await t.nextly.create({
          collection: SECRETS,
          data: {
            title: "Board minutes",
            content: documentOf("page", [
              boundHeading("leak", "Quarterly numbers"),
            ]),
          },
          overrideAccess: true,
        })
      );
      await pass();
      const reader = await person("reader");
      await grant(reader, [
        "read-pages",
        `read-${COMPONENTS_SLUG}`,
        `read-${HOMEPAGE}`,
      ]);

      const everyone = await shownOn(owner, true);
      expect(everyone.body.places.map(place => place.documentId)).toContain(
        secret
      );

      const answer = await shownOn(reader, true);
      expect(answer.status, answer.text).toBe(200);
      expect(answer.body.places.map(place => place.documentId)).not.toContain(
        secret
      );
      expect(answer.body.hidden).toBe(1);
      // Nothing of it reaches the reader but the number.
      for (const trace of [
        secret,
        "Board minutes",
        "Quarterly numbers",
        "leak",
        SECRETS,
      ]) {
        expect(answer.text).not.toContain(trace);
      }
    });

    it("counts a block in a grouped blocks field the reader can't read, naming nothing of it", async () => {
      const id = idOf(
        await t.nextly.create({
          collection: GROUPED,
          data: {
            title: "Grouped page",
            hero: {
              tagline: "Open to read",
              body: documentOf("page", [
                boundHeading("inner", "Withheld block"),
              ]),
            },
          },
          overrideAccess: true,
        })
      );
      await pass();
      // CONTROL: the index holds it, so a missing row is the reader's, not the sweep's.
      const stored = await t.adapter.select<Record<string, unknown>>(TABLE);
      expect(
        stored.filter(row => (row.documentId ?? row.document_id) === id)
      ).not.toHaveLength(0);
      const reader = await person("grouped-reader");
      await grant(reader, [`read-${GROUPED}`, `read-${HOMEPAGE}`]);

      const answer = await shownOn(reader, true);
      expect(answer.status, answer.text).toBe(200);
      expect(answer.body.places.map(place => place.documentId)).not.toContain(
        id
      );
      expect(answer.body.hidden).toBeGreaterThanOrEqual(1);
      for (const trace of [id, "Withheld block", "inner", "hero.body"]) {
        expect(answer.text).not.toContain(trace);
      }
    });

    it("lists a block only in a page's working draft for its editors, and counts it for a reader", async () => {
      const id = await page("Draft work", [boundHeading("live", "Live block")]);
      // Edited and saved, not published: the new block is only in the draft.
      await t.nextly.update({
        collection: PAGES,
        id,
        data: asOverwrite({
          content: documentOf("page", [
            boundHeading("live", "Live block"),
            boundHeading("pending", "Unpublished block"),
          ]),
        }),
        overrideAccess: true,
      });
      await pass();
      const reader = await person("draft-reader");
      await grant(reader, ["read-pages", `read-${HOMEPAGE}`]);

      const read = await shownOn(reader, true);
      const blocks = read.body.places
        .filter(place => place.documentId === id)
        .map(place => place.block);
      expect(blocks).toEqual(["Live block"]);
      expect(read.text).not.toContain("Unpublished block");
      expect(read.text).not.toContain("pending");

      const edited = await shownOn(owner, true);
      expect(
        edited.body.places
          .filter(place => place.documentId === id)
          .map(place => place.block)
          .sort()
      ).toEqual(["Live block", "Unpublished block"]);
    });

    it("refuses a reader who may not read the Single", async () => {
      const blind = await person("blind");
      await grant(blind, ["read-pages"]);
      const answer = await shownOn(blind);
      expect(answer.status, answer.text).toBe(403);
      expect(answer.text).not.toContain("places");
    });

    it("keeps the index the panel's one query reads by: what the uses read", async () => {
      // The columns of each index on the table, as the database lists them.
      const listed =
        dialect === "sqlite"
          ? await t.adapter.executeQuery<Record<string, unknown>>(
              `SELECT "sql" AS "columns" FROM "sqlite_master" WHERE "type" = 'index' AND "tbl_name" = '${TABLE}'`
            )
          : dialect === "mysql"
            ? await t.adapter.executeQuery<Record<string, unknown>>(
                `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}' GROUP BY INDEX_NAME`
              )
            : await t.adapter.executeQuery<Record<string, unknown>>(
                `SELECT indexdef AS columns FROM pg_indexes WHERE tablename = '${TABLE}'`
              );
      const indexes = listed.map(row =>
        String(row.columns).replaceAll(/[`"\s]/g, "")
      );
      expect(
        indexes.some(columns => columns.includes("source_kind,source_key"))
      ).toBe(true);
      expect(indexes.some(columns => /document_key\)?$/.test(columns))).toBe(
        true
      );
    });
  }
);

describe("the binding uses migration", () => {
  it("creates the table with its indexes on every dialect, and its down step drops it", () => {
    const module = migrations.find(entry =>
      entry.name.endsWith("_create_binding_uses_table")
    );
    expect(module).toBeDefined();
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const steps = module?.dialects[dialect];
      expect(steps?.up.join("\n")).toContain("page_builder__binding_uses");
      expect(steps?.up.join("\n")).toContain("source_kind");
      expect(steps?.down.join("\n")).toMatch(/DROP TABLE/);
    }
  });
});
