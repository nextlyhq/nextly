/**
 * Removing a file's bytes once its entry is deleted.
 *
 * An `afterDelete` hook for every collection, registered once at boot, acts
 * for those whose files are private. It runs after the deletion commits, and
 * never for one that is refused or rolled back, so a file is never lost while
 * its entry stays. It reads both keys from the row as it stood before the
 * deletion (the hook's `data`), so it needs no read of its own, inside the
 * delete's transaction or beside it. Deleting bytes that are not there is not
 * an error, so a pending upload that never received any is deleted as well.
 *
 * Should storage refuse, the keys are queued as a job, which the job runner
 * retries, so a passing storage failure does not leave the bytes behind.
 *
 * Registered from the server's boot rather than by `defineCollection`, whose
 * module graph stays free of storage and Node built-ins.
 *
 * @module domains/files/delete-stored-file
 * @experimental
 */
import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import type { HookRegistry } from "../../hooks/hook-registry";
import type { HookHandler } from "../../hooks/types";
import { getNextlyLogger } from "../../observability";
import { getMediaStorage } from "../../storage/storage";
import { defineJob, type JobDefinition } from "../jobs/job-registry";
import type { JobsRepository } from "../jobs/jobs-repository";

/** The job that deletes a deleted entry's bytes storage refused at first. */
const DELETE_OBJECTS_JOB = "files:delete-objects";

/** What the job is handed: the collection, and the keys to delete. */
type DeleteObjectsInput = { collection: string; keys: string[] };

/** The keys a row names, as the row holds them: its file and its upload. */
function keysOf(row: Record<string, unknown>): string[] {
  const keys = [
    row.storageKey ?? row.storage_key,
    row.uploadKey ?? row.upload_key,
  ].filter((key): key is string => typeof key === "string");
  return [...new Set(keys)];
}

/** Delete `keys` of collection `slug`, each one the collection's own. */
async function deleteKeys(
  slug: string,
  keys: readonly string[]
): Promise<void> {
  const files = getMediaStorage().getPrivateFiles(slug);
  for (const key of keys) {
    if (files.owns(key)) await files.delete(key);
  }
}

/** The hook, handed the row as it stood before it was deleted. */
const deleteStoredFileHook: HookHandler = async context => {
  if (!getMediaStorage().isPrivateCollection(context.collection)) return;
  const row = context.data as Record<string, unknown> | undefined;
  const keys = row ? keysOf(row) : [];
  if (keys.length === 0) return;
  try {
    await deleteKeys(context.collection, keys);
  } catch (error) {
    getNextlyLogger().warn({
      kind: "private-file-delete-deferred",
      collection: context.collection,
      reason: error instanceof Error ? error.name : "unknown",
    });
    const input: DeleteObjectsInput = { collection: context.collection, keys };
    await container.get<JobsRepository>("jobsRepository").enqueue({
      slug: DELETE_OBJECTS_JOB,
      input,
      runAt: null,
      runAsUserId: null,
      dedupeKey: null,
      now: new Date(),
    });
  }
};

/**
 * The job that deletes keys storage refused when their entry was deleted,
 * retried by the runner until storage takes the deletes.
 */
export function createDeleteObjectsJob(): JobDefinition {
  return defineJob({
    slug: DELETE_OBJECTS_JOB,
    handler: async input => {
      const collection = input?.collection;
      const keys = input?.keys;
      if (typeof collection !== "string" || !Array.isArray(keys)) {
        throw NextlyError.invalidInput({
          message: "The private-file delete job was queued without its keys.",
          logContext: { reason: "file-delete-job-input" },
        });
      }
      await deleteKeys(
        collection,
        keys.filter((key): key is string => typeof key === "string")
      );
    },
  });
}

/**
 * Register the hook on `registry`, for every collection, exactly once: any
 * earlier registration of it is taken off first, so a second boot in one
 * process adds no second, and a registry cleared since gets it back. Owned by
 * the app rather than the configuration, so a development reload keeps it:
 * it reads which collections are private when it runs.
 */
export function registerStoredFileDeletion(registry: HookRegistry): void {
  registry.unregister("afterDelete", "*", deleteStoredFileHook);
  registry.register("afterDelete", "*", deleteStoredFileHook);
}
