/**
 * The default app migrations folder, relative to the project root. A module
 * of its own that imports nothing at run time, so the code Next.js runs while
 * it loads `next.config` (`withNextly`) can find the folder without loading
 * the configuration types' module, whose `DEFAULT_DB_CONFIG` reads it.
 */
export const DEFAULT_MIGRATIONS_DIR = "./src/db/migrations";
