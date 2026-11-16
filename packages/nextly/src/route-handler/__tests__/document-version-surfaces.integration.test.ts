/**
 * The document version reaches a caller through every door a document leaves
 * by: REST, the Direct API and a plugin's collection service, for an entry
 * and a Single.
 *
 * Each door shapes its own response, so the version can be lost or renamed in
 * any one of them while the services carry it correctly: a projection that
 * drops unknown keys, or a case conversion that turns `_rev` into `Rev`. And
 * each door takes a document back: a client that saves what it read sends the
 * version with it, which must never reach the counter.
 *
 * @module route-handler/__tests__/document-version-surfaces.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { grantPublic } from "../../__tests__/helpers/public-role";
import { defineCollection, defineSingle, text } from "../../config";
import { definePlugin } from "../../plugins/plugin-context";
import type { PluginRouteContext } from "../../plugins/routes/route-types";
import type { ServiceOpts } from "../../plugins/service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

const NOTES = "rev_notes";
/** Draft/Published with held drafts, for a discard. */
const DRAFTED = "rev_drafted";
const SETTINGS = "rev_settings";

let services: PluginRouteContext["services"]["collections"] | undefined;
let versions: PluginRouteContext["services"]["versions"] | undefined;

const probe = definePlugin({
  name: "document-version-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    services = ctx.services.collections;
    versions = ctx.services.versions;
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
  versions = undefined;
});

const OPEN = {
  read: () => true,
  create: () => true,
  update: () => true,
};

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    plugins: [probe],
    collections: [
      defineCollection({
        slug: NOTES,
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: DRAFTED,
        status: true,
        versions: { drafts: true },
        access: OPEN,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: SETTINGS,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "notice" })],
      }),
    ],
  });
  expect(current.adapter.dialect).toBe(dialect);
  // The REST caller is a visitor, judged by the Public role.
  await grantPublic(current, [
    `read-${NOTES}`,
    `create-${NOTES}`,
    `update-${NOTES}`,
    `read-${SETTINGS}`,
    `update-${SETTINGS}`,
  ]);
  return current;
}

const SYSTEM: ServiceOpts = { as: "system" };

/** One REST call, answered as JSON. */
async function rest(
  method: "GET" | "POST" | "PATCH",
  path: string[],
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const handlers = createDynamicHandlers();
  const res = await handlers[method](
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  const json = (await res.json()) as Record<string, unknown>;
  if (res.status >= 300) {
    throw new Error(
      `${method} ${path.join("/")}: ${res.status} ${JSON.stringify(json)}`
    );
  }
  return json;
}

/** The document a REST answer carries: a mutation's `item`, or a read's own body. */
const docOf = (json: Record<string, unknown>): Record<string, unknown> =>
  (json.item as Record<string, unknown> | undefined) ?? json;

async function counterOf(t: TestNextly, table: string, id?: string) {
  const rows = await t.adapter.select<{ id: string; _revision: unknown }>(
    table,
    {}
  );
  const row = id === undefined ? rows[0] : rows.find(r => r.id === id);
  return Number(row?._revision);
}

describe.each(getConfiguredTestDialects())(
  "the document version on every surface (%s)",
  dialect => {
    it("REST returns it from a create, an update, a read and a list, for an entry", async () => {
      const t = await boot(dialect);
      const created = docOf(
        await rest("POST", ["collections", NOTES, "entries"], { title: "a" })
      );
      expect(created._rev).toBe("1");
      // Never under a case-converted name.
      expect(created.Rev).toBeUndefined();
      const id = String(created.id);

      const updated = docOf(
        await rest("PATCH", ["collections", NOTES, "entries", id], {
          title: "b",
          _rev: created._rev,
        })
      );
      expect(updated._rev).toBe("2");

      const read = docOf(
        await rest("GET", ["collections", NOTES, "entries", id])
      );
      expect(read._rev).toBe("2");
      const list = await rest("GET", ["collections", NOTES, "entries"]);
      expect(
        (list.items as Record<string, unknown>[]).map(item => item._rev)
      ).toEqual(["2"]);
    });

    it("REST returns it for a Single, read and update", async () => {
      const t = await boot(dialect);
      const read = docOf(await rest("GET", ["singles", SETTINGS]));
      expect(read._rev).toBe("1");
      const updated = docOf(
        await rest("PATCH", ["singles", SETTINGS], {
          notice: "x",
          _rev: read._rev,
        })
      );
      expect(updated._rev).toBe("2");
      expect(await counterOf(t, `single_${SETTINGS}`)).toBe(2);
    });

    it("a REST read-then-save round trip stores the counter, not the version it sent back", async () => {
      const t = await boot(dialect);
      const id = String(
        docOf(
          await rest("POST", ["collections", NOTES, "entries"], { title: "a" })
        ).id
      );
      const read = docOf(
        await rest("GET", ["collections", NOTES, "entries", id])
      );
      const saved = docOf(
        await rest("PATCH", ["collections", NOTES, "entries", id], read)
      );
      expect(saved._rev).toBe("2");
      expect(await counterOf(t, `dc_${NOTES}`, id)).toBe(2);

      const single = docOf(await rest("GET", ["singles", SETTINGS]));
      await rest("PATCH", ["singles", SETTINGS], single);
      expect(await counterOf(t, `single_${SETTINGS}`)).toBe(2);
    });

    it("the Direct API returns it from create, update, findByID, find, findSingle and updateSingle", async () => {
      const t = await boot(dialect);
      const created = (await t.nextly.create({
        collection: NOTES as never,
        data: { title: "a" },
        overrideAccess: true,
      } as never)) as unknown as { item?: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      const createdDoc = created.item ?? created;
      expect(createdDoc._rev).toBe("1");
      const id = String(createdDoc.id);

      const updated = (await t.nextly.update({
        collection: NOTES as never,
        id,
        data: { title: "b", _rev: "1" },
        overrideAccess: true,
      } as never)) as unknown as { item?: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      expect((updated.item ?? updated)._rev).toBe("2");

      const byId = (await t.nextly.findByID({
        collection: NOTES as never,
        id,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(byId._rev).toBe("2");
      const found = (await t.nextly.find({
        collection: NOTES as never,
        overrideAccess: true,
      } as never)) as { items: Record<string, unknown>[] };
      expect(found.items.map(item => item._rev)).toEqual(["2"]);

      const single = (await t.nextly.findSingle({
        slug: SETTINGS as never,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(single._rev).toBe("1");
      const updatedSingle = (await t.nextly.updateSingle({
        slug: SETTINGS as never,
        data: { notice: "x", _rev: single._rev },
        overrideAccess: true,
      } as never)) as unknown as { item?: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      expect((updatedSingle.item ?? updatedSingle)._rev).toBe("2");
    });

    it("the plugin service returns it from findEntryById, listEntries and updateEntry, and drops one sent back", async () => {
      const t = await boot(dialect);
      const c = services!;
      const created = (await c.createEntry(NOTES, { title: "a" }, SYSTEM))
        .item as unknown as Record<string, unknown>;
      expect(created._rev).toBe("1");
      const id = String(created.id);

      const found = (await c.findEntryById(NOTES, id, SYSTEM)) as Record<
        string,
        unknown
      >;
      expect(found._rev).toBe("1");
      const updated = (
        await c.updateEntry(NOTES, id, { ...found, title: "b" }, SYSTEM)
      ).item as unknown as Record<string, unknown>;
      expect(updated._rev).toBe("2");
      expect(await counterOf(t, `dc_${NOTES}`, id)).toBe(2);

      const listed = (await c.listEntries(NOTES, {}, SYSTEM)) as unknown as {
        data: Record<string, unknown>[];
      };
      expect(listed.data.map(item => item._rev)).toEqual(["2"]);
    });

    it("a trusted plugin's discard of a held draft changes the version a read gives", async () => {
      // Through the document's own service, as every discard goes: never
      // straight to the draft table, which would leave the version as it was.
      const t = await boot(dialect);
      const created = (await t.nextly.create({
        collection: DRAFTED as never,
        data: { title: "live", status: "published" },
        overrideAccess: true,
      } as never)) as unknown as { item?: Record<string, unknown> };
      const id = String(created.item?.id);
      await t.nextly.update({
        collection: DRAFTED as never,
        id,
        data: { title: "held", _overwrite: true },
        overrideAccess: true,
      } as never);
      const read = async () =>
        (
          (await t.nextly.findByID({
            collection: DRAFTED as never,
            id,
            overrideAccess: true,
          } as never)) as Record<string, unknown>
        )._rev;
      const held = await read();

      const removed = await versions!.deleteWorkingDraft(
        { scopeKind: "collection", scopeSlug: DRAFTED, entryId: id },
        null,
        undefined,
        { _rev: held }
      );
      expect(removed).toBe(1);
      expect(await read()).not.toBe(held);
    });

    it("refuses a trusted plugin's discard inside its own transaction, rather than waiting on it", async () => {
      // The discard takes the document's lock in a transaction of its own,
      // which a row the plugin's transaction wrote would hold it from.
      const t = await boot(dialect);
      const created = (await t.nextly.create({
        collection: DRAFTED as never,
        data: { title: "live", status: "published" },
        overrideAccess: true,
      } as never)) as unknown as { item?: Record<string, unknown> };
      const id = String(created.item?.id);
      await t.nextly.update({
        collection: DRAFTED as never,
        id,
        data: { title: "held", _overwrite: true },
        overrideAccess: true,
      } as never);
      const ref = { scopeKind: "collection", scopeSlug: DRAFTED, entryId: id };

      await expect(
        services!.withTransaction(async tx => {
          await services!.updateEntryInTransaction(tx, DRAFTED, id, {
            title: "written in the plugin's transaction",
            _overwrite: true,
          });
          return versions!.deleteWorkingDraft(ref as never, null);
        })
      ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
      // Nothing discarded: the draft is still there to discard afterwards.
      expect(
        await versions!.deleteWorkingDraft(ref as never, null, undefined, {
          _overwrite: true,
        })
      ).toBe(1);
    }, 60_000);
  }
);
