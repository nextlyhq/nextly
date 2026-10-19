import { existsSync } from "node:fs";
import path from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { Command } from "commander";
import { config as loadEnvFile } from "dotenv";

import {
  collectionsSharingMediaPlace,
  findOrphanThumbnails,
  mediaPlaceIsExclusive,
  type MediaReferences,
  ORPHAN_MIN_AGE_MS,
  removeOrphanThumbnails,
  type OrphanRemoval,
} from "../../domains/media/orphan-thumbnails";
import {
  storedFilesOf,
  type MediaFilesRecord,
} from "../../domains/media/stored-files";
import {
  initializeMediaStorage,
  type MediaStorage,
} from "../../storage/storage";
import type { IStorageAdapter } from "../../storage/types";
import { createContext } from "../context";
import {
  createCliAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";
import type { Logger } from "../utils/logger";
import { installRegistryResolver } from "../utils/registry-resolver";

export type { MediaReferences };

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
): Promise<MediaReferences> {
  const referenced = new Set<string>();
  const unlocated: string[] = [];
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
      const files = storedFilesOf(row);
      for (const path of files.paths) referenced.add(path);
      unlocated.push(...files.unlocated);
    }
    if (rows.length < limit) return { paths: referenced, unlocated };
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
  /** The collections that keep media's place from being its own. */
  sharedWith?: readonly string[];
  referenced: () => Promise<MediaReferences>;
  apply: boolean;
  say: (line: string) => void;
  now?: Date;
}): Promise<number> {
  const { storage, say, apply } = options;
  // Before the media table is read: a storage that cannot list its files
  // cannot be searched, however its records read.
  if (!storage.list) return sayUnlistable(storage, say);
  const references = await options.referenced();
  // A thumbnail in use that no path here can match may be any listed file,
  // so where there is one nothing is removed: the matches are listed.
  const unlocated = references.unlocated.length;
  const search = await findOrphanThumbnails(storage, {
    referenced: references.paths,
    prefix: options.prefix,
    exclusive: options.exclusive && unlocated === 0,
    now: options.now,
  });
  if (!search.listable) return sayUnlistable(storage, say);
  const hours = ORPHAN_MIN_AGE_MS / 3_600_000;
  if (search.tooRecent > 0) {
    say(
      `${search.tooRecent} unreferenced thumbnail(s) were stored less than ${hours} hour(s) ago, or at a time the storage does not say, and are left: they may belong to an upload still in progress.`
    );
  }
  sayUnconfirmed(search.unconfirmed, {
    storage,
    unlocated,
    sharedWith: options.sharedWith ?? [],
    say,
  });
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
    say(
      "Nothing was changed. Check each and remove them by hand: removal by this command follows in a later release."
    );
    return 0;
  }
  const result = await removeOrphanThumbnails(
    storage,
    search.orphans,
    options.referenced
  );
  sayRemoval(result, say);
  return result.failed.length > 0 || result.stopped.length > 0 ? 1 : 0;
}

/** Says the storage cannot be searched, and answers the exit code, 1. */
function sayUnlistable(
  storage: IStorageAdapter,
  say: (line: string) => void
): number {
  say(
    `The media storage (${storage.getType()}) cannot list its files, so it cannot be searched for left-behind thumbnails. Nothing was changed.`
  );
  return 1;
}

/**
 * The unreferenced thumbnails nothing shows are media's, listed for the site
 * to check: by key, which tells apart
 * files uploaded under one name, and by that name where there is one.
 */
function sayUnconfirmed(
  unconfirmed: ReadonlyArray<{ path: string; name?: string }>,
  context: UnconfirmedContext
): void {
  if (unconfirmed.length === 0) return;
  const named = unconfirmed.some(file => file.name !== undefined);
  context.say(
    `${unconfirmed.length} unreferenced thumbnail(s) that nothing shows are media's. ${whyUnconfirmed(named, context)} Check each, and remove the ones that are media's by hand:`
  );
  for (const { path, name } of unconfirmed) {
    context.say(
      name === undefined ? `  ${path}` : `  ${path} (uploaded as ${name})`
    );
  }
}

interface UnconfirmedContext {
  storage: IStorageAdapter;
  /** How many thumbnails in use have no stored location the record shows. */
  unlocated: number;
  /** The collections that keep media's place from being its own. */
  sharedWith: readonly string[];
  say: (line: string) => void;
}

/** Why the listed files are not shown to be media's, and what would. */
function whyUnconfirmed(
  named: boolean,
  { storage, unlocated, sharedWith }: UnconfirmedContext
): string {
  if (named) {
    return `The media storage (${storage.getType()}) keeps no folders, so another uploader to it can give a file the same name.`;
  }
  if (unlocated > 0) {
    return `${unlocated} media item(s) have a thumbnail whose stored location cannot be worked out from the record, so any of these may be one still in use.`;
  }
  if (sharedWith.length > 0) {
    const one = sharedWith.length === 1;
    return `Media's storage place is not its own: ${sharedWith.join(", ")} also use${one ? "s" : ""} it, or ha${one ? "s" : "ve"} no prefix, so a file of the same form there may not be media's. Give each of them a \`prefix\` of its own in the storage config, so that media's files can be told apart.`;
  }
  return "The media collection has no storage prefix of its own, so another collection or upload can store a file of the same form in the same place. Set a `prefix` for media in its storage config, so that its files can be told apart.";
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
  if (result.stopped.length > 0) {
    say(
      `Stopped before ${result.stopped.length} file(s): a media item now has a thumbnail whose stored location cannot be worked out from the record, so any of them may be one in use. They are left as they are; run again to list them.`
    );
  }
  say(
    `${result.removed.length} removed, ${result.kept.length} kept, ${result.failed.length} not removed.`
  );
}

/**
 * Makes the project --cwd names the process's directory, and reports whether
 * the command may go on. From inside the project: a storage factory in the
 * config, such as a local-disk plugin given a relative path, resolves that
 * path when the config loads, against the process's directory.
 *
 * The CLI read `.env` from where it was run, before --cwd, and a database
 * named there may be another project's: a file in use in this project's
 * storage would read as left behind against it. So with another `.env` there
 * --apply is refused, and a listing warns; the project's own `.env` sets what
 * nothing has set yet.
 */
function enterProject(cwd: string, apply: boolean, logger: Logger): boolean {
  const ranIn = process.cwd();
  if (cwd !== ranIn) {
    const loaded = path.join(ranIn, ".env");
    if (existsSync(loaded)) {
      const warning = `The environment was read from ${loaded}, not from ${cwd}, so the database it names may be another project's.`;
      if (apply) {
        logger.error(
          `${warning} Nothing was changed. Run the command from ${cwd} to remove files.`
        );
        return false;
      }
      logger.warn(warning);
    }
    const projectEnv = path.join(cwd, ".env");
    if (existsSync(projectEnv)) loadEnvFile({ path: projectEnv });
  }
  process.chdir(cwd);
  return true;
}

/**
 * Every other collection that uploads to storage, by its prefix, whichever
 * storage it uses (mediaPlaceIsExclusive).
 */
function otherUploaders(
  mediaStorage: MediaStorage
): Array<{ slug: string; prefix?: string }> {
  const others: Array<{ slug: string; prefix?: string }> = mediaStorage
    .getConfiguredCollections()
    .filter(slug => slug !== "media")
    .map(slug => ({
      slug,
      prefix: mediaStorage.getCollectionConfig(slug)?.prefix,
    }));
  // A collection with no storage plugin uploads to local disk through the
  // fallback, at the root of its folder. Where media is on a local disk
  // plugin, nothing shows that folder is not the same one.
  const media = mediaStorage.getAdapterForCollection("media");
  if (
    media !== mediaStorage.getDefaultAdapter() &&
    media.getType() === "local"
  ) {
    others.push({ slug: "collections with no storage plugin" });
  }
  return others;
}

/**
 * `nextly media orphans`: lists the upload-time thumbnails deletes before
 * this release left in the media storage, still publicly served, for the
 * site to remove by hand. Changes nothing; `--apply` is refused until
 * removal is offered.
 */
export function createMediaCommand(): Command {
  const media = new Command("media").description(
    "Work with the media library's stored files"
  );
  media
    .command("orphans")
    .description("List upload-time thumbnails no media item refers to")
    .option(
      "--apply",
      "Not available yet: removal follows in a later release",
      false
    )
    .action(async (cmdOptions: { apply?: boolean }, cmd: Command) => {
      const context = createContext(cmd.optsWithGlobals());
      // Removal is not offered yet: the command lists, changing nothing,
      // and the site removes what it lists by hand. Refused before anything
      // is read or connected.
      if (cmdOptions.apply === true) {
        context.logger.error(
          "Removal is not available yet: run `nextly media orphans` to list the left-behind thumbnails, and remove them by hand."
        );
        process.exit(1);
        return;
      }
      let adapter: CLIDatabaseAdapter | null = null;
      try {
        // Resolved once, from where the command was run: a relative --cwd
        // read again after the change would name a folder inside itself.
        const cwd = path.resolve(context.cwd);
        if (!enterProject(cwd, false, context.logger)) {
          process.exit(1);
          return;
        }
        // The loader discovers the config from the project; a path is
        // passed only when one was given.
        const { config } = await loadConfig({
          configPath: context.configPath,
          cwd,
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
          local: { uploadDir: path.resolve(cwd, "public/uploads") },
        });
        const storage = mediaStorage.getAdapterForCollection("media");
        const prefix = mediaStorage.getCollectionConfig("media")?.prefix;
        const others = otherUploaders(mediaStorage);
        const code = await mediaOrphans({
          storage,
          prefix,
          exclusive: mediaPlaceIsExclusive(
            prefix,
            others.map(other => other.prefix)
          ),
          sharedWith: collectionsSharingMediaPlace(prefix, others),
          referenced: () => referencedStoredPaths(drizzle),
          apply: false,
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
