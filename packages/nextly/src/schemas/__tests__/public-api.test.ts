/**
 * Public API regression test for the consolidated schemas barrel.
 *
 * Pins what `nextly/schemas` must export. Failure here means the consolidation
 * is incomplete or a planned export was accidentally removed. Update this test
 * deliberately when the spec adds a new public export — never silently.
 *
 * @module schemas/__tests__/public-api.test
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { describe, it, expect } from "vitest";

import * as schemas from "../index";

describe("schemas public API", () => {
  describe("getCoreSchema()", () => {
    it("is exported as a function", () => {
      expect(typeof schemas.getCoreSchema).toBe("function");
    });

    it("returns a NextlySchemaSnapshot for postgres", () => {
      const snap = schemas.getCoreSchema("postgresql");
      expect(snap).toHaveProperty("tables");
      expect(Array.isArray(snap.tables)).toBe(true);
    });

    it("returns a NextlySchemaSnapshot for mysql", () => {
      const snap = schemas.getCoreSchema("mysql");
      expect(snap).toHaveProperty("tables");
      expect(Array.isArray(snap.tables)).toBe(true);
    });

    it("returns a NextlySchemaSnapshot for sqlite", () => {
      const snap = schemas.getCoreSchema("sqlite");
      expect(snap).toHaveProperty("tables");
      expect(Array.isArray(snap.tables)).toBe(true);
    });
  });

  describe("CORE_TABLE_NAMES", () => {
    it("is a readonly string array", () => {
      expect(Array.isArray(schemas.CORE_TABLE_NAMES)).toBe(true);
      schemas.CORE_TABLE_NAMES.forEach(name => {
        expect(typeof name).toBe("string");
      });
    });

    it("includes the canonical core tables", () => {
      const required = [
        "users",
        "accounts",
        "sessions",
        "verification_tokens",
        "password_reset_tokens",
        "email_verification_tokens",
        "refresh_tokens",
        "roles",
        "permissions",
        "role_permissions",
        "user_roles",
        "role_inherits",
        "user_permission_cache",
        "api_keys",
        "audit_log",
        "activity_log",
        "media",
        "media_folders",
        "image_sizes",
        "dynamic_collections",
        "dynamic_singles",
        "dynamic_components",
        "site_settings",
        "user_field_definitions",
        "email_providers",
        "email_templates",
        "nextly_meta",
      ] as const;
      required.forEach(name => {
        expect(schemas.CORE_TABLE_NAMES).toContain(name);
      });
    });

    it("excludes the migration ledger (bootstrapped out-of-band, not reconciled)", () => {
      expect(schemas.CORE_TABLE_NAMES).not.toContain("nextly_schema_events");
    });
  });

  describe("CORE_TABLE_PREFIXES", () => {
    it("is a readonly string array", () => {
      expect(Array.isArray(schemas.CORE_TABLE_PREFIXES)).toBe(true);
    });

    it("includes the managed user-table prefixes", () => {
      expect(schemas.CORE_TABLE_PREFIXES).toContain("dc_");
      expect(schemas.CORE_TABLE_PREFIXES).toContain("single_");
      expect(schemas.CORE_TABLE_PREFIXES).toContain("comp_");
    });
  });

  describe("named Drizzle table re-exports", () => {
    it("re-exports the canonical table objects", () => {
      // Smoke check — every name listed has a defined value.
      // We don't introspect Drizzle internals; presence is enough.
      const names = [
        "users",
        "accounts",
        "sessions",
        "roles",
        "permissions",
        "apiKeys",
        "media",
        "mediaFolders",
        "auditLog",
        "activityLog",
        "nextlyMeta",
      ] as const;
      names.forEach(name => {
        expect((schemas as Record<string, unknown>)[name]).toBeDefined();
      });
    });
  });
});
