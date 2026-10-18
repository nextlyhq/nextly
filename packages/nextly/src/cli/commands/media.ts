import path from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { Command } from "commander";

import {
  findOrphanThumbnails,
  mediaPlaceIsExclusive,
  ORPHAN_MIN_AGE_MS,
  removeOrphanThumbnails,
  type OrphanRemoval,
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
import { installRegistryResolver } from "../utils/registry-resolver";

/**
 * Every stored path a media item refers to, read a page of items at a time:
 * the one answer a delete uses for what an item's files are.
 *
 * Paged by id, each page starting after the last id read, not by offset: an
 * item deleted from an earlier page while this reads would move every later
 * item one place up, and a page read by offset would then skip one still
 * there, whose thumbnail would read as left behind.
 */
export async function referencedStoredPaths(
  adapter: Pick<DrizzleAdapter, "select">
): Promise<Set<string>> {
  const referenced = new Set<string>();
  const limit = 500;
  let after: string | undefined;
  for (;;) {
    const rows = await adapter.select<MediaFilesRecord & { id: string }>(
      "media",
      {
        ...(after === undefined
          ? {}
          : { where: { and: [{ column: "id", op: ">", value: after }] } }),
        orderBy: [{ column: "id", direction: "asc" }],
        limit,
      }
    );
    for (const row of rows) {
      for (const path of storedFilesOf(row).paths) referenced.add(path);
    }
    if (rows.length < limit) return referenced;
    after = rows[rows.length - 1].id;
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
  /** Whether media's place in the storage is its own. */
  exclusive: boolean;
  referenced: () => Promise<ReadonlySet<string>>;
  apply: boolean;
  say: (line: string) => void;
  now?: Date;
}): Promise<number> {
  const { storage, say, apply } = options;
  const search = await findOrphanThumbnails(storage, {
    referenced: await options.referenced(),
    prefix: options.prefix,
    exclusive: options.exclusive,
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
  sayUnconfirmed(search.unconfirmed, storage, say);
  if (search.orphans.length === 0) {
    if (search.unconfirmed.length === 0) {
      say("No left-behind thumbnails found.");
    }
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
  sayRemoval(result, say);
  return result.failed.length > 0 ? 1 : 0;
}

/**
 * The unreferenced thumbnails nothing shows are media's, listed for the site
 * to check and left as they are even with --apply: by key, which tells apart
 * files uploaded under one name, and by that name where there is one.
 */
function sayUnconfirmed(
  unconfirmed: ReadonlyArray<{ path: string; name?: string }>,
  storage: IStorageAdapter,
  say: (line: string) => void
): void {
  if (unconfirmed.length === 0) return;
  const why = unconfirmed.some(file => file.name !== undefined)
    ? `The media storage (${storage.getType()}) keeps no folders, so another uploader to it can give a file the same name.`
    : "The media collection has no storage prefix of its own, so another collection or upload can store a file of the same form in the same place. Set a `prefix` for media in its storage config to have later runs remove them.";
  say(
    `${unconfirmed.length} unreferenced thumbnail(s) that nothing shows are media's. ${why} They are left as they are, even with --apply; check each and remove the ones that are media's by hand:`
  );
  for (const { path, name } of unconfirmed) {
    say(name === undefined ? `  ${path}` : `  ${path} (uploaded as ${name})`);
  }
}

/** What --apply did with each listed thumbnail. */
function sayRemoval(result: OrphanRemoval, say: (line: string) => void): void {
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
        // The loader discovers the config from the project; a path is
        // passed only when one was given.
        const { config } = await loadConfig({
          configPath: context.configPath,
          cwd: context.cwd,
        });
        const db = validateDatabaseEnv();
        adapter = await createCliAdapter({
          dialect: db.dialect,
          databaseUrl: db.databaseUrl,
          logger: context.options.verbose ? context.logger : undefined,
        });
        const drizzle = adapter as unknown as DrizzleAdapter;
        installRegistryResolver(drizzle);
        // Local disk is where the app keeps it, `public/uploads` in the
        // project, resolved from --cwd rather than from where this runs.
        const mediaStorage = initializeMediaStorage({
          plugins: config.storage,
          local: { uploadDir: path.resolve(context.cwd, "public/uploads") },
        });
        const storage = mediaStorage.getAdapterForCollection("media");
        const prefix = mediaStorage.getCollectionConfig("media")?.prefix;
        // The prefixes of every other collection with storage configured,
        // whichever storage it uses (mediaPlaceIsExclusive).
        const others = mediaStorage
          .getConfiguredCollections()
          .filter(slug => slug !== "media")
          .map(slug => mediaStorage.getCollectionConfig(slug)?.prefix);
        const code = await mediaOrphans({
          storage,
          prefix,
          exclusive: mediaPlaceIsExclusive(prefix, others),
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
