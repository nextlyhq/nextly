/**
 * The Builder save writer's dependencies for a field group's or a Single's
 * save, kept apart from the writer itself (`entity-save`, `collection-save`):
 * a service decides whether it has a writer at all on every change, and only a
 * save that has one loads the writer, which brings the migration generator and
 * runner with it.
 *
 * @module domains/schema/builder-save/entity-save-deps
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { BuilderSaveSetup, CollectionSaveDeps } from "./collection-save";

/**
 * Whether a Builder save's writer applies its files here: development runs each file and records it
 * applied; elsewhere the deploy's `nextly migrate` does. The one answer every writer's dependencies
 * take (`CollectionSaveDeps.applies`), and the type picker asks of what a save would do.
 */
export function writerAppliesHere(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * The writer's dependencies for a service's save, or undefined where no
 * writer is set up or no adapter is registered: the service then makes its
 * change alone, as before the writer.
 */
export function entitySaveDeps(
  setup: BuilderSaveSetup | undefined,
  adapter: DrizzleAdapter | undefined,
  logger: CollectionSaveDeps["logger"]
): CollectionSaveDeps | undefined {
  if (setup === undefined || adapter === undefined) return undefined;
  return {
    ...setup,
    adapter,
    logger,
    applies: writerAppliesHere(),
  };
}
