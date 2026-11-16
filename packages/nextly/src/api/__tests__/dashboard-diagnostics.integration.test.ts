/**
 * The diagnostics report through the real catch-all handler, a real session
 * and a real database: `GET /api/dashboard/diagnostics`.
 *
 * `diagnostics-report.test.ts` holds each line's format and the allow-list
 * over hand-written facts. Here the facts are the install's own, read by the
 * System health card's read, and each kind of secret is planted where a site
 * keeps it (a person's name and email, an entry's content, an environment
 * variable, the environment's label, the storage adapter's record of a failed
 * write, and the database's own connection string) and found nowhere in the
 * report. A reader who is not a super-admin is refused before anything is
 * read.
 *
 * Runs against whichever dialects the integration run configures; CI covers
 * SQLite, PostgreSQL and MySQL.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  superAdminUser,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { forgetLatestVersion } from "../../domains/health/latest-version";
import { forgetServerErrors } from "../../domains/health/server-errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import {
  recordStorageWriteFailure,
  recordStorageWriteSuccess,
} from "../../storage/last-write-failure";
import { sanitizeConfig } from "../../shared/types/config";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const NOTES = "dgn_notes";

const notes = defineCollection({
  slug: NOTES,
  fields: [text({ name: "body" })],
});
const LOCALIZATION = { locales: ["en", "fr"], defaultLocale: "en" };

/** Each kind of secret, as it is planted below. */
const PLANTED = {
  name: "Zebulon Plantedname",
  email: "zebulon.planted@secret-host.example",
  content: "PLANTED-ENTRY-CONTENT-4471",
  envValue: "planted-env-value-sk_live_9931",
  connectionString:
    "postgres://planted:pw-8812@planted-db.secret-host.example:5432/site",
  label: "planted.secret-host.ex",
  storageAddress: "s3://planted-bucket.secret-host.example",
} as const;

function handlers() {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: [notes],
      localization: LOCALIZATION,
      admin: { environment: { label: PLANTED.label } },
    }),
  });
}

async function sessionOf(userId: string): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return `nextly_session=${token}`;
}

function diagnostics(cookie?: string): Promise<Response> {
  return handlers().GET(
    new Request("http://localhost/api/dashboard/diagnostics", {
      headers: cookie === undefined ? {} : { cookie },
    }),
    { params: Promise.resolve({ params: ["dashboard", "diagnostics"] }) }
  );
}

let current: TestNextly | undefined;

beforeEach(() => {
  recordStorageWriteSuccess();
  forgetServerErrors();
  // The newest-version read never reaches the registry from a test.
  forgetLatestVersion();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ latest: "99.0.0", alpha: "99.0.0-alpha.1" })
        )
      )
    )
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  forgetLatestVersion();
  recordStorageWriteSuccess();
  forgetServerErrors();
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "GET /api/dashboard/diagnostics (%s)",
  (dialect: TestDialect) => {
    async function boot() {
      current = await createTestNextly({
        dialect,
        collections: [notes],
        localization: LOCALIZATION,
      });
      const t = current;
      const admin = await superAdminUser(t, "dgn-admin");
      const editor = await userWhoMay(t, "dgn-editor", "read", [NOTES]);
      return { t, admin, editor };
    }

    /** Plants each kind of secret where a site keeps it. */
    async function plant(t: TestNextly): Promise<void> {
      const api = t.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<unknown>;
        };
        create: (a: {
          collection: string;
          data: Record<string, unknown>;
        }) => Promise<unknown>;
      };
      await api.users.create({
        data: {
          email: PLANTED.email,
          password: "Password123!",
          name: PLANTED.name,
          isActive: true,
        },
      });
      await api.create({ collection: NOTES, data: { body: PLANTED.content } });
      vi.stubEnv("PLANTED_API_TOKEN", PLANTED.envValue);
      vi.stubEnv("DATABASE_URL", PLANTED.connectionString);
      recordStorageWriteFailure(
        PLANTED.storageAddress,
        new Error(`Could not reach ${PLANTED.connectionString}`)
      );
    }

    it("builds the report's lines from the install's own facts", async () => {
      const { admin } = await boot();
      const response = await diagnostics(await sessionOf(admin));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const { report } = (await response.json()) as { report: string };
      const lines = report.split("\n");
      expect(lines[0]).toMatch(
        /^Nextly diagnostics, \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/
      );
      expect(lines[1]).toMatch(/^Nextly: \S+ \(latest: \S+\)$/);
      expect(lines).toContain("Environment: development");
      expect(lines[3]).toMatch(/^Runtime: Node \d+\.\d+\.\d+ · Next\.js /);
      const kind = {
        sqlite: "SQLite",
        postgresql: "PostgreSQL",
        mysql: "MySQL",
      }[dialect];
      expect(lines[4]).toMatch(
        new RegExp(`^Database: ${kind}( [\\d.]+)? · \\d+ ms round trip$`)
      );
      const encryption = lines.find(line =>
        line.startsWith("Database connection encrypted:")
      );
      if (dialect === "sqlite") expect(encryption).toBeUndefined();
      else expect(encryption).toMatch(/: (yes|no|unknown)$/);
      expect(lines).toContain("Migrations: up to date · 0 pending · 0 failed");
      expect(lines).toContain("Failed schema changes: 0");
      expect(
        lines.some(line => /^Storage: .+ · last write OK$/.test(line))
      ).toBe(true);
      expect(lines.some(line => line.startsWith("Email: "))).toBe(true);
      expect(lines).toContain(
        "Background jobs: 0 queued · 0 running · 0 failed in 24 h"
      );
      expect(lines.some(line => /^Plugins \(\d+\):$/.test(line))).toBe(true);
      // The admin and the editor; collections and Singles as the registry holds them.
      expect(report).toMatch(
        /^Content: \d+ collections? · \d+ Singles? · 2 users · 2 locales \(en, fr\)$/m
      );
      expect(lines.at(-1)).toBe(
        "Errors in the last 24 h: 0 (server errors, this server process)"
      );
    });

    it("finds none of the secrets planted in configuration and data", async () => {
      const { t, admin } = await boot();
      await plant(t);
      const response = await diagnostics(await sessionOf(admin));
      expect(response.status).toBe(200);
      const { report } = (await response.json()) as { report: string };
      // The planted facts did reach the report's reads: one more user, and a
      // storage write that failed.
      expect(report).toMatch(/· 3 users ·/);
      expect(report).toMatch(/^Storage: .+ · last write failed /m);
      for (const secret of [
        ...Object.values(PLANTED),
        "pw-8812",
        "secret-host",
        "planted",
      ]) {
        expect(report).not.toContain(secret);
      }
      // Nor the database the test itself is connected through.
      const server =
        dialect === "postgresql"
          ? process.env.TEST_POSTGRES_URL
          : dialect === "mysql"
            ? process.env.TEST_MYSQL_URL
            : undefined;
      if (server !== undefined) {
        const url = new URL(server);
        expect(report).not.toContain(server);
        expect(report).not.toContain(`${url.hostname}:${url.port}`);
        if (url.password.length >= 4) {
          expect(report).not.toContain(decodeURIComponent(url.password));
        }
      }
      expect(report).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    });

    it("refuses an editor, and a request with no session", async () => {
      const { editor } = await boot();
      const refused = await diagnostics(await sessionOf(editor));
      expect(refused.status).toBe(403);
      expect(await refused.text()).not.toContain("Nextly diagnostics");
      expect((await diagnostics()).status).toBe(401);
    });
  }
);
