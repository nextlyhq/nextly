/**
 * An update made from an out-of-date version is refused the same way on every
 * surface that updates a document: REST, the Direct API and the plugin
 * service. Each answers `STALE_VERSION` with the same public data, and a
 * caller who may not be told who changed it is told only the current version.
 *
 * @module route-handler/__tests__/stale-version-surfaces.integration.test
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

const NOTES = "stale_notes";
const SETTINGS = "stale_settings";

let services: PluginRouteContext["services"]["collections"] | undefined;

const probe = definePlugin({
  name: "stale-version-probe",
  version: "1.0.0",
  nextly: ">=0.0.1",
  init: ctx => {
    services = ctx.services.collections;
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  services = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    plugins: [probe],
    collections: [
      defineCollection({
        slug: NOTES,
        access: { read: () => true, create: () => true, update: () => true },
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
    `update-${NOTES}`,
    `read-${SETTINGS}`,
    `update-${SETTINGS}`,
  ]);
  return current;
}

const SYSTEM: ServiceOpts = { as: "system" };

/** One REST call: its status and JSON body, whatever the status. */
async function rest(
  method: "GET" | "PATCH",
  path: string[],
  body?: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await createDynamicHandlers()[method](
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
  return {
    status: res.status,
    json: (await res.json()) as Record<string, unknown>,
  };
}

/** The error a call threw, or a failure if it threw none. */
async function thrown(
  call: () => Promise<unknown>
): Promise<Record<string, unknown>> {
  try {
    await call();
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("expected the call to be refused");
}

const errorBodyOf = (json: Record<string, unknown>) =>
  (json.error as Record<string, unknown> | undefined) ?? json;

describe.each(getConfiguredTestDialects())(
  "an out-of-date update on every surface (%s)",
  dialect => {
    it("is refused with STALE_VERSION and the current version by REST, the Direct API and the plugin service", async () => {
      const t = await boot(dialect);
      const created = (await t.nextly.create({
        collection: NOTES as never,
        data: { title: "first" },
        overrideAccess: true,
      } as never)) as unknown as { item?: Record<string, unknown> } & Record<
        string,
        unknown
      >;
      const doc = created.item ?? created;
      const id = String(doc.id);
      const read = String(doc._rev);
      await t.nextly.update({
        collection: NOTES as never,
        id,
        data: { title: "theirs", _rev: read },
        overrideAccess: true,
      } as never);

      // REST, as a visitor that may read and update.
      const viaRest = await rest(
        "PATCH",
        ["collections", NOTES, "entries", id],
        {
          title: "mine",
          _rev: read,
        }
      );
      expect(viaRest.status).toBe(409);
      const restError = errorBodyOf(viaRest.json);
      expect(restError).toMatchObject({
        code: "STALE_VERSION",
        data: { currentVersion: "2" },
      });
      // A visitor has no account to be told who changed it by.
      expect(restError.data).not.toHaveProperty("changedBy");
      expect(restError.data).not.toHaveProperty("changedAt");

      // The Direct API, trusted: told who and when as well.
      const direct = await thrown(() =>
        t.nextly.update({
          collection: NOTES as never,
          id,
          data: { title: "mine", _rev: read },
          overrideAccess: true,
        } as never)
      );
      expect(direct).toMatchObject({ code: "STALE_VERSION", statusCode: 409 });
      expect(direct.publicData).toMatchObject({
        currentVersion: "2",
        changedBy: { kind: "system" },
      });

      // The plugin service.
      const plugin = await thrown(() =>
        services!.updateEntry(NOTES, id, { title: "mine", _rev: read }, SYSTEM)
      );
      expect(plugin).toMatchObject({ code: "STALE_VERSION", statusCode: 409 });
      expect(
        (plugin.publicData as Record<string, unknown>).currentVersion
      ).toBe("2");

      // Nothing was written by any of them.
      const now = (await t.nextly.findByID({
        collection: NOTES as never,
        id,
        overrideAccess: true,
      } as never)) as Record<string, unknown>;
      expect(now).toMatchObject({ title: "theirs", _rev: "2" });
    });

    it("refuses a Single the same way through REST and the Direct API", async () => {
      const t = await boot(dialect);
      const first = docOrItem(
        await t.nextly.updateSingle({
          slug: SETTINGS as never,
          data: { notice: "first", _overwrite: true },
          overrideAccess: true,
        } as never)
      );
      const read = String(first._rev);
      await t.nextly.updateSingle({
        slug: SETTINGS as never,
        data: { notice: "theirs", _rev: read },
        overrideAccess: true,
      } as never);

      const viaRest = await rest("PATCH", ["singles", SETTINGS], {
        notice: "mine",
        _rev: read,
      });
      expect(viaRest.status).toBe(409);
      expect(errorBodyOf(viaRest.json)).toMatchObject({
        code: "STALE_VERSION",
      });

      const direct = await thrown(() =>
        t.nextly.updateSingle({
          slug: SETTINGS as never,
          data: { notice: "mine", _rev: read },
          overrideAccess: true,
        } as never)
      );
      expect(direct).toMatchObject({ code: "STALE_VERSION", statusCode: 409 });
    });
  }
);

function docOrItem(value: unknown): Record<string, unknown> {
  const record = value as { item?: Record<string, unknown> } & Record<
    string,
    unknown
  >;
  return record.item ?? record;
}
