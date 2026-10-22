/**
 * Rename a collection or Single: its registry row and everything keyed by its
 * slug, in one transaction, and then the in-process state that answers by
 * slug.
 *
 * The one path both registries rename through, so the collection and the
 * Single rename cannot come to move different things or to forget a cache.
 *
 * @module domains/entity-rename/rename-entity
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";

import { getDialectTables } from "../../database/index";
import { container } from "../../di";
import { writingPermissions } from "../../services/lib/permissions";
import type { WebhookEndpointRegistry } from "../webhooks/endpoint-registry";
import {
  clearWebhookRecording,
  isWebhookRecordingEnabled,
  setWebhookRecording,
} from "../webhooks/recording-policy";

import {
  moveEntitySlug,
  slugKeyedTablesPresent,
  type EntitySlugMove,
} from "./move-entity-slug";

/**
 * Write the registry row with `writeRegistry` and move every declared table
 * to the new slug, on one transaction. `writeRegistry` answers null when no
 * row held the old slug; nothing is moved then, and null is returned.
 *
 * The transaction runs inside the permissions gate, because it moves the
 * entity's permission rows: every cached answer about who may do what is
 * retired once it has finished, committed or not, as for any permission
 * write. After a commit, the cached list of webhook endpoints is dropped, so
 * the next delivery reads the filters the rename rewrote, and so is a renamed
 * collection's cached schema under either slug.
 */
export async function renameEntity<T>(
  adapter: DrizzleAdapter,
  input: {
    dialect: SupportedDialect;
    move: EntitySlugMove;
    writeRegistry: (tx: TransactionContext) => Promise<T | null>;
  }
): Promise<T | null> {
  const { dialect, move, writeRegistry } = input;
  const present = await slugKeyedTablesPresent(adapter);
  const written = await writingPermissions(
    getDialectTables(dialect).permissions,
    () =>
      adapter.transaction(async tx => {
        const row = await writeRegistry(tx);
        if (row === null) return null;
        await moveEntitySlug(tx, { dialect, present, move });
        return row;
      })
  );
  if (written !== null && container.has("webhookEndpointRegistry")) {
    container
      .get<WebhookEndpointRegistry>("webhookEndpointRegistry")
      .invalidate();
  }
  if (written !== null && move.kind === "collection") {
    dropCachedSchemas(move);
  }
  return written;
}

/**
 * Drop a renamed collection's cached Drizzle table under both slugs, in each
 * cache that holds one: the collection service's, and the content handler's,
 * which the entry reads and writes use. The old slug's entry still points at
 * the renamed collection's table, so a collection later created under that
 * slug would read and write it; the new slug's is rebuilt from the moved
 * registry row on its next read.
 */
function dropCachedSchemas(move: EntitySlugMove): void {
  if (container.has("collectionService")) {
    const service = container.get<{
      invalidateSchemaForSlug(slug: string): void;
    }>("collectionService");
    service.invalidateSchemaForSlug(move.from);
    service.invalidateSchemaForSlug(move.to);
  }
  if (container.has("collectionsHandler")) {
    const handler = container.get<{
      invalidateCollectionSchema(slug: string): void;
    }>("collectionsHandler");
    handler.invalidateCollectionSchema(move.from);
    handler.invalidateCollectionSchema(move.to);
  }
}

/**
 * Carry a Builder entity's webhook recording decision from its old slug to its
 * new one in this process. The decision is the one this process already holds
 * for the old slug (recording, when it holds none), so nothing is read or
 * parsed a second way; the old slug's entry is then dropped, so an entity
 * later created there starts from the default.
 */
export function moveWebhookRecording(move: EntitySlugMove): void {
  const record = isWebhookRecordingEnabled(move.kind, move.from);
  clearWebhookRecording(move.kind, move.from);
  setWebhookRecording(move.kind, move.to, record, "db");
}
