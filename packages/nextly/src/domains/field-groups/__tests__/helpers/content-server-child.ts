/**
 * A server that started before the field-group storage migration and never restarts: booted on
 * the site's database in a process of its own, so nothing the migrating process resolves or
 * forgets about storage names reaches it, as nothing reaches a real server.
 *
 * Usage: `content-server-child.ts <dialect> <url> <per-language storage: on|off>`. The layout is
 * the suite's own (`perLanguageStorageEnabled`), since a site serves one layout and a server process
 * reads it at start as the suite's process did. It prints `READY` once booted, then answers
 * one request per line on stdin, each `<id> <command> [args]`, with one line `<id> <answer>`:
 *
 * - `<id> read <entryId>` answers `OK <json>`: the entry's field-group value as a read returns it.
 * - `<id> save <entryId> <heading>` answers `OK` when the save succeeded, the heading saved as
 *   the group's translated tagline too.
 * - `<id> list [<field> <value>]` answers `OK <json>`: the group of each entry, or of those whose
 *   group holds that value.
 * - `<id> duplicate <entryId>` answers `OK <new entryId>`.
 * - `<id> plugin-save <entryId> <heading>` and `plugin-tx-save` save through a plugin's context;
 *   `plugin-tx-save-unwarmed` does so without warming the collection's readiness first.
 * - `<id> read-single-all` answers the Single's group and every language's values beside it.
 * - `<id> read-single` and `<id> save-single <heading>` do the same for the Single.
 *
 * Either answers `REFUSED <code> <message>` for an error a caller is meant to act on, and
 * `ERROR <code> <message>` for any other failure, so the suite tells a refusal from a crash.
 *
 * @module domains/field-groups/__tests__/helpers/content-server-child
 */
import { createInterface } from "node:readline";

import type { CollectionService } from "../../../collections/services/collection-service";

const [dialect, url, layout] = process.argv.slice(2) as [
  "sqlite" | "postgresql" | "mysql",
  string,
  "on" | "off",
];

// A server's environment, set before nextly loads, so nothing it reads at load sees the suite's.
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DB_DIALECT = dialect;
if (dialect !== "sqlite") process.env.DATABASE_URL = url;

const { createAdapter } = await import("../../../../database/factory");
const { setPerLanguageStorage } = await import(
  "../../../i18n/per-language-storage"
);
setPerLanguageStorage(layout === "on");
const { createTestNextly } = await import("../../../../plugins/test-nextly");
const { LIVE_COLLECTION, LIVE_DECLARED, LIVE_LOCALIZATION, LIVE_SINGLE } =
  await import("./live-site-entities");

const { definePlugin } = await import("../../../../plugins/plugin-context");

// A plugin of the server's, which writes through its own context as an importer does: one save that
// opens its own transaction, and one on a transaction the plugin opened.
type PluginCollections = Pick<
  CollectionService,
  | "updateEntry"
  | "updateEntryInTransaction"
  | "warmLocalizedReadiness"
  | "withTransaction"
>;
let pluginCollections: PluginCollections | undefined;
const plugin = definePlugin({
  name: "@test/content-server-child",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    pluginCollections = ctx.services
      .collections as unknown as PluginCollections;
  },
});

const adapter = await createAdapter({ type: dialect, url } as never);
const instance = await createTestNextly({
  adapter: adapter as never,
  plugins: [plugin],
  collections: LIVE_DECLARED.collections,
  singles: LIVE_DECLARED.singles,
  fieldGroups: LIVE_DECLARED.fieldGroups,
  localization: LIVE_LOCALIZATION,
});

/** The refusals a caller is told to act on: retry, or restart. */
const REFUSALS = new Set([
  "FIELD_GROUP_STORAGE_MOVING",
  "FIELD_GROUP_MIGRATION_IN_FLIGHT",
]);

function describeError(error: unknown): string {
  const e = error as {
    code?: unknown;
    publicData?: { errors?: { code?: unknown }[] };
    message?: unknown;
  };
  const code = String(e.publicData?.errors?.[0]?.code ?? e.code ?? "UNKNOWN");
  const message = String(e.message ?? error).replace(/\s+/g, " ");
  if (REFUSALS.has(code)) return `REFUSED ${code} ${message}`;
  return `ERROR ${code} ${message} | ${detailOf(error)}`;
}

/**
 * An unexpected error's detail beyond its public message, on one line, so a failing suite shows
 * where it came from: its log message, its reason, its cause and the first frames of its stack.
 */
function detailOf(error: unknown): string {
  const detail = error as {
    logMessage?: unknown;
    logContext?: { reason?: unknown };
    cause?: { message?: unknown };
    stack?: unknown;
  };
  const where = String(detail.stack ?? "")
    .split(/\r?\n/)
    .slice(1, 6)
    .map(line => line.trim())
    .join(" < ");
  return [
    detail.logMessage,
    detail.logContext?.reason,
    detail.cause?.message,
    where,
  ]
    .map(part => String(part ?? "").replace(/\s+/g, " "))
    .join(" | ");
}

/** What a save of `heading` carries: the group's heading, and its translated tagline too. */
const saved = (heading: string | undefined) => ({
  card: { heading, tagline: heading },
  // Last write wins: a server saving what its form holds, as the suite asks it to.
  _overwrite: true,
});

/** The Single as a read of it returns it. */
const readSingle = async (translations?: "all") =>
  (await instance.nextly.findSingle({
    slug: LIVE_SINGLE as never,
    ...(translations === undefined ? {} : { translations }),
  })) as { card?: unknown; _allLocales?: unknown };

/** A plugin's save on a transaction it opens, its readiness warmed first or not. */
async function pluginSaveInTransaction(
  warm: boolean,
  [id, heading]: string[]
): Promise<string> {
  const collections = pluginCollections!;
  // Before the transaction, as a write on one of the plugin's own needs: what it warms can only be
  // read inside one, never resolved.
  if (warm) await collections.warmLocalizedReadiness(LIVE_COLLECTION);
  await collections.withTransaction(tx =>
    collections.updateEntryInTransaction(
      tx,
      LIVE_COLLECTION,
      id!,
      saved(heading),
      {}
    )
  );
  return "OK";
}

const COMMANDS: Record<string, (args: string[]) => Promise<string>> = {
  read: async ([id]) => {
    const read = await instance.nextly.findByID({
      collection: LIVE_COLLECTION as never,
      id: id!,
    });
    const item = (read as { item?: { card?: unknown } }).item ?? read;
    return `OK ${JSON.stringify((item as { card?: unknown }).card ?? null)}`;
  },
  save: async ([id, heading]) => {
    await instance.nextly.update({
      collection: LIVE_COLLECTION as never,
      id: id!,
      data: saved(heading) as never,
    });
    return "OK";
  },
  // Every entry, or those whose group's field is as given: the group of each, in the order listed.
  list: async ([field, value]) => {
    const found = await instance.nextly.find({
      collection: LIVE_COLLECTION as never,
      ...(field === undefined
        ? {}
        : { where: { [`card.${field}`]: { equals: value } } as never }),
    });
    return `OK ${JSON.stringify(
      found.items.map(item => (item as { card?: unknown }).card ?? null)
    )}`;
  },
  duplicate: async ([id]) => {
    const copied = await instance.nextly.duplicate({
      collection: LIVE_COLLECTION as never,
      id: id!,
    });
    return `OK ${String(copied.item.id)}`;
  },
  "plugin-save": async ([id, heading]) => {
    await pluginCollections!.updateEntry(
      LIVE_COLLECTION,
      id!,
      saved(heading),
      {}
    );
    return "OK";
  },
  "plugin-tx-save": args => pluginSaveInTransaction(true, args),
  "plugin-tx-save-unwarmed": args => pluginSaveInTransaction(false, args),
  "read-single": async () =>
    `OK ${JSON.stringify((await readSingle()).card ?? null)}`,
  "read-single-all": async () => {
    const read = await readSingle("all");
    return `OK ${JSON.stringify({ card: read.card, all: read._allLocales })}`;
  },
  "save-single": async ([heading]) => {
    await instance.nextly.updateSingle({
      slug: LIVE_SINGLE as never,
      data: saved(heading) as never,
    });
    return "OK";
  },
};

async function answer(command: string, args: string[]): Promise<string> {
  const run = COMMANDS[command];
  return run === undefined ? `ERROR UNKNOWN_COMMAND ${command}` : run(args);
}

console.log("READY");
for await (const line of createInterface({ input: process.stdin })) {
  const [id, command, ...args] = line.trim().split(" ");
  if (!id || !command) continue;
  let reply: string;
  try {
    reply = await answer(command, args);
  } catch (error) {
    reply = describeError(error);
  }
  console.log(`${id} ${reply}`);
}
await instance.destroy().catch(() => {});
