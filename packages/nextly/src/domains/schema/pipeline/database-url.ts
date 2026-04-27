// Shared helper for extracting the MySQL database name from a
// connection URL. drizzle-kit's MySQL pushSchema requires this name
// as a separate argument (PG and SQLite don't). Per-call factories
// at each call site (reload-config.ts, collection-dispatcher.ts,
// dev-server.ts in PR-3) extract it from process.env.DATABASE_URL
// before invoking PushSchemaPipeline.apply().
//
// F8 will collapse the per-call factory pattern; this helper stays
// useful as long as the pipeline's apply() takes databaseName.

export function extractDatabaseNameFromUrl(
  url: string | undefined
): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    // Pathname is "/dbname" (with the leading slash) for mysql://
    // and postgres:// URLs. Strip the slash.
    const name = parsed.pathname.replace(/^\//, "");
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}
