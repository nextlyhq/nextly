import { it } from "vitest";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { getDialectTables } from "../database/index";
import { readTeamPeople } from "../domains/users/services/team-people";

it("prints", async () => {
  const t = getDialectTables("sqlite") as any;
  const db = drizzle({ client: new Database(":memory:"), logger: { logQuery: (q: string) => process.stderr.write("SQLX " + q + "\n") } }) as any;
  await readTeamPeople(db, t, { roleSlug: "editor", limit: 5, now: new Date() }).catch(e => process.stderr.write("ERR " + e.message.slice(0, 600) + "\n"));
});
