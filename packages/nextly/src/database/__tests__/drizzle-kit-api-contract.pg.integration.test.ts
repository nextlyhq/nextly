// PostgreSQL variant of the drizzle-kit v1 payload API contract test.
// Lives in an *.integration.test.ts file (review-driven): it executes live
// DDL against TEST_POSTGRES_URL, so it must only run under the integration
// configuration (forks, single-fork, sequential) — never in the plain unit
// pass just because the env var happens to be set.

import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { pgTable, serial, text as pgText } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { describe, it, expect } from "vitest";

import { getPgDrizzleKit } from "../drizzle-kit-lazy";

// PG variant — runs only when a test database is configured (docker matrix in
// CI, `docker compose -f docker-compose.test.yml up -d` locally). Covers the
// dialect where pushSchema takes a real drizzle instance plus the named
// entities filter — surface the SQLite test cannot reach.
describe.skipIf(!process.env.TEST_POSTGRES_URL)(
  "drizzle-kit v1 payload API contract (PostgreSQL)",
  () => {
    const contractSamplePg = pgTable("contract_sample_pg", {
      id: serial("id").primaryKey(),
      title: pgText("title"),
    });

    it("pushSchema accepts a NodePgDatabase + entitiesConfig and returns the v1 contract", async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_POSTGRES_URL,
      });
      const db = drizzlePg({ client: pool });
      const kit = await getPgDrizzleKit();

      try {
        await pool.query('DROP TABLE IF EXISTS "contract_sample_pg"');
        const result = await kit.pushSchema(
          { contract_sample_pg: contractSamplePg },
          db,
          { schemas: ["public"], tables: ["contract_sample_pg"] }
        );

        expect(Array.isArray(result.sqlStatements)).toBe(true);
        expect(Array.isArray(result.hints)).toBe(true);
        expect(typeof result.apply).toBe("function");
        expect(result).not.toHaveProperty("statementsToExecute");
        const joined = result.sqlStatements.join("\n").toLowerCase();
        expect(joined).toContain("create table");
        expect(joined).toContain("contract_sample_pg");
      } finally {
        await pool.query('DROP TABLE IF EXISTS "contract_sample_pg"');
        await pool.end();
      }
    });
  }
);
