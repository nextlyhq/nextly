// Persists the DDL a Schema Builder (UI) save executed, so the change is
// reproducible on a fresh database.
//
// Why this exists: a builder save applies its DDL straight to the live
// database and records a journal row, but the only *file* written for a
// UI-created collection is the `_create_` migration produced when the
// collection was first generated. Every later field edit therefore existed
// solely in the registry row, so replaying the migrations folder rebuilt the
// collection without its fields. This writes the executed statements next to
// that create migration.

import { getCollectionsHandlerFromDI } from "./di";

/**
 * Best-effort by design: the DDL has already been applied by the time this
 * runs, so a write failure (read-only or serverless filesystem) must never
 * fail the request.
 */
export async function writeBuilderMigration(
  slug: string,
  statements: string[] | undefined
): Promise<void> {
  if (!statements || statements.length === 0) return;

  const fileManager = getCollectionsHandlerFromDI()?.getFileManager();
  if (!fileManager) return;

  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const sql = [
    `-- Update dynamic collection: ${slug}`,
    statements.join("\n--> statement-breakpoint\n"),
  ].join("\n");

  try {
    await fileManager.saveMigration(
      sql,
      `${Date.now()}_update_${safeSlug}.sql`
    );
  } catch {
    // Non-fatal: the DDL already ran against the database.
  }
}
