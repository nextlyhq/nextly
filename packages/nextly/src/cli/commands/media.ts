import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { Command } from "commander";

import {
  findOrphanThumbnails,
  ORPHAN_MIN_AGE_MS,
  removeOrphanThumbnails,
} from "../../domains/media/orphan-thumbnails";
import {
  storedFilesOf,
  type MediaFilesRecord,
} from "../../domains/media/stored-files";
import { initializeMediaStorage } from "../../storage/storage";
import type { IStorageAdapter } from "../../storage/types";
import { createContext } from "../context";
import {
  createCliAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

/**
 * Every stored path a media item refers to, read a page of items at a time:
 * the one answer a delete uses for what an item's files are.
 */
export async function referencedStoredPaths(
  adapter: Pick<DrizzleAdapter, "select">
): Promise<Set<string>> {
  const referenced = new Set<string>();
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const rows = await adapter.select<MediaFilesRecord>("media", {
      limit,
      offset,
    });
    for (const row of rows) {
      for (const path of storedFilesOf(row).paths) referenced.add(path);
    }
    if (rows.length < limit) return referenced;
  }
}

/**
 * Lists the media storage's left-behind upload-time thumbnails and, with
 * `apply`, removes them, naming each one removed and each one not. Says what
 * it did through `say`, and returns the exit code: 0, or 1 when the storage
 * cannot be listed or a removal failed.
 */
export async function mediaOrphans(options: {
  storage: IStorageAdapter;
  prefix?: string;
  referenced: () => Promise<ReadonlySet<string>>;
  apply: boolean;
  say: (line: string) => void;
  now?: Date;
}): Promise<number> {
  const { storage, say, apply } = options;
  const search = await findOrphanThumbnails(storage, {
    referenced: await options.referenced(),
    prefix: options.prefix,
    now: options.now,
  });
  if (!search.listable) {
    say(
      `The media storage (${storage.getType()}) cannot list its files, so it cannot be searched for left-behind thumbnails. Nothing was changed.`
    );
    return 1;
  }
  const hours = ORPHAN_MIN_AGE_MS / 3_600_000;
  if (search.tooRecent > 0) {
    say(
      `${search.tooRecent} unreferenced thumbnail(s) were stored less than ${hours} hour(s) ago, or at a time the storage does not say, and are left: they may belong to an upload still in progress.`
    );
  }
  if (search.orphans.length === 0) {
    say("No left-behind thumbnails found.");
    return 0;
  }
  if (!apply) {
    say(
      `${search.orphans.length} left-behind thumbnail(s), which no media item refers to:`
    );
    for (const path of search.orphans) say(`  ${path}`);
    say("Nothing was changed. Run again with --apply to remove them.");
    return 0;
  }
  const result = await removeOrphanThumbnails(
    storage,
    search.orphans,
    options.referenced
  );
  for (const path of result.removed) say(`Removed ${path}`);
  for (const path of result.kept) {
    say(`Kept ${path}: a media item refers to it now.`);
  }
  for (const { path, reason } of result.failed) {
    say(`Could not remove ${path}: ${reason}`);
  }
  say(
    `${result.removed.length} removed, ${result.kept.length} kept, ${result.failed.length} not removed.`
  );
  return result.failed.length > 0 ? 1 : 0;
}

/**
 * `nextly media orphans [--apply]`: finds, and with --apply removes, the
 * upload-time thumbnails deletes before this release left in the media
 * storage, still publicly served. A dry run by default.
 */
export function createMediaCommand(): Command {
  const media = new Command("media").description(
    "Work with the media library's stored files"
  );
  media
    .command("orphans")
    .description(
      "List upload-time thumbnails no media item refers to; remove them with --apply"
    )
    .option("--apply", "Remove the thumbnails listed", false)
    .action(async (cmdOptions: { apply?: boolean }, cmd: Command) => {
      const context = createContext(cmd.optsWithGlobals());
      let adapter: CLIDatabaseAdapter | null = null;
      try {
        const { config } = await loadConfig({
          configPath: context.configPath ?? "./nextly.config.ts",
        });
        const db = validateDatabaseEnv();
        adapter = await createCliAdapter({
          dialect: db.dialect,
          databaseUrl: db.databaseUrl,
          logger: context.options.verbose ? context.logger : undefined,
        });
        const drizzle = adapter as unknown as DrizzleAdapter;
        const mediaStorage = initializeMediaStorage({
          plugins: config.storage,
        });
        const code = await mediaOrphans({
          storage: mediaStorage.getAdapterForCollection("media"),
          prefix: mediaStorage.getCollectionConfig("media")?.prefix,
          referenced: () => referencedStoredPaths(drizzle),
          apply: cmdOptions.apply === true,
          say: line => console.log(line),
        });
        await adapter.disconnect();
        process.exit(code);
      } catch (error) {
        context.logger.error("Failed to search the media storage");
        console.error(error);
        if (adapter) await adapter.disconnect();
        process.exit(1);
      }
    });
  return media;
}
