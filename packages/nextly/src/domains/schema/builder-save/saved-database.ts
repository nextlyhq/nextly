/**
 * The database a Builder save writes to, as its record that it is in progress names it
 * (`save-in-progress`). Kept apart from the record, with nothing heavier than a hash, so the
 * service registration can name the database without loading the record's machinery.
 *
 * @module domains/schema/builder-save/saved-database
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * What a record names where the database it leads to cannot be told: the app's adapter was handed
 * in, not built from `DATABASE_URL`. A marker of this host naming it refuses, never only notices.
 */
export const UNKNOWN_DATABASE = "unknown";

/**
 * The database `url` reaches, named by a hash of where it is (`databaseLocation`): the same
 * database gives the same name whoever connects to it, and no user name or password goes into it.
 * `url` defaults to `DATABASE_URL`, which the CLI connects with and the app builds its adapter
 * from where none is handed in. `postgresSchema` is `db.postgres.schema`: two installations in
 * two schemas of one PostgreSQL database are two places.
 */
export function databaseIdentity(
  url: string | undefined = process.env.DATABASE_URL,
  postgresSchema?: string
): string {
  return createHash("sha256")
    .update(databaseLocation(url ?? "", postgresSchema))
    .digest("hex")
    .slice(0, 32);
}

/**
 * The database an app's saves write to: `DATABASE_URL`'s, which the app built its adapter from,
 * or unknown where the adapter was handed in and its address is its own.
 */
export function savedDatabase(
  adapterHandedIn: boolean,
  postgresSchema?: string
): string {
  return adapterHandedIn
    ? UNKNOWN_DATABASE
    : databaseIdentity(process.env.DATABASE_URL, postgresSchema);
}

/**
 * Where `url` leads. A SQLite file is opened at the URL with its `file:` prefix stripped, relative
 * to the working directory, so `file:./data/app.db` and `file:/data/app.db` are two files and
 * name two places. A server is its host, port and database name, and on PostgreSQL the schema.
 */
function databaseLocation(url: string, postgresSchema?: string): string {
  if (url.startsWith("file:")) {
    return `file:${resolve(url.slice("file:".length))}`;
  }
  try {
    const parsed = new URL(url);
    // The schema the adapter's search path names; `public`, PostgreSQL's own, where none is set.
    const schema =
      postgresSchema === undefined || postgresSchema === "public"
        ? ""
        : `#${postgresSchema}`;
    return `${parsed.hostname}:${parsed.port}${parsed.pathname}${schema}`;
  } catch {
    // Not a URL: a bare SQLite path, opened as it is.
    return `file:${resolve(url)}`;
  }
}
