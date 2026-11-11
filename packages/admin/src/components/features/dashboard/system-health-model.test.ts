/**
 * The System health card's facts, read from its answer: what each fact says
 * in each state, its chip and what to do about it; and the counting rule the
 * status line reads, with each fact on its own and together.
 */
import { describe, expect, it } from "vitest";

import {
  COULD_NOT_CHECK,
  ENCRYPTION_DOCS,
  MIGRATIONS_DOCS,
  healthSummary,
  pluginDetails,
  runtimeDetails,
  systemHealthFacts,
  type HealthFactId,
} from "./system-health-model";

const NOW = Date.parse("2026-10-30T10:00:00.000Z");

/** An install with nothing wrong, in production, on PostgreSQL over TLS. */
const HEALTHY = {
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
  runtime: { node: "24.11.0", next: "16.0.1", react: "19.2.0" },
  plugins: [{ name: "@nextlyhq/plugin-seo", version: "0.0.2-alpha.74" }],
};

/** One fact of the answer, by id. */
function factOf(data: unknown, id: HealthFactId) {
  const found = systemHealthFacts(data, NOW).find(item => item.id === id);
  if (found === undefined) throw new Error(`no ${id} fact`);
  return found;
}

const summaryOf = (data: unknown) =>
  healthSummary(systemHealthFacts(data, NOW));

describe("System health's facts", () => {
  it("draws the eight facts in order", () => {
    expect(systemHealthFacts(HEALTHY, NOW).map(item => item.id)).toEqual([
      "version",
      "environment",
      "database",
      "connection",
      "migrations",
      "storage",
      "email",
      "jobs",
    ]);
  });

  it("draws a healthy install as the prototype words it", () => {
    const said = systemHealthFacts(HEALTHY, NOW).map(item => [
      item.label,
      item.value,
      item.chip?.label,
    ]);
    expect(said).toEqual([
      ["Nextly", "0.0.2-alpha.74", "Latest"],
      ["Environment", "Production", undefined],
      ["Database", "PostgreSQL 17.2 · 4 ms", undefined],
      ["Connection", "Encrypted", "OK"],
      ["Migrations", "Up to date", undefined],
      ["Storage", "Vercel Blob", "OK"],
      ["Email", "Resend", "OK"],
      ["Background jobs", "2 queued · 0 failed (24 h)", undefined],
    ]);
  });

  it("draws no connection for a database with nothing to encrypt", () => {
    const sqlite = {
      ...HEALTHY,
      database: {
        dialect: "sqlite",
        encryption: "not-applicable",
        exposed: false,
      },
    };
    expect(systemHealthFacts(sqlite, NOW).map(item => item.id)).not.toContain(
      "connection"
    );
    expect(factOf(sqlite, "database").value).toBe("SQLite");
  });

  describe("Nextly", () => {
    it("names a newer release in its channel as available, never as a problem", () => {
      const fact = factOf(
        { ...HEALTHY, latest: { status: "update", version: "0.0.2-alpha.75" } },
        "version"
      );
      expect(fact).toMatchObject({
        value: "0.0.2-alpha.74",
        chip: { label: "0.0.2-alpha.75 available", tone: "info" },
        problems: 0,
        warnings: 0,
      });
    });

    it.each([
      ["could not be checked", { status: "unknown" }],
      ["is absent", undefined],
      ["says update without a version", { status: "update" }],
    ])(
      "says couldn't check for updates, never Latest, when the check %s",
      (_case, latest) => {
        const fact = factOf({ ...HEALTHY, latest }, "version");
        expect(fact.value).toBe("0.0.2-alpha.74");
        expect(fact.note).toBe("Couldn't check for updates");
        expect(fact.chip).toBeUndefined();
        expect(fact.problems + fact.warnings).toBe(0);
      }
    );

    it("reads couldn't check when the answer carries no version", () => {
      expect(factOf({ ...HEALTHY, version: "" }, "version")).toMatchObject({
        value: COULD_NOT_CHECK,
        unread: true,
      });
    });
  });

  describe("Environment", () => {
    it("is the site's own name for the deployment, else production or development", () => {
      expect(
        factOf(
          { ...HEALTHY, environment: { production: true, label: "Staging" } },
          "environment"
        ).value
      ).toBe("Staging");
      expect(
        factOf(
          { ...HEALTHY, environment: { production: false } },
          "environment"
        ).value
      ).toBe("Development");
      expect(factOf({ ...HEALTHY, environment: {} }, "environment").value).toBe(
        COULD_NOT_CHECK
      );
    });
  });

  describe("Connection", () => {
    const connection = (database: Record<string, unknown>) =>
      factOf(
        { ...HEALTHY, database: { ...HEALTHY.database, ...database } },
        "connection"
      );

    it("is a danger in production to another machine when not encrypted, with how to fix it", () => {
      expect(connection({ encryption: "unencrypted" })).toMatchObject({
        value: "Not encrypted",
        chip: { label: "Risk", tone: "destructive" },
        actions: [
          { label: "How to fix", href: ENCRYPTION_DOCS, external: true },
        ],
        problems: 1,
        warnings: 0,
      });
    });

    it("is said and not counted when not encrypted but not exposed", () => {
      expect(
        connection({ encryption: "unencrypted", exposed: false })
      ).toMatchObject({
        value: "Not encrypted",
        actions: [],
        problems: 0,
        warnings: 0,
      });
    });

    it.each([
      ["unknown", "unknown"],
      ["absent", undefined],
      ["a value this admin does not know", "partly"],
    ])(
      "reads couldn't check with a warning, never encrypted, when encryption is %s",
      (_case, encryption) => {
        const fact = connection({ encryption, exposed: false });
        expect(fact).toMatchObject({
          value: COULD_NOT_CHECK,
          chip: { tone: "warning" },
          actions: [],
          problems: 0,
          warnings: 1,
        });
      }
    );

    it("offers how to fix a connection it could not check where it is exposed", () => {
      expect(connection({ encryption: "unknown" }).actions).toEqual([
        { label: "How to fix", href: ENCRYPTION_DOCS, external: true },
      ]);
    });
  });

  describe("Database", () => {
    it("shows a slow response and never counts it", () => {
      const fact = factOf(
        { ...HEALTHY, database: { ...HEALTHY.database, roundTripMs: 2400 } },
        "database"
      );
      expect(fact.value).toBe("PostgreSQL 17.2 · 2400 ms");
      expect(fact.problems + fact.warnings).toBe(0);
    });
  });

  describe("Migrations", () => {
    it("reads N pending as a problem, with how to resolve it", () => {
      expect(
        factOf(
          {
            ...HEALTHY,
            migrations: { status: "pending", failed: 0, pending: 2 },
          },
          "migrations"
        )
      ).toMatchObject({
        value: "2 pending",
        chip: { label: "Pending", tone: "destructive" },
        actions: [{ label: "How to resolve", href: MIGRATIONS_DOCS }],
        problems: 1,
      });
    });

    it("reads failed for a migration and a schema change, two problems, linking each", () => {
      expect(
        factOf(
          {
            ...HEALTHY,
            migrations: { status: "failed", failed: 1, pending: 0 },
            schemaChanges: {
              failed: [{ slug: "posts", label: "Posts" }],
              more: 2,
            },
          },
          "migrations"
        )
      ).toMatchObject({
        value: "Failed",
        chip: { label: "Failed", tone: "destructive" },
        actions: [
          { label: "How to resolve", href: MIGRATIONS_DOCS, external: true },
          { label: "Fix Posts", href: "/admin/builder/collections/posts" },
          { label: "2 more", href: "/admin/builder/collections" },
        ],
        problems: 2,
      });
    });

    it.each([
      ["absent", { ...HEALTHY, migrations: undefined }],
      ["an unknown status", { ...HEALTHY, migrations: { status: "later" } }],
      [
        "without a schema-change result",
        { ...HEALTHY, schemaChanges: undefined },
      ],
      [
        "with a malformed count of more",
        { ...HEALTHY, schemaChanges: { failed: [], more: -1 } },
      ],
    ])(
      "reads couldn't check, never up to date, when it is %s",
      (_case, data) => {
        expect(factOf(data, "migrations")).toMatchObject({
          value: COULD_NOT_CHECK,
          unread: true,
          problems: 0,
          warnings: 0,
        });
      }
    );
  });

  describe("Storage", () => {
    it("reads when its last write failed, why and where, as a problem linking the media library", () => {
      expect(
        factOf(
          {
            ...HEALTHY,
            storage: {
              status: "failed",
              type: "s3",
              failedAt: "2026-10-30T09:55:00.000Z",
              adapter: "s3",
              reason: "The storage service could not be reached.",
            },
          },
          "storage"
        )
      ).toMatchObject({
        value: "Last write failed 5m ago",
        chip: { label: "Failed", tone: "destructive" },
        detail: "The storage service could not be reached. · s3",
        actions: [{ label: "Open media", href: "/admin/media" }],
        problems: 1,
      });
    });

    it("reads couldn't check for a status it does not know", () => {
      expect(
        factOf({ ...HEALTHY, storage: { status: "degraded" } }, "storage").value
      ).toBe(COULD_NOT_CHECK);
    });
  });

  describe("Email", () => {
    it("is a warning when none is set up in production, offering to set one up", () => {
      expect(
        factOf({ ...HEALTHY, email: { provider: null } }, "email")
      ).toMatchObject({
        value: "Not set up",
        chip: { tone: "warning" },
        actions: [{ label: "Set up", href: "/admin/email/sending" }],
        warnings: 1,
      });
    });

    it("is said and not counted when none is set up in development", () => {
      expect(
        factOf(
          {
            ...HEALTHY,
            environment: { production: false },
            email: { provider: null },
          },
          "email"
        )
      ).toMatchObject({
        value: "Not set up",
        note: "Written to the server log",
        warnings: 0,
      });
    });

    it("reads couldn't check, and counts nothing, when it could not be read", () => {
      expect(factOf({ ...HEALTHY, email: null }, "email")).toMatchObject({
        value: COULD_NOT_CHECK,
        warnings: 0,
      });
    });
  });

  describe("Background jobs", () => {
    it("is a warning when jobs failed in the last 24 hours; queued jobs are only said", () => {
      expect(
        factOf(
          { ...HEALTHY, jobs: { queued: 40, running: 1, failed: 3 } },
          "jobs"
        )
      ).toMatchObject({
        value: "40 queued · 3 failed (24 h)",
        chip: { label: "Failed", tone: "warning" },
        warnings: 1,
      });
      expect(factOf(HEALTHY, "jobs").warnings).toBe(0);
    });

    it("reads couldn't check when they could not be counted", () => {
      expect(factOf({ ...HEALTHY, jobs: null }, "jobs").value).toBe(
        COULD_NOT_CHECK
      );
    });
  });
});

describe("the status line's counting rule", () => {
  /** Each fact that counts, on its own, and what it counts as. */
  const ALONE: [string, Record<string, unknown>, "problem" | "warning"][] = [
    [
      "a pending migration",
      { migrations: { status: "pending", failed: 0, pending: 1 } },
      "problem",
    ],
    [
      "a failed migration",
      { migrations: { status: "failed", failed: 1, pending: 0 } },
      "problem",
    ],
    [
      "a failed schema change",
      {
        schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 0 },
      },
      "problem",
    ],
    [
      "a failed storage write",
      { storage: { status: "failed", adapter: "s3" } },
      "problem",
    ],
    [
      "an unencrypted connection to another machine in production",
      { database: { ...HEALTHY.database, encryption: "unencrypted" } },
      "problem",
    ],
    [
      "a connection whose encryption could not be read",
      { database: { ...HEALTHY.database, encryption: "unknown" } },
      "warning",
    ],
    [
      "jobs failed in the last 24 hours",
      { jobs: { queued: 0, running: 0, failed: 1 } },
      "warning",
    ],
    [
      "no email provider in production",
      { email: { provider: null } },
      "warning",
    ],
  ];

  it("reads everything is working with neither", () => {
    expect(summaryOf(HEALTHY)).toEqual({
      problems: 0,
      warnings: 0,
      text: "Everything is working",
      tone: "success",
    });
  });

  it.each(ALONE)("counts %s on its own", (_case, change, kind) => {
    expect(summaryOf({ ...HEALTHY, ...change })).toEqual(
      kind === "problem"
        ? {
            problems: 1,
            warnings: 0,
            text: "1 problem needs attention",
            tone: "destructive",
          }
        : {
            problems: 0,
            warnings: 1,
            text: "1 thing to check",
            tone: "warning",
          }
    );
  });

  it("counts every fact together", () => {
    const everything = ALONE.reduce<Record<string, unknown>>(
      (data, [, change]) => ({ ...data, ...change }),
      { ...HEALTHY }
    );
    // The database's two cases cannot both hold, and the migrations' two are
    // one line: one of each is in `everything`, as the last listed wins.
    expect(summaryOf(everything)).toEqual({
      problems: 3,
      warnings: 3,
      text: "3 problems need attention · 3 things to check",
      tone: "destructive",
    });
  });

  it("counts problems and warnings in the plural, each part on its own", () => {
    expect(
      summaryOf({
        ...HEALTHY,
        migrations: { status: "failed", failed: 1, pending: 0 },
        storage: { status: "failed" },
      }).text
    ).toBe("2 problems need attention");
    expect(
      summaryOf({
        ...HEALTHY,
        jobs: { queued: 0, running: 0, failed: 2 },
        email: { provider: null },
      }).text
    ).toBe("2 things to check");
  });

  it("never counts an available update, a slow database, queued jobs or a fact it could not read", () => {
    expect(
      summaryOf({
        ...HEALTHY,
        latest: { status: "update", version: "0.0.2-alpha.80" },
        database: { ...HEALTHY.database, roundTripMs: 5000 },
        jobs: { queued: 900, running: 4, failed: 0 },
        email: null,
        storage: { status: "later" },
      })
    ).toMatchObject({
      problems: 0,
      warnings: 0,
      text: "Everything is working",
    });
  });
});

describe("Details", () => {
  it("lists the runtime, and couldn't check for a version it was not given", () => {
    expect(runtimeDetails(HEALTHY)).toEqual([
      { name: "Node", value: "24.11.0" },
      { name: "Next.js", value: "16.0.1" },
      { name: "React", value: "19.2.0" },
    ]);
    expect(runtimeDetails({ runtime: { node: "24.11.0" } })[1]).toEqual({
      name: "Next.js",
      value: COULD_NOT_CHECK,
    });
  });

  it("lists each plugin by name, without Nextly's scope, and version", () => {
    expect(
      pluginDetails({
        plugins: [
          ...HEALTHY.plugins,
          { name: "acme-plugin", version: "1.0.0" },
          { name: 3 },
        ],
      })
    ).toEqual([
      { name: "plugin-seo", value: "0.0.2-alpha.74" },
      { name: "acme-plugin", value: "1.0.0" },
    ]);
  });
});
