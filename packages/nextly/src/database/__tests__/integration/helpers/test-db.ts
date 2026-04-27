// Per-dialect test DB connection helper for integration tests.
// Why centralized: every integration test needs the same env-var read,
// availability check, and isolation strategy. Putting it here means each
// test file is shorter and the policy lives in one place.

import { randomBytes } from "node:crypto";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

// Why crypto instead of Math.random: real isolation between test files
// running in the same CI job. crypto.randomBytes is collision-free in
// practice for an 8-char hex prefix.
function makeIsolationPrefix(): string {
  return `test_${randomBytes(4).toString("hex")}`;
}

// Reads the canonical env var for the requested dialect.
// Returns null if unset, signaling the test should skip itself.
export function readDialectUrl(dialect: SupportedDialect): string | null {
  const envVarMap: Record<SupportedDialect, string> = {
    postgresql: "TEST_POSTGRES_URL",
    mysql: "TEST_MYSQL_URL",
    sqlite: "TEST_SQLITE_URL",
  };
  return process.env[envVarMap[dialect]] ?? null;
}

// Per-dialect helper: returns a unique identifier prefix this test file
// can stamp onto every table/schema/database it creates, plus the URL
// (or null) and an availability flag.
//
// SQLite is always "available" because it can fall back to in-memory
// even without TEST_SQLITE_URL set.
export function makeTestContext(dialect: SupportedDialect): {
  prefix: string;
  url: string | null;
  available: boolean;
} {
  const url = readDialectUrl(dialect);
  return {
    prefix: makeIsolationPrefix(),
    url,
    available: url != null || dialect === "sqlite",
  };
}
