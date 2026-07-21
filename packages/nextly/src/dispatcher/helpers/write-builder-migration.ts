// Persists the DDL a Schema Builder (UI) save executed, so the change is
// reproducible on a fresh database.
//
// Why this exists: a builder save applies its DDL straight to the live
// database and records a journal row, but the only *file* written for a
// UI-created entity is the `_create_` migration produced when it was first
// generated. Every later field edit therefore existed solely in the registry
// row, so replaying the migrations folder rebuilt the entity without its
// fields. This writes the executed statements next to that create migration.
//
// Applies to all three UI-authorable kinds — collections, singles and
// components — so the migration story is the same whichever one is edited.

import { BUILDER_MIGRATION_MARKER } from "../../domains/schema/migration-markers";

import { getCollectionsHandlerFromDI } from "./di";

/** The UI-authorable entity kinds, used for the migration's header comment. */
export type BuilderEntityKind = "collection" | "single" | "component";

/**
 * Best-effort by design: the DDL has already been applied by the time this
 * runs, so a write failure (read-only or serverless filesystem) must never
 * fail the request.
 */
export async function writeBuilderMigration(
  kind: BuilderEntityKind,
  slug: string,
  statements: string[] | undefined
): Promise<void> {
  if (!statements || statements.length === 0) return;

  const fileManager = getCollectionsHandlerFromDI()?.getFileManager();
  if (!fileManager) return;

  const safeSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const sql = [
    `-- Update dynamic ${kind}: ${slug}`,
    `${BUILDER_MIGRATION_MARKER} (${kind})`,
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
