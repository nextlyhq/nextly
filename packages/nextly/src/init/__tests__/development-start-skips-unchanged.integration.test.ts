/**
 * A development start does each piece of bookkeeping once, and skips what has
 * not changed, on every dialect.
 *
 * The database is migrated for the configuration, and one development start
 * has run on it, as on a developer's machine after the first `next dev`. Every
 * statement a later development start sends is recorded at the driver
 * (`record-statements`), the work it leaves running after it resolves
 * included (`startSettled`), and judged:
 * - each permission is read at most once in a start (today the registry sync
 *   ensures an entity's permissions and the full seeding ensures them again);
 * - a start with the configuration unchanged writes no bookkeeping, and sends
 *   as many statements for 50 entities as for 5;
 * - a start with one entity changed sends statements naming that entity and
 *   no other.
 *
 * Entities are collections `p<n>x` and Singles `s<n>x`, so a statement names
 * one by its slug or its table (`dc_p<n>x`, `single_s<n>x`).
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

// The collections each development start's drift check is asked to compare,
// recorded on the way through: the check itself runs as it would.
const driftChecked = vi.hoisted(() => [] as string[][]);
vi.mock("../drift-check", async original => {
  const actual = await original<typeof import("../drift-check")>();
  return {
    ...actual,
    runDriftCheck: (args: Parameters<typeof actual.runDriftCheck>[0]) => {
      driftChecked.push(args.collections.map(collection => collection.slug));
      return actual.runDriftCheck(args);
    },
  };
});

// The Nextly version a start runs, which a test moves to stand in for an
// upgrade and a downgrade.
const version = vi.hoisted(() => ({ suffix: "" }));
vi.mock("../../plugins/core-version", async original => {
  const actual = await original<typeof import("../../plugins/core-version")>();
  return {
    ...actual,
    getCoreVersion: () => `${actual.getCoreVersion()}${version.suffix}`,
  };
});

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { PermissionService } from "../../domains/auth/services/permission-service";
import { shutdownServices } from "../../di/register";
import { getNextly, startSettled } from "../../init";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/**
 * `n` collections and a fifth as many Singles, each with one text field. The
 * one entity a test changes gains a field (`how: "field"`, a change a start
 * finds the table behind on) or a new label (`how: "label"`, which leaves the
 * table as it is).
 */
function entities(
  n: number,
  changed?: string,
  how: "field" | "label" = "field"
) {
  const fields = (slug: string) => [
    text({ name: "title" }),
    ...(slug === changed && how === "field"
      ? [text({ name: "subtitle" })]
      : []),
  ];
  const labels = (slug: string) =>
    slug === changed && how === "label"
      ? { labels: { singular: "Renamed", plural: "Renamed" } }
      : {};
  return {
    collections: Array.from({ length: n }, (_, i) =>
      defineCollection({
        slug: `p${i}x`,
        fields: fields(`p${i}x`),
        ...labels(`p${i}x`),
      })
    ),
    singles: Array.from({ length: Math.ceil(n / 5) }, (_, i) =>
      defineSingle({ slug: `s${i}x`, fields: fields(`s${i}x`) })
    ),
  };
}

/** The entities a statement names, by slug or by table. */
function named(call: RecordedStatement): Set<string> {
  const said = `${call.text} ${JSON.stringify(call.values)}`;
  // Not \b: in a table name (`dc_p0x`) the underscore is a word character, so
  // the slug in it has no word boundary before it.
  return new Set(
    [...said.matchAll(/(?<![a-z0-9])([ps]\d+x)(?![a-z0-9])/gi)].map(match =>
      match[1].toLowerCase()
    )
  );
}

/** A statement that writes. */
const WRITE = /^\s*(insert|update|delete|replace|create|alter|drop)\b/i;

/**
 * The bookkeeping, as the spec names it: the registry rows of collections,
 * Singles and components, the permissions, the roles and their grants, and the
 * user field definitions. The schema lock, the job queue and the start's own
 * upkeep (the email templates' reconciliation) are not.
 */
const BOOKKEEPING =
  /\b(dynamic_collections|dynamic_singles|dynamic_components|permissions|roles|role_permissions|user_field_definitions)\b/i;

/** The statements of `calls` that write the bookkeeping. */
const bookkeepingWrites = (calls: readonly RecordedStatement[]) =>
  calls
    .filter(call => WRITE.test(call.text) && BOOKKEEPING.test(call.text))
    .map(call => call.text.replace(/\s+/g, " ").slice(0, 120));

describe.each(getConfiguredTestDialects())(
  "a development start (%s)",
  (dialect: TestDialect) => {
    const drops: Array<() => Promise<void>> = [];

    afterEach(async () => {
      version.suffix = "";
      await shutdownServices();
      vi.unstubAllEnvs();
      _resetEnvCache();
      for (const drop of drops.splice(0)) await drop();
    });

    /** A database migrated for `n` entities, with one development start run on it. */
    async function startedDatabase(
      n: number,
      // Whether a development start has run on it already, as after a first `next dev`.
      started = true
    ): Promise<() => Promise<DrizzleAdapter>> {
      let url: string;
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-dev-start-"));
        url = `file:${join(dir, "start.db")}`;
        drops.push(async () => rmSync(dir, { recursive: true, force: true }));
      } else {
        const scratch = await createScratchDatabase(
          dialect,
          "nextly_dev_start"
        );
        url = scratch.url;
        drops.push(scratch.drop);
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      const adapterFor = () =>
        createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0]) as Promise<DrizzleAdapter>;
      await createTestNextly({
        adapter: (await adapterFor()) as never,
        ...entities(n),
      });
      await shutdownServices();
      if (started) await recordStart(adapterFor, entities(n));
      return adapterFor;
    }

    /** Every statement one development start sends with `declared`. */
    async function recordStart(
      adapterFor: () => Promise<DrizzleAdapter>,
      declared: ReturnType<typeof entities>
    ): Promise<RecordedStatement[]> {
      vi.stubEnv("NODE_ENV", "development");
      const adapter = await adapterFor();
      const recorder = await recordStatements(adapter, dialect);
      try {
        const nextly = await getNextly({
          config: sanitizeConfig(defineConfig(declared)) as never,
          adapter,
        });
        await startSettled();
        recorder.uninstall();
        await nextly.shutdown();
      } finally {
        recorder.uninstall();
      }
      return recorder.calls;
    }

    it("reads each permission at most once", async () => {
      const adapterFor = await startedDatabase(5);
      // Each ensuring of an entity's permission, by the action and the entity,
      // however it is asked: one at a time or many against one read.
      const ensured = new Map<string, number>();
      const count = (action: string, resource: string) => {
        if (!/^[ps]\d+x$/.test(resource)) return;
        const key = `${action}:${resource}`;
        ensured.set(key, (ensured.get(key) ?? 0) + 1);
      };
      // Spies call through, recording each call.
      const one = vi.spyOn(PermissionService.prototype, "ensurePermission");
      const many = vi.spyOn(PermissionService.prototype, "ensurePermissions");
      let calls: RecordedStatement[];
      try {
        calls = await recordStart(adapterFor, entities(5));
        for (const [action, resource] of one.mock.calls)
          count(action, resource);
        for (const [declared] of many.mock.calls) {
          for (const { action, resource } of declared) count(action, resource);
        }
      } finally {
        one.mockRestore();
        many.mockRestore();
      }
      expect([...ensured].filter(([, n]) => n > 1)).toEqual([]);
      // Seen at all, so the count is of a start that ensured them.
      expect(ensured.size).toBeGreaterThan(0);

      // Each read of the permissions table that asks for one entity's
      // permission, by the action and the entity it is for.
      const reads = new Map<string, number>();
      for (const call of calls) {
        if (
          !/^\s*select\b[\s\S]*\bfrom\s+["`]?permissions["`]?/i.test(call.text)
        ) {
          continue;
        }
        const [action, resource] = call.values.map(String);
        if (!/^[ps]\d+x$/.test(resource ?? "")) continue;
        const key = `${action}:${resource}`;
        reads.set(key, (reads.get(key) ?? 0) + 1);
      }
      expect([...reads].filter(([, count]) => count > 1)).toEqual([]);
    }, 300_000);

    it("with nothing changed writes no bookkeeping, and sends as many statements for 50 entities as for 5", async () => {
      const few = await recordStart(await startedDatabase(5), entities(5));
      await shutdownServices();
      const many = await recordStart(await startedDatabase(50), entities(50));

      expect(bookkeepingWrites(few)).toEqual([]);
      expect(bookkeepingWrites(many)).toEqual([]);
      expect(many.length).toBe(few.length);
    }, 600_000);

    it("with one entity changed sends statements for that entity only", async () => {
      const adapterFor = await startedDatabase(5);
      const calls = await recordStart(adapterFor, entities(5, "p2x"));

      const others = new Set(
        calls.flatMap(call => [...named(call)].filter(slug => slug !== "p2x"))
      );
      expect([...others]).toEqual([]);
      // And the changed one is written: the start is not skipping it too.
      expect(
        calls.some(call => WRITE.test(call.text) && named(call).has("p2x"))
      ).toBe(true);
    }, 300_000);

    it("checks again an entity whose registry row another writer changed, and no other", async () => {
      const adapterFor = await startedDatabase(5);
      // What an HMR apply, `nextly migrate` or a hand edit leaves: the row no
      // longer holds what the declaration describes, though the declaration is
      // the one the last start recorded.
      const editor = await adapterFor();
      await editor.executeQuery(
        "UPDATE dynamic_collections SET schema_hash = 'edited' WHERE slug = 'p1x'"
      );
      await editor.disconnect();

      const calls = await recordStart(adapterFor, entities(5));

      const seen = new Set(calls.flatMap(call => [...named(call)]));
      expect([...seen].filter(slug => slug !== "p1x")).toEqual([]);
      // The start does not take it for unchanged: the drift check compares its
      // table again, as it would after an HMR apply the configuration has
      // since been reverted from.
      expect(driftChecked.at(-1)).toEqual(["p1x"]);
    }, 300_000);

    it("checks a drifted entity again at every start, and no other", async () => {
      const adapterFor = await startedDatabase(5);
      // A start does not alter a table that exists (HMR and `db:sync` do), so
      // its drift check finds p2x's new field missing: not vouched for.
      await recordStart(adapterFor, entities(5, "p2x"));

      const again = await recordStart(adapterFor, entities(5, "p2x"));
      const seen = new Set(again.flatMap(call => [...named(call)]));
      expect([...seen]).toEqual(["p2x"]);
    }, 300_000);

    it("records a changed entity a start finds in line, and skips it at the next", async () => {
      const adapterFor = await startedDatabase(5);
      // A new label changes the declaration and leaves the table as it is.
      const changed = await recordStart(
        adapterFor,
        entities(5, "p2x", "label")
      );
      expect(changed.some(call => named(call).has("p2x"))).toBe(true);

      const after = await recordStart(adapterFor, entities(5, "p2x", "label"));
      expect(
        after.filter(call => named(call).size > 0).map(c => c.text)
      ).toEqual([]);
    }, 300_000);

    it("trusts no entity row recorded under other settings than the salt row names", async () => {
      const adapterFor = await startedDatabase(5);
      const saltRow = async (value?: string) => {
        const db = await adapterFor();
        try {
          if (value !== undefined) {
            await db.executeQuery(
              `UPDATE nextly_meta SET value = '${value.replace(/'/g, "''")}' WHERE key = 'development_start:salt'`
            );
          }
          const [row] = await db.executeQuery<{ value: unknown }>(
            "SELECT value FROM nextly_meta WHERE key = 'development_start:salt'"
          );
          return String(row.value);
        } finally {
          await db.disconnect();
        }
      };
      const first = await saltRow();

      // A start under another Nextly version records every entity's row for
      // it, and is stopped before its salt row is written: the rows are the
      // new version's, the salt row still the old one's.
      version.suffix = "-next";
      await recordStart(adapterFor, entities(5));
      await saltRow(first);

      // Back on the first version, the salt row matches but the entity rows
      // were not recorded under it: every collection is checked again.
      version.suffix = "";
      await recordStart(adapterFor, entities(5));
      expect([...(driftChecked.at(-1) ?? [])].sort()).toEqual([
        "p0x",
        "p1x",
        "p2x",
        "p3x",
        "p4x",
      ]);
    }, 300_000);

    it("records 50 entities with as many statements as 5", async () => {
      /** The writes to `nextly_meta` of a first development start. */
      const recordingWrites = async (n: number) => {
        await shutdownServices();
        const calls = await recordStart(
          await startedDatabase(n, false),
          entities(n)
        );
        return calls.filter(
          call => WRITE.test(call.text) && /nextly_meta/i.test(call.text)
        ).length;
      };
      const few = await recordingWrites(5);
      const many = await recordingWrites(50);

      expect(few).toBeGreaterThan(0);
      expect(many).toBe(few);
    }, 600_000);
  }
);
