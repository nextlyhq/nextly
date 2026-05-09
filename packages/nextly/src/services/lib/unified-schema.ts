import * as mysqlSchemas from "@nextly/database/schema/mysql";
import * as postgresSchemas from "@nextly/database/schema/postgres";
import * as sqliteSchemas from "@nextly/database/schema/sqlite";
import * as mergedSchemas from "@nextly/scripts/merge-schemas";

const dialect = process.env.DB_DIALECT || "postgresql";
console.log("🧩 Using dialect:", dialect);

let activeSchemas: Record<string, unknown> = {};

switch (dialect) {
  case "postgres":
  case "postgresql":
    activeSchemas = postgresSchemas;
    break;
  case "mysql":
    activeSchemas = mysqlSchemas;
    break;
  case "sqlite":
  case "sqlite3":
    activeSchemas = sqliteSchemas;
    break;
  default:
    console.warn(`⚠️ Unknown dialect '${dialect}', defaulting to Postgres`);
    activeSchemas = postgresSchemas;
}

const unifiedSchemas = {
  ...activeSchemas,
  ...mergedSchemas,
};

for (const [key, value] of Object.entries(unifiedSchemas)) {
  (exports as Record<string, unknown>)[key] = value;
}
