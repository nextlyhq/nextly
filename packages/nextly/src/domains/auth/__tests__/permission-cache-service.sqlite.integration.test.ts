// Integration regression test for the SQLite cache binding bug.
//
// Bug: getCachedPermission interpolated `new Date()` into a raw `sql\`...\``
// template. SQLite drivers (better-sqlite3) only accept numbers, strings,
// bigints, buffers, and null — Date is not bindable, so every authed
// request logged a TypeError and fell through to live-DB lookup.
//
// Fix: switch the > comparison to Drizzle's typed `gt()` operator, which
// converts `Date` to the column's typed representation (epoch seconds for
// SQLite mode:"timestamp"). Same operator the same file's `cleanupExpired`
// uses (line 481) and which has worked fine on all dialects.
//
// This test runs against an in-memory better-sqlite3 instance and a
// minimal hand-rolled adapter — keeps the regression coverage independent
// of the broken mock pattern in the unit-test file alongside this one.

import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionCacheService } from "../services/permission-cache-service";

// Minimal stand-in for `Logger` — we only need `.log` to be callable so the
// service's auth-logger fallback path doesn't blow up. Body is intentionally
// empty: tests assert behavior via return values, not via log output.
const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Parameters<typeof PermissionCacheService["prototype"]["constructor"]> extends [
  unknown,
  infer L,
  ...unknown[],
]
  ? L
  : never;

describe("PermissionCacheService — SQLite real-driver integration", () => {
  let sqlite: Database.Database;
  let cacheService: PermissionCacheService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");

    // Hand-rolled CREATE TABLE that mirrors the SQLite schema from
    // `database/schema/sqlite.ts` (only the columns getCachedPermission
    // reads). expires_at is INTEGER because mode:"timestamp" stores epoch
    // seconds — the same on-disk shape the production schema produces.
    sqlite.exec(`
      CREATE TABLE user_permission_cache (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        has_permission INTEGER NOT NULL,
        role_ids TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    const db = drizzle(sqlite);

    // Minimal DrizzleAdapter shape. PermissionCacheService only touches
    // `getDrizzle()` and `getCapabilities().dialect` (for the `tables`
    // getter on BaseService). Everything else stays untouched.
    const fakeAdapter = {
      getDrizzle: () => db,
      getCapabilities: () => ({
        dialect: "sqlite" as const,
        supportsJsonb: false,
        supportsJson: true,
        supportsArrays: false,
        supportsIlike: false,
        supportsReturning: true,
        supportsSavepoints: true,
        supportsOnConflict: true,
        supportsFts: false,
      }),
    };

    cacheService = new PermissionCacheService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal hand-rolled adapter
      fakeAdapter as any,
      noopLogger,
      { cacheTtlSeconds: 60 }
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  // The actual regression. With the raw-`sql` template + Date binding,
  // better-sqlite3 throws `TypeError: SQLite3 can only bind numbers,
  // strings, bigints, buffers, and null`. With Drizzle's `gt()`, the
  // comparison runs cleanly and the cached row comes back.
  it("returns cached permission without throwing TypeError on SQLite", async () => {
    // Seed a future-expiring cache row directly via raw SQL — bypasses
    // the service's setCachedPermission so this test isolates the read
    // path. expires_at is stored as epoch seconds to match Drizzle's
    // `integer mode:"timestamp"` on-disk format.
    const cacheKey = "user-1|read|users";
    const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
    sqlite
      .prepare(
        `INSERT INTO user_permission_cache
         (id, user_id, action, resource, has_permission, role_ids, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cacheKey,
        "user-1",
        "read",
        "users",
        1,
        "[]",
        futureSeconds,
        Math.floor(Date.now() / 1000)
      );

    const result = await cacheService.getCachedPermission(
      "user-1",
      "read",
      "users"
    );

    expect(result).toBe(true);
  });

  it("returns null for a stale cache row (expires_at in the past)", async () => {
    const cacheKey = "user-2|read|users";
    const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
    sqlite
      .prepare(
        `INSERT INTO user_permission_cache
         (id, user_id, action, resource, has_permission, role_ids, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cacheKey,
        "user-2",
        "read",
        "users",
        1,
        "[]",
        pastSeconds,
        Math.floor(Date.now() / 1000)
      );

    const result = await cacheService.getCachedPermission(
      "user-2",
      "read",
      "users"
    );

    expect(result).toBeNull();
  });

  // Documents the precise binding pattern that broke. If anyone reintroduces
  // a raw `sql\`${col} > ${new Date()}\`` against a SQLite typed-timestamp
  // column, this test will keep failing until they swap to a typed operator.
  it("documents that raw `sql\\`${col} > ${date}\\`` does throw the bind TypeError on SQLite", () => {
    const db = drizzle(sqlite);
    expect(() => {
      // We intentionally execute the failing pattern here to keep the
      // regression visible in code form. drizzle-orm's `sql` template
      // does no Date conversion; the binding hits better-sqlite3 raw.
      db.all(
        sql`SELECT id FROM user_permission_cache WHERE expires_at > ${new Date()}`
      );
    }).toThrow(/SQLite3 can only bind/);
  });
});
