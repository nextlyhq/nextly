import { defineConfig } from "drizzle-kit";
import "./src/scripts/load-env";

const selectedDialect = (process.env.DB_DIALECT || "postgresql") as
  | "postgresql"
  | "mysql"
  | "sqlite";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set in the environment variables");
}

export default defineConfig({
  // Per Plan A Task 18: the prior schema entry point at
  // `src/services/lib/unified-schema.ts` was deleted and moved to
  // `src/schemas/_internal/drizzle-kit-entry.ts` alongside the dialect
  // bundles it consumes. Same shape; same dialect-pick-at-load-time
  // behavior; same drizzle-kit-visible top-level exports.
  schema: "./src/schemas/_internal/drizzle-kit-entry.ts",
  out: `./src/database/migrations/${selectedDialect}`,
  dialect: selectedDialect,
  dbCredentials: { url: databaseUrl },
  ...(selectedDialect !== "sqlite" && { casing: "snake_case" as const }),
});
