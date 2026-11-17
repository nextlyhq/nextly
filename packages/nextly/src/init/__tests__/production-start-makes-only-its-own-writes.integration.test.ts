/**
 * A production start makes no write but its own, on every configured dialect.
 *
 * The start's own writes are the only writes a production start makes
 * outside the migrations at start, each only where the requirement it names
 * calls for it:
 * - the seals of stored secrets: a plugin setting its manifest now marks
 *   secret, and keys sealed under a secret since retired (the plugin settings,
 *   the key naming deleted people and the plugins' digest keys in
 *   `nextly_meta`, and held messages in the email queue);
 * - the setup token, made where no administrator exists and cleared where one
 *   does;
 * - on SQLite, the database file's journal mode;
 * - after the start completes, the email templates' reconciliation (with the
 *   media usage and the meta rows it records) and, on SQLite, the one-time
 *   timestamp repair.
 *
 * Each case migrates a database for one configuration, as a deployment that
 * ran `nextly migrate` and installed its plugins leaves it, then records every
 * statement of a production start through its real entry point
 * (`getNextly`), until it and the work it leaves running have settled, and
 * classifies every write. Plugins whose start-up code writes nothing.
 *
 * - With a plugin setting newly marked secret, a retired secret configured
 *   and no administrator: every write is one of the start's own, and the
 *   seals and the setup token are among them, so the classifier is shown to
 *   see them.
 * - With none of these (an administrator, a setup token left stored, nothing
 *   sealed under a retired secret): no write at all but the setup token's
 *   clearing and the work after the start.
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
import { z } from "zod";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import { SETUP_TOKEN_META_KEY } from "../../auth/setup-token/setup-token";
import { defineCollection, defineConfig, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { getService } from "../../di/service-access";
import { PRINCIPAL_DIGEST_KEY_META_KEY } from "../../domains/audit/principal-digest";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { recordPluginLifecycle } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import {
  definePlugin,
  type PluginDefinition,
} from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/** Labels the work the start leaves running after it completes. */
const sentFrom = vi.hoisted(() => {
  const { AsyncLocalStorage } = process.getBuiltinModule(
    "node:async_hooks"
  ) as typeof import("node:async_hooks");
  return new AsyncLocalStorage<"after the start">();
});
vi.mock("../post-init-tasks", async original => {
  const actual = await original<typeof import("../post-init-tasks")>();
  return {
    ...actual,
    runPostInitTasks: () =>
      sentFrom.run("after the start", () => actual.runPostInitTasks()),
  };
});

const POSTS = defineCollection({
  slug: "pmo-posts",
  fields: [text({ name: "title" })],
});

/** The secret before a rotation, and the one after it. */
const ORIGINAL_SECRET = process.env.NEXTLY_SECRET;
const ROTATED_SECRET = "nextly-test-rotated-secret-at-least-32-chars";

/**
 * A statement that changes the database, and the table it names, or
 * `journal_mode` for SQLite's pragma, which the file keeps.
 */
const WRITE =
  /^\s*(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|update|delete\s+from|alter\s+table|create\s+(?:unique\s+)?(?:table|index|schema)(?:\s+if\s+not\s+exists)?|drop\s+(?:table|index)(?:\s+if\s+exists)?|truncate(?:\s+table)?)\s+(?:[`"]?\w+[`"]?\.)?[`"]?(\w+)[`"]?|^\s*pragma\s+(?:main\.)?(journal_mode)\s*=/i;

/** Which of the start's own writes a statement is, or why it is none. */
type WriteClass =
  | "secret seal"
  | "setup token"
  | "journal mode"
  | "after the start"
  | `unlisted: ${string}`;

/** Whether `call` names `key`, in its text or among its bound values. */
function names(call: RecordedStatement, key: string): boolean {
  return [call.text, ...call.values.map(String)].some(part =>
    part.includes(key)
  );
}

/** The `nextly_meta` keys of the start's own writes, and what each is. */
const META_KEYS: ReadonlyArray<[key: string, kind: WriteClass]> = [
  [SETUP_TOKEN_META_KEY, "setup token"],
  [PRINCIPAL_DIGEST_KEY_META_KEY, "secret seal"],
  ["plugin.digestKey:", "secret seal"],
];

/** The tables a seal of stored secrets writes besides `nextly_meta`. */
const isSealTable = (table: string): boolean =>
  table === "nextly_plugin_settings" || table.startsWith("nextly_email_queue");

/** The class of `call`, or undefined when it writes nothing. */
function classOf(call: RecordedStatement): WriteClass | undefined {
  const match = WRITE.exec(call.text);
  const table = (match?.[1] ?? match?.[2])?.toLowerCase();
  if (table === undefined) return undefined;
  if (call.context === "after the start") return "after the start";
  if (table === "journal_mode") return "journal mode";
  if (isSealTable(table)) return "secret seal";
  const meta =
    table === "nextly_meta"
      ? META_KEYS.find(([key]) => names(call, key))
      : undefined;
  return (
    meta?.[1] ?? `unlisted: ${call.text.replace(/\s+/g, " ").slice(0, 120)}`
  );
}

/** Each class written, with the statements nothing on the list explains. */
function classify(calls: readonly RecordedStatement[]): {
  classes: Set<WriteClass>;
  unlisted: string[];
} {
  const classes = new Set<WriteClass>();
  const unlisted: string[] = [];
  for (const call of calls) {
    const found = classOf(call);
    if (found === undefined) continue;
    if (found.startsWith("unlisted: ")) unlisted.push(found);
    else classes.add(found);
  }
  return { classes, unlisted };
}

describe.each(getConfiguredTestDialects())(
  "a production start makes only its own writes (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-pmo-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_pmo");
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

    /**
     * Migrate the database with `plugins` installed, as a deployment that ran
     * `nextly migrate` and `nextly plugins install` leaves it, then `after`
     * with its services, as code that ran against it once did.
     */
    async function migrateFor(
      plugins: PluginDefinition[],
      after?: (
        handle: Awaited<ReturnType<typeof createTestNextly>>
      ) => Promise<void>
    ): Promise<void> {
      const setup = await adapterFor();
      const handle = await createTestNextly({
        adapter: setup as never,
        collections: [POSTS],
        plugins,
      });
      for (const plugin of plugins) {
        await recordPluginLifecycle(
          new SchemaEventsRepository(setup.getDrizzle(), dialect),
          plugin.name,
          { state: "installed" }
        );
      }
      await after?.(handle);
      await shutdownServices();
    }

    /** Every statement of one production start of `plugins`, recorded. */
    async function recordedStart(
      plugins: PluginDefinition[]
    ): Promise<RecordedStatement[]> {
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      // Only to find the driver: the recorder patches its prototypes, so the
      // start's own connections are recorded too. On SQLite an in-memory one,
      // since opening the test's file would be a connection of its own.
      const host = (await createAdapter({
        type: dialect,
        url: dialect === "sqlite" ? "file::memory:" : url,
      } as Parameters<typeof createAdapter>[0])) as DrizzleAdapter;
      const recorder = await recordStatements(host, dialect, {
        context: () => sentFrom.getStore(),
      });
      try {
        await getNextly({
          config: sanitizeConfig(
            defineConfig({ collections: [POSTS], plugins })
          ) as never,
        });
        await startSettled();
        return [...recorder.calls];
      } finally {
        recorder.uninstall();
        await host.disconnect().catch(() => undefined);
        await shutdownNextly();
        await shutdownServices();
        resetDispatcherForTests();
      }
    }

    /** A plugin with one setting, `apiKey`, marked secret as `secrets` says. */
    function settingsPlugin(
      name: string,
      secrets: string[],
      store?: string
    ): PluginDefinition {
      return definePlugin({
        name,
        version: "1.0.0",
        nextly: ">=0.0.0",
        capabilities: { secrets },
        contributes: { settings: z.object({ apiKey: z.string() }) },
        async init(ctx) {
          if (store === undefined) return;
          await (
            ctx.settings as { set(v: { apiKey: string }): Promise<void> }
          ).set({ apiKey: store });
        },
      });
    }

    it("with a setting newly marked secret, a retired secret and no administrator, makes only its own writes", async () => {
      // The release before marks nothing secret and stores the value plain;
      // another plugin's setting is sealed under the secret about to retire.
      await migrateFor([
        settingsPlugin("@test/pmo-newly", [], "plain-value-3f9a1c"),
        settingsPlugin("@test/pmo-rotated", ["apiKey"], "sealed-value-8d2e4b"),
      ]);
      vi.stubEnv("NEXTLY_SECRET_PREVIOUS", ORIGINAL_SECRET ?? "");
      vi.stubEnv("NEXTLY_SECRET", ROTATED_SECRET);
      _resetEnvCache();

      const calls = await recordedStart([
        settingsPlugin("@test/pmo-newly", ["apiKey"]),
        settingsPlugin("@test/pmo-rotated", ["apiKey"]),
      ]);

      const { classes, unlisted } = classify(calls);
      expect(unlisted).toEqual([]);
      // The classifier sees the writes it allows: the seals, and the token
      // made for an install with no administrator.
      expect(classes).toContain("secret seal");
      expect(classes).toContain("setup token");
    }, 240_000);

    it("with none of these, writes nothing but the setup token's clearing and the work after the start", async () => {
      await migrateFor(
        [settingsPlugin("@test/pmo-settled", ["apiKey"], "sealed-value-1b7c")],
        async handle => {
          // The install's first account is its administrator.
          await handle.nextly.users.create({
            email: "founder@example.com",
            password: "Str0ng-P@ssw0rd!",
            data: { name: "Founder", isActive: true },
          } as never);
          // A token left stored from before the administrator existed.
          await getService("metaService").set(SETUP_TOKEN_META_KEY, {
            left: "from before the administrator",
          });
        }
      );

      const calls = await recordedStart([
        settingsPlugin("@test/pmo-settled", ["apiKey"]),
      ]);

      const { classes, unlisted } = classify(calls);
      expect(unlisted).toEqual([]);
      expect(
        [...classes].filter(
          found =>
            found !== "setup token" &&
            found !== "after the start" &&
            found !== "journal mode"
        )
      ).toEqual([]);
      // The token is cleared, so the classifier is shown to see that write.
      expect(classes).toContain("setup token");
    }, 240_000);
  }
);
