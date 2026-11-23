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
 * - `<id> save <entryId> <heading>` answers `OK` when the save succeeded.
 *
 * Either answers `REFUSED <code> <message>` for an error a caller is meant to act on, and
 * `ERROR <code> <message>` for any other failure, so the suite tells a refusal from a crash.
 *
 * @module domains/field-groups/__tests__/helpers/content-server-child
 */
import { createInterface } from "node:readline";

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
const { LIVE_COLLECTION, LIVE_DECLARED } = await import("./live-site-entities");

const adapter = await createAdapter({ type: dialect, url } as never);
const instance = await createTestNextly({
  adapter: adapter as never,
  collections: LIVE_DECLARED.collections,
  fieldGroups: LIVE_DECLARED.fieldGroups,
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
  return `${REFUSALS.has(code) ? "REFUSED" : "ERROR"} ${code} ${message}`;
}

async function answer(command: string, args: string[]): Promise<string> {
  if (command === "read") {
    const read = await instance.nextly.findByID({
      collection: LIVE_COLLECTION as never,
      id: args[0]!,
    });
    const item = (read as { item?: { card?: unknown } }).item ?? read;
    return `OK ${JSON.stringify((item as { card?: unknown }).card ?? null)}`;
  }
  if (command === "save") {
    await instance.nextly.update({
      collection: LIVE_COLLECTION as never,
      id: args[0]!,
      // Last write wins: a server saving what its form holds, as the suite asks it to.
      data: { card: { heading: args[1] }, _overwrite: true } as never,
    });
    return "OK";
  }
  return `ERROR UNKNOWN_COMMAND ${command}`;
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
