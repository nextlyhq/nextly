/**
 * The diagnostics report's lines, and its allow-list: every fact written in
 * its fixed format, and a value of any other shape, a database address, a key,
 * a person's name or an email placed where a fact was expected, written as
 * "unknown" or left out, never copied.
 */

import { describe, expect, it } from "vitest";

import type { SystemHealthData } from "../../widgets/core-widgets/system-health";
import {
  buildDiagnosticsReport,
  type ContentCounts,
  type DiagnosticsFacts,
} from "../diagnostics-report";

const HEALTHY: SystemHealthData = {
  version: "0.0.2-alpha.74",
  latest: { status: "latest", version: "0.0.2-alpha.74" },
  environment: { production: true },
  database: {
    dialect: "postgresql",
    serverVersion: "17.2",
    roundTripMs: 4,
    encryption: "encrypted",
    exposed: true,
  },
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok", type: "vercel-blob" },
  email: { provider: "Resend" },
  jobs: { queued: 2, running: 0, failed: 0 },
  runtime: { node: "24.11.0", next: "16.4.2", react: "19.2.0" },
  plugins: [
    { name: "@nextlyhq/plugin-form-builder", version: "0.0.2-alpha.74" },
    { name: "@nextlyhq/plugin-seo", version: "0.0.2-alpha.74" },
  ],
};

const CONTENT: ContentCounts = {
  collections: 7,
  singles: 4,
  users: 7,
  locales: ["en"],
};

const AT = new Date("2026-11-10T17:20:41.000Z");

function report(
  health: Partial<SystemHealthData> = {},
  rest: Partial<Omit<DiagnosticsFacts, "health">> = {}
): string {
  return buildDiagnosticsReport({
    at: AT,
    health: { ...HEALTHY, ...health },
    content: CONTENT,
    errors: { count: 0, capped: false },
    ...rest,
  });
}

describe("buildDiagnosticsReport", () => {
  it("writes each allowed fact on its own line, in order", () => {
    expect(report().split("\n")).toEqual([
      "Nextly diagnostics, 2026-11-10 17:20 UTC",
      "Nextly: 0.0.2-alpha.74 (latest: 0.0.2-alpha.74)",
      "Environment: production",
      "Runtime: Node 24.11.0 · Next.js 16.4.2 · React 19.2.0",
      "Database: PostgreSQL 17.2 · 4 ms round trip",
      "Database connection encrypted: yes",
      "Migrations: up to date · 0 pending · 0 failed",
      "Failed schema changes: 0",
      "Storage: Vercel Blob · last write OK",
      "Email: Resend",
      "Background jobs: 2 queued · 0 running · 0 failed in 24 h",
      "Plugins (2):",
      "  @nextlyhq/plugin-form-builder 0.0.2-alpha.74",
      "  @nextlyhq/plugin-seo 0.0.2-alpha.74",
      "Content: 7 collections · 4 Singles · 7 users · 1 locale (en)",
      "Errors in the last 24 h: 0 (server errors, this server process)",
    ]);
  });

  it("writes a site with problems by state and count", () => {
    const lines = report(
      {
        latest: { status: "unknown" },
        environment: { production: false },
        database: {
          dialect: "mysql",
          serverVersion: "8.0.36",
          encryption: "unencrypted",
          exposed: false,
        },
        migrations: { status: "failed", failed: 2, pending: 1 },
        schemaChanges: {
          failed: [{ slug: "posts", label: "Posts" }],
          more: 3,
        },
        storage: {
          status: "failed",
          type: "s3",
          failedAt: "2026-11-10T08:00:00.000Z",
          adapter: "s3",
          reason: "The storage service could not be reached.",
        },
        email: { provider: null },
        jobs: { queued: 0, running: 1, failed: 3 },
        plugins: [],
      },
      {
        content: { collections: 1, singles: 0, users: 1, locales: [] },
        errors: { count: 10_000, capped: true },
      }
    ).split("\n");
    expect(lines).toEqual([
      "Nextly diagnostics, 2026-11-10 17:20 UTC",
      "Nextly: 0.0.2-alpha.74 (latest: unknown)",
      "Environment: development",
      "Runtime: Node 24.11.0 · Next.js 16.4.2 · React 19.2.0",
      "Database: MySQL 8.0.36 · round trip unknown",
      "Database connection encrypted: no",
      "Migrations: failed · 1 pending · 2 failed",
      "Failed schema changes: 4",
      "Storage: S3 · last write failed 2026-11-10 08:00 UTC",
      "Email: not set up",
      "Background jobs: 0 queued · 1 running · 3 failed in 24 h",
      "Plugins (0):",
      "Content: 1 collection · 0 Singles · 1 user · localization off",
      "Errors in the last 24 h: 10000 or more (server errors, this server process)",
    ]);
  });

  it('says "unknown" for an encryption read that could not answer, and nothing for SQLite', () => {
    const unknown = report({
      database: { ...HEALTHY.database, encryption: "unknown" },
    });
    expect(unknown).toContain("Database connection encrypted: unknown");
    const sqlite = report({
      database: {
        dialect: "sqlite",
        serverVersion: "3.45.1",
        roundTripMs: 0,
        encryption: "not-applicable",
        exposed: false,
      },
    });
    expect(sqlite).toContain("Database: SQLite 3.45.1 · 0 ms round trip");
    expect(sqlite).not.toContain("encrypted");
  });

  it("says unknown for a line that could not be read", () => {
    const lines = report(
      { email: null, jobs: null, runtime: { node: "24.11.0" } },
      {
        content: {
          collections: null,
          singles: null,
          users: null,
          locales: null,
        },
      }
    );
    expect(lines).toContain("Email: unknown");
    expect(lines).toContain("Background jobs: unknown");
    expect(lines).toContain(
      "Runtime: Node 24.11.0 · Next.js unknown · React unknown"
    );
    expect(lines).toContain(
      "Content: unknown collections · unknown Singles · unknown users · unknown locales"
    );
  });

  describe("copies nothing outside the allow-list", () => {
    const URL = "postgres://admin:hunter2@db.internal.example.com:5432/site";
    const EMAIL = "jane.doe@example.com";
    const NAME = "Jane Doe";
    const KEY = "sk_live_51HplantedKeyValue";
    const HOST = "db.internal.example.com";

    /** Every fact a string can be planted in, each holding a secret. */
    const planted: SystemHealthData = {
      version: URL,
      latest: { status: "update", version: KEY },
      environment: { production: true, label: `Production on ${HOST}` },
      database: {
        dialect: "postgresql",
        serverVersion: `17.2 on ${HOST}`,
        roundTripMs: 4,
        encryption: "encrypted",
        exposed: true,
      },
      migrations: { status: "ok", failed: 0, pending: 0 },
      schemaChanges: { failed: [{ slug: NAME, label: EMAIL }], more: 0 },
      storage: {
        status: "failed",
        type: URL,
        failedAt: "2026-11-10T08:00:00.000Z",
        adapter: KEY,
        reason: `Could not reach ${URL}`,
      },
      email: { provider: `SMTP ${EMAIL}` },
      jobs: { queued: 0, running: 0, failed: 0 },
      runtime: { node: KEY, next: URL, react: NAME },
      plugins: [
        { name: URL, version: "1.0.0" },
        { name: "my-plugin", version: EMAIL },
      ],
    };

    const text = buildDiagnosticsReport({
      at: AT,
      health: planted,
      content: {
        collections: 1,
        singles: 1,
        users: 1,
        locales: ["en", URL, `fr ${EMAIL}`],
      },
      errors: { count: 0, capped: false },
    });

    it.each([
      ["a database URL", URL],
      ["a host name", HOST],
      ["a password", "hunter2"],
      ["an email address", EMAIL],
      ["a person's name", NAME],
      ["a key", KEY],
      ["an at sign", "@db"],
    ])("never %s", (_kind, secret) => {
      expect(text).not.toContain(secret);
    });

    it("writes each planted fact as unknown, and a planted language not at all", () => {
      expect(text).toContain("Nextly: unknown (latest: unknown)");
      expect(text).toContain("Database: PostgreSQL 17.2 · 4 ms round trip");
      expect(text).toContain("Storage: unknown · last write failed");
      expect(text).toContain("Email: unknown");
      expect(text).toContain("  unknown 1.0.0");
      expect(text).toContain("  my-plugin unknown");
      expect(text).toContain("3 locales (en)");
    });
  });
});
