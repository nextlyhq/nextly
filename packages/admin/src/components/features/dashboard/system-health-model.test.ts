/**
 * The System health card's three lines, read from its answer: each line's
 * states, what each says, and where each problem leads.
 */
import { describe, expect, it } from "vitest";

import {
  COULD_NOT_CHECK,
  MIGRATIONS_DOCS,
  systemHealthLines,
} from "./system-health-model";

const NOW = Date.parse("2026-10-30T10:00:00.000Z");

const HEALTHY = {
  version: "1.2.3",
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok" },
};

/** One line of the answer, by id. */
function line(data: unknown, id: "version" | "migrations" | "storage") {
  const found = systemHealthLines(data, NOW).find(l => l.id === id);
  if (found === undefined) throw new Error(`no ${id} line`);
  return found;
}

describe("System health's lines", () => {
  it("always draws all three, in order, whatever the answer holds", () => {
    expect(systemHealthLines(HEALTHY, NOW).map(l => l.id)).toEqual([
      "version",
      "migrations",
      "storage",
    ]);
    expect(systemHealthLines(null, NOW).map(l => l.id)).toEqual([
      "version",
      "migrations",
      "storage",
    ]);
  });

  it("names the running Nextly", () => {
    expect(line(HEALTHY, "version")).toMatchObject({
      value: "Nextly 1.2.3",
      severity: "ok",
    });
  });

  describe("migrations", () => {
    it("reads up to date when nothing is waiting", () => {
      expect(line(HEALTHY, "migrations")).toMatchObject({
        value: "Up to date",
        severity: "ok",
        links: [],
      });
    });

    it("reads N pending while migrations are applying, as a warning", () => {
      const data = {
        ...HEALTHY,
        migrations: { status: "pending", failed: 0, pending: 2 },
      };
      expect(line(data, "migrations")).toMatchObject({
        value: "2 pending",
        severity: "warning",
      });
    });

    it("reads failed for a migration that did not finish, linking how to resolve it", () => {
      const data = {
        ...HEALTHY,
        migrations: { status: "failed", failed: 1, pending: 0 },
      };
      expect(line(data, "migrations")).toMatchObject({
        value: "Failed",
        severity: "critical",
        links: [
          { label: "How to resolve", href: MIGRATIONS_DOCS, external: true },
        ],
      });
    });

    it("reads failed for a collection's failed schema change, linking that collection, then the rest", () => {
      const data = {
        ...HEALTHY,
        schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 2 },
      };
      expect(line(data, "migrations")).toMatchObject({
        value: "Failed",
        severity: "critical",
        links: [
          { label: "Fix Posts", href: "/admin/builder/collections/posts" },
          { label: "2 more", href: "/admin/builder/collections" },
        ],
      });
    });
  });

  describe("a line the answer did not settle", () => {
    // 🔴 Read as fallthroughs, a missing line or a status from a newer server
    // drew "Up to date" and "Working": confirmed health from no reading.
    it.each([
      ["absent", { version: "1.2.3", schemaChanges: { failed: [], more: 0 } }],
      ["not an object", { ...HEALTHY, migrations: "ok", storage: "ok" }],
      [
        "an unknown status",
        {
          ...HEALTHY,
          migrations: { status: "later" },
          storage: { status: "degraded" },
        },
      ],
    ])(
      "reads couldn't check, never healthy, when the line is %s",
      (_case, data) => {
        for (const id of ["migrations", "storage"] as const) {
          expect(line(data, id)).toMatchObject({
            value: COULD_NOT_CHECK,
            severity: "unknown",
            links: [],
          });
        }
      }
    );

    it("still reads failed for a collection's failed schema change when the migrations line is absent", () => {
      const data = {
        version: "1.2.3",
        schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 0 },
        storage: { status: "ok" },
      };
      expect(line(data, "migrations")).toMatchObject({
        value: "Failed",
        severity: "critical",
      });
    });
  });

  describe("storage", () => {
    it("reads working while no write has failed", () => {
      expect(line(HEALTHY, "storage")).toMatchObject({
        value: "Working",
        severity: "ok",
        links: [],
      });
    });

    it("reads when its last write failed, why and where, linking the media library", () => {
      const data = {
        ...HEALTHY,
        storage: {
          status: "failed",
          failedAt: "2026-10-30T09:55:00.000Z",
          adapter: "s3",
          reason: "The storage service could not be reached.",
        },
      };
      expect(line(data, "storage")).toMatchObject({
        value: "Last write failed 5m ago",
        severity: "critical",
        detail: "The storage service could not be reached. · s3",
        links: [{ label: "Open media", href: "/admin/media" }],
      });
    });
  });
});
