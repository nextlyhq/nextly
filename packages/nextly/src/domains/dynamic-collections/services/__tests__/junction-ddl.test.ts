/**
 * `generateJunctionTable()` previously appended a duplicated, orphaned
 * `CONSTRAINT ... UNIQUE(...);` fragment after the closing `);` of the
 * CREATE TABLE statement. The UNIQUE pair constraint belongs inside the
 * CREATE TABLE body only — a bare `CONSTRAINT ... );` fragment is not valid
 * SQL standing on its own, so every junction table migration failed on every
 * dialect (Postgres, MySQL, and SQLite all reject a statement that opens with
 * a bare `CONSTRAINT` keyword).
 *
 * These tests split the generated SQL on the same `--> statement-breakpoint`
 * marker the runtime migration executor uses (see `executeStatements` in
 * seed-builder-entity.ts and the migration runner), so they exercise the
 * exact unit of "one statement" the fix must produce: exactly one CREATE
 * TABLE, two CREATE INDEX statements, and no orphaned CONSTRAINT fragment.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import {
  DynamicCollectionSchemaService,
  type SupportedDialect,
} from "../dynamic-collection-schema-service";

// Raw FieldDefinition m2m shape — mirrors what the Builder stores for a
// manyToMany relationship field (target lives under options.target).
const m2mField = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
} as unknown as FieldDefinition;

/** Split generated SQL the same way the runtime migration executor does. */
function splitStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/** Strip SQL line comments so a leading `-- comment` line doesn't mask a bare CONSTRAINT statement. */
function stripComments(statement: string): string {
  return statement
    .split("\n")
    .filter(line => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

const dialects: SupportedDialect[] = ["sqlite", "postgresql", "mysql"];

describe("DynamicCollectionSchemaService.generateJunctionTable", () => {
  for (const dialect of dialects) {
    describe(`dialect=${dialect}`, () => {
      it("emits exactly one CREATE TABLE statement, two CREATE INDEX statements, and no orphaned CONSTRAINT fragment", () => {
        const service = new DynamicCollectionSchemaService(undefined, dialect);
        const sql = service.generateJunctionTable("dc_posts", m2mField);

        const statements = splitStatements(sql);
        const cleaned = statements.map(stripComments);

        const createTableStatements = cleaned.filter(s =>
          /CREATE TABLE/i.test(s)
        );
        expect(createTableStatements).toHaveLength(1);

        // A bare/orphan CONSTRAINT fragment is one that starts a whole
        // statement with the CONSTRAINT keyword — valid CONSTRAINT clauses
        // only ever appear inside a CREATE TABLE body, never as their own
        // top-level statement.
        const orphanConstraints = cleaned.filter(s => /^CONSTRAINT\b/i.test(s));
        expect(orphanConstraints).toHaveLength(0);

        const createIndexStatements = cleaned.filter(s =>
          /CREATE INDEX/i.test(s)
        );
        expect(createIndexStatements).toHaveLength(2);

        // Every statement must be non-empty and end with a semicolon — a
        // truncated/duplicated fragment would fail this on at least one
        // dialect.
        for (const statement of cleaned) {
          expect(statement.length).toBeGreaterThan(0);
          expect(statement.trim().endsWith(";")).toBe(true);
        }

        // The CREATE TABLE statement itself must be well-formed: it opens
        // with CREATE TABLE and closes with a single `);` — the bug produced
        // a second, invalid `);`-adjacent CONSTRAINT fragment appended after
        // the real close.
        const tableStatement = createTableStatements[0];
        const closingParenCount = (tableStatement.match(/\);/g) || []).length;
        expect(closingParenCount).toBe(1);

        // The UNIQUE pair constraint must still exist, but ONLY inside the
        // CREATE TABLE body (i.e. within the single statement asserted
        // above), not as a separate trailing statement.
        expect(tableStatement).toMatch(/CONSTRAINT[\s\S]*UNIQUE/i);
      });

      it("generateMigrationSQL embeds the same valid junction table for a manyToMany field", () => {
        const service = new DynamicCollectionSchemaService(undefined, dialect);
        const sql = service.generateMigrationSQL("dc_posts", [
          { name: "title", type: "text" } as unknown as FieldDefinition,
          m2mField,
        ]);

        const statements = splitStatements(sql).map(stripComments);

        // Two CREATE TABLE statements total: dc_posts itself, plus the
        // junction table.
        const createTableStatements = statements.filter(s =>
          /CREATE TABLE/i.test(s)
        );
        expect(createTableStatements).toHaveLength(2);

        const orphanConstraints = statements.filter(s =>
          /^CONSTRAINT\b/i.test(s)
        );
        expect(orphanConstraints).toHaveLength(0);
      });
    });
  }
});
