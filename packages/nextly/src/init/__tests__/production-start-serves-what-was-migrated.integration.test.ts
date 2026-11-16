/**
 * A production start serves the entities as `nextly migrate` left them, on
 * every configured dialect: it changes no entity's migration status, and a
 * field the configuration declares but the database was not migrated for is
 * answered as not migrated.
 *
 * Both cases migrate a database of their own for one build, then start Nextly
 * in production through `getNextly()`, never the test harness, which syncs the
 * registry as a development start does, with a newer build's configuration.
 *
 * - A plugin-contributed collection whose table lacks the column of a field
 *   the plugin's newer release adds keeps its migration status and its
 *   registry row: a start that marked it migrated hid it from the one warning
 *   `nextly migrate` gives for it, and every read of it then failed.
 * - A collection and a Single whose newer build declares a field that neither
 *   the registry row nor the table has. The start writes neither row. The
 *   collection is served as its row describes it, without the field. A write
 *   of the field to either, through the Direct API and through REST, and a read
 *   of the Single, reach the field's column and answer ENTITY_NOT_MIGRATED,
 *   naming the field to trusted server code only. The registry row lacks the field, so the
 *   answer can only come from the fields the configuration declares.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { storeSchemaVersion } from "../../domains/schema/schema-version";
import { SCHEMA_VERSION_READ_INTERVAL_MS } from "../../domains/schema/stored-schema-seq";
import { recordPluginLifecycle } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { NextlyError } from "../../errors/nextly-error";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/** A plugin's release contributing the forms collection, with `newer` fields. */
function formsPlugin(newer: boolean) {
  return definePlugin({
    name: "@test/pssm-forms",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [
        defineCollection({
          slug: "pssm_forms",
          fields: [
            text({ name: "title" }),
            ...(newer ? [text({ name: "handle" })] : []),
          ],
        }),
      ],
    },
  });
}

/** The app's collection and Single, with `subtitle` in the newer build. */
function appEntities(newer: boolean) {
  const fields = [
    text({ name: "title" }),
    ...(newer ? [text({ name: "subtitle" })] : []),
  ];
  return {
    collections: [defineCollection({ slug: "pssm_posts", fields })],
    singles: [defineSingle({ slug: "pssm_banner", fields })],
  };
}

describe.each(getConfiguredTestDialects())(
  "a production start serves what was migrated (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-pssm-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_pssm");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // A production start validates its address before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
    }, 180_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
    });

    /** One registry row, as stored. */
    async function registryRow(
      adapter: DrizzleAdapter,
      table: "dynamic_collections" | "dynamic_singles",
      slug: string
    ): Promise<{ status: string; fields: string[] }> {
      const rows = await adapter.executeQuery<{
        migration_status: unknown;
        fields: unknown;
      }>(
        `SELECT migration_status, fields FROM ${table} WHERE slug = '${slug}'`
      );
      expect(rows, `${slug}'s registry row`).toHaveLength(1);
      const fields =
        typeof rows[0].fields === "string"
          ? (JSON.parse(rows[0].fields) as Array<{ name: string }>)
          : (rows[0].fields as Array<{ name: string }>);
      return {
        status: String(rows[0].migration_status),
        fields: fields.map(field => field.name),
      };
    }

    it("leaves a plugin collection whose table lacks the plugin's new column with its migration status", async () => {
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        plugins: [formsPlugin(false)],
      });
      await recordPluginLifecycle(
        new SchemaEventsRepository(setup.getDrizzle(), dialect),
        "@test/pssm-forms",
        { state: "installed" }
      );
      await shutdownServices();
      // Not yet migrated for the plugin's newer release: `nextly migrate`
      // names it from this status.
      const check = await adapterFor();
      await check.executeQuery(
        "UPDATE dynamic_collections SET migration_status = 'pending' WHERE slug = 'pssm_forms'"
      );
      const before = await registryRow(
        check,
        "dynamic_collections",
        "pssm_forms"
      );
      expect(before.status).toBe("pending");
      expect(before.fields).toContain("title");
      expect(before.fields).not.toContain("handle");

      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      await getNextly({
        config: sanitizeConfig(
          defineConfig({ plugins: [formsPlugin(true)] })
        ) as never,
      });
      await startSettled();
      await shutdownNextly();

      expect(
        await registryRow(check, "dynamic_collections", "pssm_forms")
      ).toEqual(before);
      await check.disconnect().catch(() => undefined);
    }, 240_000);

    /**
     * An API key whose role holds every permission on the app's collection and
     * Single, made through `handle` while the database is set up, so a REST
     * request reaches the read or write rather than stopping at authorization.
     */
    async function editorKey(handle: TestNextly): Promise<string> {
      const api = handle.nextly;
      const owner = await api.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const permissions = await api.permissions.find({ limit: 500 });
      const granted = permissions.items.filter(
        p => p.slug.endsWith("-pssm_posts") || p.slug.endsWith("-pssm_banner")
      );
      expect(
        granted.map(p => p.slug),
        "the key holds the entities' permissions"
      ).toEqual(
        expect.arrayContaining(["create-pssm_posts", "update-pssm_banner"])
      );
      const role = await api.roles.create({
        data: {
          name: "PSSM writer",
          slug: "pssm-writer",
          permissionIds: granted.map(p => p.id),
        },
      });
      const apiKeys = handle.getService("apiKeyService") as unknown as {
        createApiKey(
          userId: string,
          input: {
            name: string;
            tokenType: string;
            roleId: string;
            expiresIn: string;
          }
        ): Promise<{ key: string }>;
      };
      const { key } = await apiKeys.createApiKey(owner.item.id, {
        name: "pssm-writer",
        tokenType: "role-based",
        roleId: role.item.id,
        expiresIn: "unlimited",
      });
      return key;
    }

    /** `error`'s code and the field its public data names, for comparing. */
    function answer(error: unknown): { code: string; field?: unknown } {
      if (!NextlyError.is(error)) {
        return { code: `not a NextlyError: ${String(error)}` };
      }
      const data = error.publicData as { field?: unknown } | undefined;
      return {
        code: error.code,
        ...(data?.field !== undefined ? { field: data.field } : {}),
      };
    }

    it("answers ENTITY_NOT_MIGRATED for a declared field the registry row and the table lack, through the Direct API and REST", async () => {
      const setup = await adapterFor();
      const key = await editorKey(
        await createTestNextly({
          adapter: setup as never,
          ...appEntities(false),
          seedPublic: true,
        })
      );
      await shutdownServices();

      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      const config = sanitizeConfig(defineConfig(appEntities(true))) as never;
      const nextly = await getNextly({ config });
      await startSettled();

      // The start wrote nothing: the rows still lack the field.
      const check = await adapterFor();
      for (const [table, slug] of [
        ["dynamic_collections", "pssm_posts"],
        ["dynamic_singles", "pssm_banner"],
      ] as const) {
        const { fields } = await registryRow(check, table, slug);
        expect(fields).toContain("title");
        expect(fields).not.toContain("subtitle");
      }
      await check.disconnect().catch(() => undefined);

      // The collection is served as its registry row describes it, without
      // the field, so a read that does not reach the field is answered.
      const listed = await nextly.find({ collection: "pssm_posts" });
      expect(listed.items).toEqual([]);

      // A write of the field reaches its column: trusted server code is told
      // the field, from the collection's declared fields.
      expect(
        await nextly
          .create({
            collection: "pssm_posts",
            data: { title: "First", subtitle: "One" },
          })
          .then(() => ({ code: "answered" }), answer)
      ).toEqual({ code: "ENTITY_NOT_MIGRATED", field: "subtitle" });

      // A read of the Single reaches the field's column: trusted server code
      // is told the field.
      expect(
        await nextly
          .findSingle({ slug: "pssm_banner" })
          .then(() => ({ code: "answered" }), answer)
      ).toEqual({ code: "ENTITY_NOT_MIGRATED", field: "subtitle" });

      // A REST caller writing the field is told the entity, never the field.
      const handlers = createDynamicHandlers({ config });
      const rest = async (
        method: "PATCH" | "POST",
        path: string[],
        body: unknown
      ) => {
        const response = await handlers[method](
          new Request(`http://localhost/api/${path.join("/")}`, {
            method,
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
          }),
          { params: Promise.resolve({ params: path }) }
        );
        const json = (await response.json()) as {
          error?: { code?: string; data?: { field?: unknown } };
        };
        return {
          status: response.status,
          code: json.error?.code,
          field: json.error?.data?.field,
        };
      };
      expect({
        collection: await rest(
          "POST",
          ["collections", "pssm_posts", "entries"],
          {
            title: "Second",
            subtitle: "Two",
          }
        ),
        single: await rest("PATCH", ["singles", "pssm_banner"], {
          subtitle: "One",
          _overwrite: true,
        }),
      }).toEqual({
        collection: {
          status: 409,
          code: "ENTITY_NOT_MIGRATED",
          field: undefined,
        },
        single: { status: 409, code: "ENTITY_NOT_MIGRATED", field: undefined },
      });
    }, 240_000);

    it("keeps serving a declared field the table has through the schema follow, though the registry row lacks it", async () => {
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        ...appEntities(false),
      });
      await shutdownServices();
      // The Single's table holds the newer build's column; its registry row is the older build's.
      const ddl = await adapterFor();
      await ddl.executeQuery(
        `ALTER TABLE single_pssm_banner ADD COLUMN subtitle ${
          dialect === "mysql" ? "varchar(255)" : "text"
        }`
      );
      await ddl.disconnect().catch(() => undefined);

      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      const nextly = await getNextly({
        config: sanitizeConfig(defineConfig(appEntities(true))) as never,
      });
      await startSettled();

      // The first call follows the stored version: the definitions it loads keep the field the
      // configuration declares, as the start's did.
      await nextly.updateSingle({
        slug: "pssm_banner",
        data: { title: "Banner", subtitle: "Kept", _overwrite: true },
      } as never);

      // Another copy's registry write moves the stored version; once the read interval has passed
      // this copy follows it, loading the definitions again.
      const other = await adapterFor();
      await storeSchemaVersion(other.getDrizzle(), dialect, { wrote: true });
      await other.disconnect().catch(() => undefined);
      await new Promise(resolve =>
        setTimeout(resolve, SCHEMA_VERSION_READ_INTERVAL_MS + 250)
      );

      const read = (await nextly.findSingle({ slug: "pssm_banner" })) as {
        subtitle?: unknown;
      };
      expect(read.subtitle).toBe("Kept");
    }, 240_000);
  }
);
