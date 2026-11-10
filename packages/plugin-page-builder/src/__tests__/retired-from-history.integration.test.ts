/**
 * A component's retired ids, derived again from its published history when
 * the record its publish made is lost.
 *
 * The unit suite drives the derivation over an in-memory history. What only a
 * real instance shows is what core's history holds: that a publish and a draft
 * save each leave a version the plugin can list and read as the system, what
 * status each records, and what shape a snapshot comes back in on each
 * dialect. Asked through the component facts route, as the editor asks before
 * it mints a field id, with a signed session.
 *
 * @module __tests__/retired-from-history.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENT_RETIRED_SLUG } from "../collections/component-retired-exposures";
import { COMPONENTS_SLUG } from "../collections/components";
import {
  componentFactsPath,
  PAGE_BUILDER_PLUGIN_NAME,
} from "../library-contract";
import { pageBuilder } from "../plugin";

type Row = Record<string, unknown>;

const ORIGIN = "http://localhost";

/** While set, every write to the retired table is refused, as a lost record is. */
let refuseRetiredWrites = false;

/** The version numbers a component's history holds, newest first. */
type HistoryNumbers = (componentId: string) => Promise<number[]>;

/** Set by the plugin below, which reads history through its own context. */
let historyOf: HistoryNumbers | undefined;

/**
 * A plugin that refuses retired-table writes while asked to, and reads a
 * component's history as a plugin does.
 */
const refusingRetired = definePlugin({
  name: "@t/refusing-retired",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    historyOf = async componentId =>
      (
        await ctx.services.versions.list(
          {
            scopeKind: "collection",
            scopeSlug: COMPONENTS_SLUG,
            entryId: componentId,
          },
          { limit: 200 }
        )
      ).flatMap(row => (row.versionNo === null ? [] : [row.versionNo]));
    ctx.hooks.on("beforeCreate", COMPONENT_RETIRED_SLUG, hook => {
      if (refuseRetiredWrites) throw new Error("The retired table is down.");
      return (hook as { data?: unknown }).data;
    });
  },
});

/** A hero exposing the named fields, each on a heading of its own. */
const hero = (fields: string[]): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: fields.map(id => ({
    id: `h-${id}`,
    type: "core/heading",
    version: 1,
    props: { text: id, level: 2 },
  })),
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: `h-${id}`,
    propPath: "text",
    type: "text",
  })),
});

describe.each(getConfiguredTestDialects())(
  "a component's retired ids, derived from its history (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      refuseRetiredWrites = false;
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), refusingRetired],
        seedPublic: true,
      });
      // The instance's first user is its super admin, so it is made here
      // and never asks: the reader below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}-${Date.now()}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return created.item.id;
    }

    /** A session for someone who may read components and nothing more. */
    async function reader(t: TestNextly): Promise<string> {
      const userId = await person(t, "reader");
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const read = permissions.items.find(
        item => item.slug === "read-components"
      );
      if (read === undefined) throw new Error("read-components is not seeded");
      const role = await t.nextly.roles.create({
        data: { name: "Reader", slug: "reader", permissionIds: [read.id] },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
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

    /** The facts route's answer for one component, as `cookie`. */
    async function facts(cookie: string, id: string): Promise<Row> {
      const path = componentFactsPath(id);
      const [route] = path.slice(1).split("?");
      const segments = [
        "plugins",
        ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
        ...route!.split("/"),
      ];
      const response = await createDynamicHandlers().GET(
        new Request(
          `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}${path}`,
          { method: "GET", headers: { cookie, origin: ORIGIN } }
        ),
        { params: Promise.resolve({ params: segments }) }
      );
      expect(response.status).toBe(200);
      return (await response.json()) as Row;
    }

    async function publishedHero(t: TestNextly): Promise<string> {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Hero",
          slug: "hero",
          content: hero(["title", "body"]),
          status: "published",
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function save(
      t: TestNextly,
      id: string,
      fields: string[],
      status?: "published"
    ): Promise<void> {
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: {
          content: hero(fields),
          ...(status === undefined ? {} : { status }),
          _overwrite: true,
        },
        overrideAccess: true,
      });
    }

    async function retiredRows(t: TestNextly): Promise<Row[]> {
      const found = await t.nextly.find({
        collection: COMPONENT_RETIRED_SLUG,
        limit: 50,
        depth: 0,
        overrideAccess: true,
      });
      return found.items as Row[];
    }

    const triples = (rows: Row[]) =>
      rows.map(row => [row.componentId, row.kind, row.exposureId]);

    it("answers and records a retirement whose record was lost", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      await save(t, heroId, ["body"], "published");
      // The record the publish made, lost as a failed write loses it.
      for (const row of await retiredRows(t)) {
        await t.nextly.delete({
          collection: COMPONENT_RETIRED_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      expect(await retiredRows(t)).toEqual([]);
      const cookie = await reader(t);

      const answer = await facts(cookie, heroId);

      expect(answer.retired).toEqual({ properties: ["title"], slots: [] });
      expect(triples(await retiredRows(t))).toEqual([
        [heroId, "property", "title"],
      ]);

      // Asked again, the same answer and no second row.
      expect((await facts(cookie, heroId)).retired).toEqual({
        properties: ["title"],
        slots: [],
      });
      expect(await retiredRows(t)).toHaveLength(1);
    });

    it("keeps a lost retirement when a later publish exposes the id again", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      await save(t, heroId, ["body"], "published");
      for (const row of await retiredRows(t)) {
        await t.nextly.delete({
          collection: COMPONENT_RETIRED_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      // The record lost, the write is told by history that the id went: the
      // publish bringing it back has it taken out again, and the table learns
      // it on the way.
      await save(t, heroId, ["title", "body"], "published");
      const live = (await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id: heroId,
        depth: 0,
        overrideAccess: true,
      })) as Row;
      const content = (
        typeof live.content === "string"
          ? JSON.parse(live.content)
          : live.content
      ) as { exposed: Row[] };
      expect(content.exposed.map(entry => entry.id)).toEqual(["body"]);
      const cookie = await reader(t);

      expect((await facts(cookie, heroId)).retired).toEqual({
        properties: ["title"],
        slots: [],
      });
      expect(triples(await retiredRows(t))).toEqual([
        [heroId, "property", "title"],
      ]);
    });

    it("keeps a lost retirement after more saves than retention keeps", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      // The record of this removal fails, and so does every repair, so the
      // removal lives on only in the versions either side of it.
      refuseRetiredWrites = true;
      await save(t, heroId, ["body"], "published");
      expect(await retiredRows(t)).toEqual([]);
      // More held saves than retention keeps (50 a document by default), so
      // the version from before the removal is pruned unless it is held.
      for (let save_ = 0; save_ < 55; save_ += 1) {
        await save(t, heroId, ["body", save_ % 2 === 0 ? "even" : "odd"]);
      }
      // Held: the version before the removal, and the removal, outlive
      // retention, so a repair made after a restart can still read them.
      const held = await historyOf!(heroId);
      expect(held).toContain(1);
      expect(held).toContain(2);
      refuseRetiredWrites = false;
      const cookie = await reader(t);

      expect((await facts(cookie, heroId)).retired).toEqual({
        properties: ["title"],
        slots: [],
      });
      expect(triples(await retiredRows(t))).toEqual([
        [heroId, "property", "title"],
      ]);
      // Recorded, so released: the next save's retention prunes them.
      await save(t, heroId, ["body", "after"]);
      expect(await historyOf!(heroId)).not.toContain(1);
    }, 120_000);

    it("does not retire a field only a draft held", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      // Two held saves: the first adds a field, the second takes it out again,
      // so history holds a draft version exposing it and no published one.
      await save(t, heroId, ["title", "body", "teaser"]);
      await save(t, heroId, ["title", "body"]);
      const cookie = await reader(t);

      const answer = await facts(cookie, heroId);

      expect(answer.retired).toEqual({ properties: [], slots: [] });
      expect(await retiredRows(t)).toEqual([]);
    });

    it("retires a field a published version had and the newest one has not, across a draft", async () => {
      const t = await boot();
      const heroId = await publishedHero(t);
      await save(t, heroId, ["body"], "published");
      await save(t, heroId, ["body", "teaser"]);
      for (const row of await retiredRows(t)) {
        await t.nextly.delete({
          collection: COMPONENT_RETIRED_SLUG,
          id: String(row.id),
          overrideAccess: true,
        });
      }
      const cookie = await reader(t);

      expect((await facts(cookie, heroId)).retired).toEqual({
        properties: ["title"],
        slots: [],
      });
    });
  }
);
