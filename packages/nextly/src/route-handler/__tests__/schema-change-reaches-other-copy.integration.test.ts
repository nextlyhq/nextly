/**
 * Two server copies of one site on one database, on every dialect: a field
 * added in the Schema Builder on one copy is served by the other within five
 * seconds, with no restart.
 *
 * This process is the copy that keeps serving. It has served the collection
 * already, so its definitions (the entry tables it builds queries from) were
 * loaded before the change. The other copy is a process of its own
 * (`helpers/schema-builder-copy.ts`), because a copy's definitions are process
 * state: two in one process would share them, and the change would reach the
 * second copy through memory rather than through the database.
 *
 * "Served" is the entry form's whole round: the collection's schema names the
 * field, and an entry written with it through this copy's REST API reads back
 * carrying it. A copy still holding the old entry table drops the value on
 * the write, so its read comes back without it.
 *
 * Both copies run as development servers, where the Schema Builder runs its
 * schema statements as it saves; elsewhere a save writes a migration file.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { createAdapter } from "../../database/factory";
import { dispatchCollections } from "../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { ServiceContainer } from "../../services";
import { _resetEnvCache } from "../../shared/lib/env";

const run = promisify(execFile);
const OTHER_COPY = join(__dirname, "helpers", "schema-builder-copy.ts");
const ORIGIN = "http://localhost";
const EDITOR = "other-copy-editor";
/** How soon another copy's change must be served here. */
const WITHIN_MS = 5000;

const FIELDS = [{ name: "title", type: "text" }];
const WITH_SUMMARY = [...FIELDS, { name: "summary", type: "text" }];

describe.each(getConfiguredTestDialects())(
  "a schema change made on another server copy (%s)",
  (dialect: TestDialect) => {
    const slug = `other_copy_notes_${dialect.slice(0, 2)}`;
    let url: string;
    let drop: () => Promise<void>;
    let here: TestNextly;
    let cookie: string;

    beforeAll(async () => {
      vi.stubEnv("NODE_ENV", "development");
      if (dialect === "sqlite") {
        // A file, not memory: the other copy is another process.
        const dir = mkdtempSync(join(tmpdir(), "nextly-other-copy-"));
        url = `file:${join(dir, "site.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_copies");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The database the environment names, as each copy of an app has it.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      here = await createTestNextly({
        adapter: (await createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0])) as never,
      });
      await superAdminUser(here, EDITOR);
      cookie = `nextly_session=${await signAccessToken(
        buildClaims({
          userId: EDITOR,
          email: `${EDITOR}@example.test`,
          name: EDITOR,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      )}`;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: slug, label: slug, fields: FIELDS }
      );
    }, 180_000);

    afterAll(async () => {
      await here?.destroy();
      await drop?.();
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /** A request to this copy's admin API, as the signed-in editor. */
    async function send(
      method: "GET" | "POST",
      path: string,
      body?: unknown
    ): Promise<Response> {
      const target = new URL(`${ORIGIN}/admin/api${path}`);
      const params = target.pathname
        .slice("/admin/api/".length)
        .split("/")
        .filter(Boolean);
      const handlers = createDynamicHandlers();
      return handlers[method](
        new Request(target, {
          method,
          headers: {
            origin: ORIGIN,
            cookie,
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: Promise.resolve({ params }) }
      );
    }

    /** Write an entry through this copy and read it back. */
    async function roundTrip(
      values: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      const created = await send(
        "POST",
        `/collections/${slug}/entries`,
        values
      );
      expect(created.status, await created.clone().text()).toBeLessThan(300);
      const { item } = (await created.json()) as { item: { id: string } };
      const read = await send("GET", `/collections/${slug}/entries/${item.id}`);
      expect(read.status).toBe(200);
      return (await read.json()) as Record<string, unknown>;
    }

    /** The field names this copy's schema read gives the entry form. */
    async function formFields(): Promise<string[]> {
      const response = await send("GET", `/collections/schema/${slug}`);
      expect(response.status).toBe(200);
      const { fields } = (await response.json()) as {
        fields: { name: string }[];
      };
      return fields.map(field => field.name);
    }

    it("is served here within five seconds, with no restart", async () => {
      // This copy serves the collection as it stands, so its entry table is
      // loaded without the field the other copy is about to add.
      expect(await roundTrip({ title: "before" })).toMatchObject({
        title: "before",
      });

      const row = await here.adapter.selectOne<{ schema_version?: unknown }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: slug }] } }
      );
      const saved = await run(
        process.execPath,
        [
          "--import",
          "tsx",
          OTHER_COPY,
          dialect,
          url,
          here.basePath,
          slug,
          String(row?.schema_version ?? 1),
          JSON.stringify(WITH_SUMMARY),
        ],
        {
          cwd: join(__dirname, "..", "..", ".."),
          env: {
            ...process.env,
            NODE_ENV: "development",
            DB_DIALECT: dialect,
            DATABASE_URL: url,
          },
          timeout: 150_000,
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      // Committed before the other copy exited: the clock starts no later
      // than the change.
      const changedBy = Date.now();
      expect(saved.stdout.trim().split("\n").at(-1)).toBe("saved");

      let served: Record<string, unknown> | undefined;
      let fields: string[] = [];
      while (Date.now() - changedBy <= WITHIN_MS) {
        fields = await formFields();
        const entry = await roundTrip({ title: "after", summary: "kept" });
        if (fields.includes("summary") && entry.summary === "kept") {
          served = entry;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      expect(fields).toContain("summary");
      expect(served).toMatchObject({ title: "after", summary: "kept" });
      expect(Date.now() - changedBy).toBeLessThanOrEqual(WITHIN_MS + 1000);
    }, 300_000);
  }
);
