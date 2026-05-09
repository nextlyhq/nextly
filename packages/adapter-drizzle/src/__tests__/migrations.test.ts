/**
 * Tests for migration utilities.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest";

import {
  calculateChecksum,
  sortMigrations,
  filterPending,
  filterApplied,
  validateChecksum,
  detectModified,
  getMigrationStatus,
  validateMigrations,
  migrationHelpers,
} from "../migrations";
import type { Migration, MigrationRecord } from "../types/migration";

// ============================================================
// Test Data
// ============================================================

const createMigration = (
  id: string,
  timestamp: number,
  up: string
): Migration => ({
  id,
  name: `Migration ${id}`,
  timestamp,
  up,
});

const createMigrationRecord = (
  id: string,
  appliedAt: Date,
  checksum?: string
): MigrationRecord => ({
  id,
  name: `Migration ${id}`,
  appliedAt,
  checksum,
});

// ============================================================
// Core Utilities Tests
// ============================================================

describe("calculateChecksum", () => {
  it("should calculate consistent checksum for same migration", () => {
    const migration: Migration = {
      id: "001_create_users",
      name: "Create users table",
      timestamp: 1704326400000,
      up: "CREATE TABLE users (id UUID PRIMARY KEY);",
    };

    const checksum1 = calculateChecksum(migration);
    const checksum2 = calculateChecksum(migration);

    expect(checksum1).toBe(checksum2);
    expect(checksum1).toHaveLength(64); // SHA-256 produces 64 hex characters
  });

  it("should produce different checksums for different migrations", () => {
    const migration1 = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users"
    );
    const migration2 = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE posts"
    );

    const checksum1 = calculateChecksum(migration1);
    const checksum2 = calculateChecksum(migration2);

    expect(checksum1).not.toBe(checksum2);
  });

  it("should handle function-based up migrations", () => {
    const migration: Migration = {
      id: "001",
      name: "Test",
      timestamp: 1704326400000,
      up: async tx => {
        await tx.execute("CREATE TABLE test", []);
      },
    };

    const checksum = calculateChecksum(migration);
    expect(checksum).toBeTruthy();
    expect(checksum).toHaveLength(64);
  });

  it("should include down migration in checksum", () => {
    const migration1: Migration = {
      id: "001",
      name: "Test",
      timestamp: 1704326400000,
      up: "CREATE TABLE test",
    };

    const migration2: Migration = {
      ...migration1,
      down: "DROP TABLE test",
    };

    const checksum1 = calculateChecksum(migration1);
    const checksum2 = calculateChecksum(migration2);

    expect(checksum1).not.toBe(checksum2);
  });
});

describe("sortMigrations", () => {
  it("should sort migrations by timestamp ascending", () => {
    const migrations = [
      createMigration("003", 1704412800000, "SQL3"),
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
    ];

    const sorted = sortMigrations(migrations);

    expect(sorted[0].id).toBe("001");
    expect(sorted[1].id).toBe("002");
    expect(sorted[2].id).toBe("003");
  });

  it("should use ID as secondary sort for same timestamps", () => {
    const migrations = [
      createMigration("003", 1704326400000, "SQL3"),
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704326400000, "SQL2"),
    ];

    const sorted = sortMigrations(migrations);

    expect(sorted[0].id).toBe("001");
    expect(sorted[1].id).toBe("002");
    expect(sorted[2].id).toBe("003");
  });

  it("should not modify original array", () => {
    const migrations = [
      createMigration("003", 1704412800000, "SQL3"),
      createMigration("001", 1704326400000, "SQL1"),
    ];

    const originalFirst = migrations[0].id;
    sortMigrations(migrations);

    expect(migrations[0].id).toBe(originalFirst);
  });

  it("should handle empty array", () => {
    const sorted = sortMigrations([]);
    expect(sorted).toEqual([]);
  });
});

describe("filterPending", () => {
  it("should return migrations not in applied records", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
      createMigration("003", 1704412800000, "SQL3"),
    ];

    const applied = [createMigrationRecord("001", new Date())];

    const pending = filterPending(migrations, applied);

    expect(pending).toHaveLength(2);
    expect(pending[0].id).toBe("002");
    expect(pending[1].id).toBe("003");
  });

  it("should return empty array when all migrations applied", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
    ];

    const applied = [
      createMigrationRecord("001", new Date()),
      createMigrationRecord("002", new Date()),
    ];

    const pending = filterPending(migrations, applied);

    expect(pending).toHaveLength(0);
  });

  it("should return all migrations when none applied", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
    ];

    const pending = filterPending(migrations, []);

    expect(pending).toHaveLength(2);
  });
});

describe("filterApplied", () => {
  it("should return applied records matching given migrations", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
    ];

    const applied = [
      createMigrationRecord("001", new Date()),
      createMigrationRecord("002", new Date()),
      createMigrationRecord("003", new Date()),
    ];

    const relevant = filterApplied(migrations, applied);

    expect(relevant).toHaveLength(2);
    expect(relevant[0].id).toBe("001");
    expect(relevant[1].id).toBe("002");
  });

  it("should return empty array when no matches", () => {
    const migrations = [createMigration("001", 1704326400000, "SQL1")];

    const applied = [
      createMigrationRecord("002", new Date()),
      createMigrationRecord("003", new Date()),
    ];

    const relevant = filterApplied(migrations, applied);

    expect(relevant).toHaveLength(0);
  });
});

describe("validateChecksum", () => {
  it("should return true for matching checksums", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE test"
    );
    const checksum = calculateChecksum(migration);
    const record = createMigrationRecord("001", new Date(), checksum);

    const isValid = validateChecksum(migration, record);

    expect(isValid).toBe(true);
  });

  it("should return false for mismatched checksums", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE test"
    );
    const record = createMigrationRecord("001", new Date(), "wrong_checksum");

    const isValid = validateChecksum(migration, record);

    expect(isValid).toBe(false);
  });

  it("should return false when record has no checksum", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE test"
    );
    const record = createMigrationRecord("001", new Date());

    const isValid = validateChecksum(migration, record);

    expect(isValid).toBe(false);
  });
});

describe("detectModified", () => {
  it("should detect modified migrations", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users"
    );
    const originalChecksum = calculateChecksum(migration);

    // Simulate the migration being modified
    const modifiedMigration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users_modified"
    );

    const applied = [
      createMigrationRecord("001", new Date(), originalChecksum),
    ];

    const modified = detectModified([modifiedMigration], applied);

    expect(modified).toHaveLength(1);
    expect(modified[0].id).toBe("001");
  });

  it("should return empty array when no modifications", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users"
    );
    const checksum = calculateChecksum(migration);
    const applied = [createMigrationRecord("001", new Date(), checksum)];

    const modified = detectModified([migration], applied);

    expect(modified).toHaveLength(0);
  });

  it("should handle migrations without applied records", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users"
    );
    const applied = [createMigrationRecord("002", new Date(), "checksum")];

    const modified = detectModified([migration], applied);

    expect(modified).toHaveLength(0);
  });
});

describe("getMigrationStatus", () => {
  it("should return comprehensive migration status", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
      createMigration("003", 1704412800000, "SQL3"),
    ];

    const applied = [
      createMigrationRecord("001", new Date("2025-01-01")),
      createMigrationRecord("002", new Date("2025-01-02")),
    ];

    const status = getMigrationStatus(migrations, applied);

    expect(status.current).toBe("002"); // Most recently applied
    expect(status.appliedCount).toBe(2);
    expect(status.pendingCount).toBe(1);
    expect(status.applied).toHaveLength(2);
    expect(status.pending).toHaveLength(1);
    expect(status.pending[0].id).toBe("003");
  });

  it("should return null current when no migrations applied", () => {
    const migrations = [createMigration("001", 1704326400000, "SQL1")];

    const status = getMigrationStatus(migrations, []);

    expect(status.current).toBeNull();
    expect(status.appliedCount).toBe(0);
    expect(status.pendingCount).toBe(1);
  });
});

// ============================================================
// Migration Validation Tests
// ============================================================

describe("validateMigrations", () => {
  it("should pass validation for valid migrations", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("002", 1704369600000, "SQL2"),
    ];

    const result = validateMigrations(migrations, []);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("should detect duplicate migration IDs", () => {
    const migrations = [
      createMigration("001", 1704326400000, "SQL1"),
      createMigration("001", 1704369600000, "SQL2"),
    ];

    const result = validateMigrations(migrations, []);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(err => err.includes("Duplicate migration IDs"))
    ).toBe(true);
    expect(result.duplicates).toContain("001");
  });

  it("should detect missing required fields", () => {
    const migrations = [
      {
        id: "",
        name: "",
        timestamp: 0,
        up: "",
      } as Migration,
    ];

    const result = validateMigrations(migrations, []);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should error on modified migrations with strict checksums (default)", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users"
    );
    const originalChecksum = calculateChecksum(migration);

    const modifiedMigration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users_modified"
    );

    const applied = [
      createMigrationRecord("001", new Date(), originalChecksum),
    ];

    const result = validateMigrations([modifiedMigration], applied);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(err =>
        err.includes("Applied migrations have been modified")
      )
    ).toBe(true);
    expect(result.modified).toHaveLength(1);
  });

  it("should warn on modified migrations with strictChecksums: false", () => {
    const migration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users"
    );
    const originalChecksum = calculateChecksum(migration);

    const modifiedMigration = createMigration(
      "001",
      1704326400000,
      "CREATE TABLE users_modified"
    );

    const applied = [
      createMigrationRecord("001", new Date(), originalChecksum),
    ];

    const result = validateMigrations([modifiedMigration], applied, {
      strictChecksums: false,
    });

    expect(result.valid).toBe(true);
    expect(
      result.warnings.some(warn =>
        warn.includes("Applied migrations have been modified")
      )
    ).toBe(true);
    expect(result.modified).toHaveLength(1);
  });

  it("should detect invalid timestamps", () => {
    const migrations = [
      {
        id: "001",
        name: "Test",
        timestamp: "invalid" as unknown as number,
        up: "SQL",
      },
    ];

    const result = validateMigrations(migrations, []);

    expect(result.valid).toBe(false);
    expect(
      result.errors.some(err => err.includes("missing or invalid timestamp"))
    ).toBe(true);
  });
});

// ============================================================
// Migration Helpers Tests (Mocked Adapter)
// ============================================================

describe("migrationHelpers", () => {
  // Mock adapter for testing
  const createMockAdapter = () => {
    const storage = new Map<string, Record<string, unknown>[]>();

    return {
      getCapabilities: () => ({
        dialect: "postgresql" as const,
        supportsJsonb: true,
        supportsJson: true,
        supportsArrays: true,
        supportsGeneratedColumns: true,
        supportsFts: true,
        supportsIlike: true,
        supportsReturning: true,
        supportsSavepoints: true,
        supportsOnConflict: true,
        maxParamsPerQuery: 65535,
        maxIdentifierLength: 63,
      }),
      executeQuery: async (sql: string) => {
        // Mock table creation
        if (sql.includes("CREATE TABLE")) {
          storage.set("nextly_migrations", []);
        }
        return [];
      },
      select: async (table: string) => {
        if (!storage.has(table)) {
          throw new Error(`Table ${table} does not exist`);
        }
        const data = storage.get(table) || [];
        return [...data];
      },
      insert: async (table: string, data: Record<string, unknown>) => {
        const tableData = storage.get(table) || [];
        tableData.push(data);
        storage.set(table, tableData);
      },
      delete: async (table: string, where: { and: { value: unknown }[] }) => {
        const tableData = storage.get(table) || [];
        const filtered = tableData.filter(row => row.id !== where.and[0].value);
        storage.set(table, filtered);
      },
    } as unknown as Parameters<typeof createMigrationsTable>[0];
  };

  describe("createMigrationsTable", () => {
    it("should create migrations table", async () => {
      const adapter = createMockAdapter();

      await migrationHelpers.createMigrationsTable(adapter);

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe("getAppliedMigrations", () => {
    it("should return empty array when no migrations", async () => {
      const adapter = createMockAdapter();
      await migrationHelpers.createMigrationsTable(adapter);

      const applied = await migrationHelpers.getAppliedMigrations(adapter);

      expect(applied).toEqual([]);
    });

    it("should return applied migration records", async () => {
      const adapter = createMockAdapter();
      await migrationHelpers.createMigrationsTable(adapter);

      const migration = createMigration(
        "001",
        1704326400000,
        "CREATE TABLE test"
      );
      await migrationHelpers.recordMigration(adapter, migration);

      const applied = await migrationHelpers.getAppliedMigrations(adapter);

      expect(applied).toHaveLength(1);
      expect(applied[0].id).toBe("001");
      expect(applied[0].checksum).toBeTruthy();
    });
  });

  describe("recordMigration", () => {
    it("should record migration with checksum", async () => {
      const adapter = createMockAdapter();
      await migrationHelpers.createMigrationsTable(adapter);

      const migration = createMigration(
        "001",
        1704326400000,
        "CREATE TABLE test"
      );
      await migrationHelpers.recordMigration(adapter, migration);

      const applied = await migrationHelpers.getAppliedMigrations(adapter);

      expect(applied).toHaveLength(1);
      expect(applied[0].id).toBe("001");
      expect(applied[0].name).toBe("Migration 001");
      expect(applied[0].checksum).toBe(calculateChecksum(migration));
    });
  });

  describe("removeMigrationRecord", () => {
    it("should remove migration record", async () => {
      const adapter = createMockAdapter();
      await migrationHelpers.createMigrationsTable(adapter);

      const migration = createMigration(
        "001",
        1704326400000,
        "CREATE TABLE test"
      );
      await migrationHelpers.recordMigration(adapter, migration);

      let applied = await migrationHelpers.getAppliedMigrations(adapter);
      expect(applied).toHaveLength(1);

      await migrationHelpers.removeMigrationRecord(adapter, "001");

      applied = await migrationHelpers.getAppliedMigrations(adapter);
      expect(applied).toHaveLength(0);
    });
  });

  describe("migrationsTableExists", () => {
    it("should return false when table doesn't exist", async () => {
      const adapter = createMockAdapter();

      const exists = await migrationHelpers.migrationsTableExists(adapter);

      expect(exists).toBe(false);
    });

    it("should return true when table exists", async () => {
      const adapter = createMockAdapter();
      await migrationHelpers.createMigrationsTable(adapter);

      const exists = await migrationHelpers.migrationsTableExists(adapter);

      expect(exists).toBe(true);
    });
  });
});
