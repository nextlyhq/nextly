/**
 * Removing a file's bytes when its entry is deleted.
 *
 * A `beforeDelete` hook for every collection, registered once at boot, that
 * acts only for those whose files are private. It runs after the delete's
 * access check and before the entry is removed, so the key is still known:
 * deleting the entry first would leave its bytes in storage with nothing
 * pointing at them. Deleting bytes that are not there is not an error, so a
 * pending upload that never received any is deleted as well.
 *
 * Registered from the server's boot rather than by `defineCollection`, whose
 * module graph stays free of storage and Node built-ins.
 *
 * @module domains/files/delete-stored-file
 * @experimental
 */
import { container } from "../../di/container";
import type { HookRegistry } from "../../hooks/hook-registry";
import type { HookHandler } from "../../hooks/types";
import type { CollectionsHandler } from "../../services/collections-handler";
import { getMediaStorage } from "../../storage/storage";

/** Delete the stored bytes of entry `id` of the collection `slug`, if any. */
async function deleteStoredFile(slug: string, id: string): Promise<void> {
  const storage = getMediaStorage();
  if (!storage.isPrivateCollection(slug)) return;
  // The key read as trusted code: field rules withhold it from every caller,
  // the one deleting the entry included.
  const found = await container
    .get<CollectionsHandler>("collectionsHandler")
    .getEntry({
      collectionName: slug,
      entryId: id,
      overrideAccess: true,
      depth: 0,
    });
  const key = found.success
    ? (found.data as { storageKey?: unknown } | null)?.storageKey
    : undefined;
  if (typeof key !== "string") return;
  const files = storage.getPrivateFiles(slug);
  if (files.owns(key)) await files.delete(key);
}

/** The hook, handed the entry about to be deleted. */
const deleteStoredFileHook: HookHandler = async context => {
  const id = (context.data as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" && typeof id !== "number") return;
  await deleteStoredFile(context.collection, String(id));
};

/**
 * Register the hook on `registry`, for every collection, exactly once: any
 * earlier registration of it is taken off first, so a second boot in one
 * process adds no second, and a registry cleared since gets it back. Owned by
 * the app rather than the configuration, so a development reload keeps it:
 * it reads which collections are private when it runs.
 */
export function registerStoredFileDeletion(registry: HookRegistry): void {
  registry.unregister("beforeDelete", "*", deleteStoredFileHook);
  registry.register("beforeDelete", "*", deleteStoredFileHook);
}
