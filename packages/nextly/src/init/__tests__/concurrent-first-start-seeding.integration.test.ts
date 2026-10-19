/**
 * Several first starts against one empty database at once, as `next build`'s
 * workers and a fleet of instances are, seed each default row exactly once, on
 * every configured dialect, and a start that finds a row another has just
 * written takes it as seeded and logs nothing above debug.
 *
 * Each worker runs the seeders a first start runs, in the order it runs them,
 * on services of its own and, on PostgreSQL and MySQL, a connection of its
 * own, as a separate process would: one process seeds once, so it is several
 * processes that race. SQLite's workers share the one in-memory connection.
 * Its driver is synchronous, so in-process workers on separate connections to
 * one file cannot interleave: one waiting on another's lock blocks the very
 * thread the holder needs to commit.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROLE_PRESETS } from "../../auth/role-presets";
import { defineCollection, defineSingle, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { seedRolePresets } from "../../database/seeders/role-presets";
import {
  PermissionSeedService,
  type SeedResult,
} from "../../domains/auth/services/permission-seed-service";
import { EmailTemplateService } from "../../domains/email/services/email-template-service";
import { BUILT_IN_TEMPLATES } from "../../domains/email/services/templates";
import { UserFieldDefinitionService } from "../../domains/users/services/user-field-definition-service";
import {
  type CollectedPermission,
  DEFAULT_PERMISSION_GROUP,
} from "../../plugins/permissions/collect-permissions";
import type { CollectedRole } from "../../plugins/roles/collect-roles";
import { seedPluginRoles } from "../../plugins/roles/seed-roles";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ServiceContainer } from "../../services/index";
import type { Logger } from "../../shared/types";

const WORKERS = 4;

const CUSTOM_PERMISSION: CollectedPermission = {
  action: "export",
  resource: "posts",
  slug: "export-posts",
  name: "Export posts",
  owner: "app",
  source: "app",
  group: DEFAULT_PERMISSION_GROUP,
  danger: false,
};

const PLUGIN_ROLE: CollectedRole = {
  slug: "auditor",
  name: "Auditor",
  permissionSlugs: ["read-posts"],
  level: 10,
  owner: "app",
};

/** The app's code-defined user fields, typed as the boot hands them to the sync. */
const CODE_FIELDS = [
  text({ name: "bio" }),
  text({ name: "company" }),
] as unknown as { name: string; [key: string]: unknown }[];

/** The tables a first start writes its default rows to, children first. */
const DEFAULT_ROW_TABLES = [
  "role_permissions",
  "role_inherits",
  "user_roles",
  "user_permission_cache",
  "roles",
  "permissions",
  "user_field_definitions",
  "email_templates",
];

function spyLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe.each(getConfiguredTestDialects())(
  "concurrent first starts seed the default rows once (%s)",
  dialect => {
    let handle: TestNextly;
    /** Where each worker connects: the database the handle booted on. */
    let databaseUrl: string;
    const q = dialect === "mysql" ? "`" : '"';

    async function count(table: string): Promise<number> {
      const rows = await handle.adapter.executeQuery<{ n: unknown }>(
        `SELECT COUNT(*) AS n FROM ${q}${table}${q}`
      );
      return Number(rows[0].n);
    }

    async function ids(table: string): Promise<string[]> {
      const rows = await handle.adapter.executeQuery<{ id: unknown }>(
        `SELECT ${q}id${q} AS id FROM ${q}${table}${q}`
      );
      return rows.map(r => String(r.id));
    }

    /**
     * First starts, one per logger, each on a connection and services of its
     * own. Every connection is open before any seeding begins: otherwise the
     * first to connect would seed everything before the others had started,
     * and nothing would race.
     */
    async function firstStarts(loggers: Logger[]): Promise<SeedResult[][]> {
      if (dialect === "sqlite") {
        return Promise.all(loggers.map(l => seedOn(handle.adapter, l)));
      }
      const adapters = await Promise.all(
        loggers.map(() => createAdapter({ type: dialect, url: databaseUrl }))
      );
      try {
        return await Promise.all(
          adapters.map((adapter, i) => seedOn(adapter, loggers[i]))
        );
      } finally {
        await Promise.all(adapters.map(adapter => adapter.disconnect()));
      }
    }

    async function seedOn(
      adapter: DrizzleAdapter,
      logger: Logger
    ): Promise<SeedResult[]> {
      const permissions = new PermissionSeedService(adapter, logger);
      const results = [
        await permissions.seedSystemPermissions(),
        await permissions.seedAllCollectionPermissions(),
        await permissions.seedAllSinglePermissions(),
        await permissions.seedCustomPermissions([CUSTOM_PERMISSION]),
      ];
      await seedRolePresets(adapter, logger);
      await seedPluginRoles(adapter, [PLUGIN_ROLE], logger);
      await new EmailTemplateService(adapter, logger).ensureBuiltInTemplates();
      await new UserFieldDefinitionService(adapter, logger).syncCodeFields(
        CODE_FIELDS
      );
      return results;
    }

    /** This suite's app, logging to `logger` when one is given. */
    function boot(logger?: Logger): Promise<TestNextly> {
      return createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        ...(logger ? { logger } : {}),
        collections: [
          defineCollection({
            slug: "posts",
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: "announcement",
            fields: [text({ name: "message" })],
          }),
        ],
      });
    }

    beforeEach(async () => {
      handle = await boot();
      // The provisioned database's own URL, which the boot leaves in place.
      if (dialect !== "sqlite") databaseUrl = String(process.env.DATABASE_URL);
      // An empty database: none of the default rows written yet.
      for (const table of DEFAULT_ROW_TABLES) {
        await handle.adapter.executeQuery(`DELETE FROM ${q}${table}${q}`);
      }
    });

    afterEach(async () => {
      await handle?.destroy();
    });

    it("writes each default row once, and no start warns or errors", async () => {
      const loggers = Array.from({ length: WORKERS }, spyLogger);
      const results = await firstStarts(loggers);

      for (const logger of loggers) {
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
      }
      for (const result of results.flat()) expect(result.errors).toBe(0);

      // Each permission was created by exactly one start, under the id that
      // was stored: a start that lost the race reports the row as found, not
      // an id of its own that a caller would go on to grant. Not asked of
      // SQLite's shared connection, where another worker's rolled-back
      // transaction can take a row back after its writer reported it.
      if (dialect !== "sqlite") {
        const reportedNew = results.flat().flatMap(r => r.newPermissionIds);
        expect([...reportedNew].sort()).toEqual(
          (await ids("permissions")).sort()
        );
      }

      const reader = new EmailTemplateService(handle.adapter, spyLogger());
      for (const template of BUILT_IN_TEMPLATES) {
        expect(await reader.getTemplateBySlug(template.slug)).not.toBeNull();
      }
      const roles = new ServiceContainer(handle.adapter).roles;
      for (const slug of [...ROLE_PRESETS.map(p => p.slug), PLUGIN_ROLE.slug]) {
        expect(await roles.findRoleIdBySlug(slug)).toBeTruthy();
      }
      expect(await count("roles")).toBe(ROLE_PRESETS.length + 1);
      expect(await count("user_field_definitions")).toBe(CODE_FIELDS.length);
      expect(await count("email_templates")).toBe(BUILT_IN_TEMPLATES.length);

      // A later start finds every row already there.
      const before = await Promise.all(DEFAULT_ROW_TABLES.map(count));
      const [later] = await firstStarts([spyLogger()]);
      for (const result of later) {
        expect(result.created).toBe(0);
        expect(result.errors).toBe(0);
      }
      expect(await Promise.all(DEFAULT_ROW_TABLES.map(count))).toEqual(before);
    });

    it("gives concurrent first reads of a Single one default document, and none errors", async () => {
      // Booted again with a logger to watch: the read logs through the app's.
      await handle.destroy();
      const logger = spyLogger();
      handle = await boot(logger);
      await handle.adapter.executeQuery(
        `DELETE FROM ${q}single_announcement${q}`
      );

      const reads = await Promise.all(
        Array.from({ length: WORKERS }, () =>
          handle.nextly.findSingle({ slug: "announcement" })
        )
      );

      // Every reader got the one document that was stored.
      const readIds = reads.map(read => String((read as { id: unknown }).id));
      expect(new Set(readIds).size).toBe(1);
      expect(await ids("single_announcement")).toEqual([readIds[0]]);
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("still refuses a permission whose slug another permission holds", async () => {
      const permissions = new ServiceContainer(handle.adapter).permissions;
      await permissions.ensurePermission(
        "read",
        "posts",
        "Read posts",
        "read-posts"
      );

      await expect(
        permissions.ensurePermission(
          "export",
          "posts",
          "Export posts",
          "read-posts"
        )
      ).rejects.toThrow();
      expect(await count("permissions")).toBe(1);
    });

    it("still warns of a preset whose name a custom role holds", async () => {
      const preset = ROLE_PRESETS[0];
      const services = new ServiceContainer(handle.adapter);
      const read = await services.permissions.ensurePermission(
        "read",
        "posts",
        "Read posts",
        "read-posts"
      );
      await services.roles.createRole({
        name: preset.name,
        slug: `custom-${preset.slug}`,
        level: 1,
        isSystem: false,
        permissionIds: [read.id],
      });
      const logger = spyLogger();

      await seedRolePresets(handle.adapter, logger);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`"${preset.slug}"`)
      );
    });

    it("still fails a code field sync whose name an admin's field holds", async () => {
      const service = new UserFieldDefinitionService(
        handle.adapter,
        spyLogger()
      );
      await service.createField({ name: "bio", label: "Bio", type: "text" });

      await expect(service.syncCodeFields(CODE_FIELDS)).rejects.toThrow();
    });
  }
);
