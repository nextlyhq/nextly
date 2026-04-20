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
  schema: "./src/services/lib/unified-schema.ts",
  out: `./src/database/migrations/${selectedDialect}`,
  dialect: selectedDialect,
  dbCredentials: { url: databaseUrl },
  ...(selectedDialect !== "sqlite" && { casing: "snake_case" as const }),
});
