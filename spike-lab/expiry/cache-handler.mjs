// An incremental cache handler whose entries stay in this instance's memory,
// while tag expiries live in a ledger every instance and every writer shares.
// The ledger here is a JSON file standing in for a table in the app's own
// database: { [tag]: expiredAtMs }. An entry is served only while none of its
// tags expired after it was stored, so an expiry recorded by any process (an
// in-request write on another instance, a CLI process with no Next.js) makes
// every instance regenerate it on its next read.
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const LEDGER = process.env.LAB_LEDGER;
const entries = new Map();
// Ledger reads, counted so the cost per request can be measured.
let ledgerReads = 0;

function readLedger() {
  ledgerReads++;
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return {};
  }
}

export function recordExpiry(tags) {
  const ledger = readLedger();
  const now = Date.now();
  for (const tag of tags) ledger[tag] = now;
  const tmp = `${LEDGER}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger));
  renameSync(tmp, LEDGER);
}

/** The tags an entry carries: those it was stored with, and a page's header. */
function tagsOf(stored, ctx) {
  const header = stored?.value?.headers?.["x-next-cache-tags"];
  return [
    ...(stored?.tags ?? []),
    ...(ctx?.tags ?? []),
    ...(ctx?.softTags ?? []),
    ...(typeof header === "string" ? header.split(",") : []),
  ];
}

export default class LedgerCacheHandler {
  constructor() {}

  async get(key, ctx) {
    const stored = entries.get(key);
    if (!stored) return null;
    const ledger = readLedger();
    for (const tag of tagsOf(stored, ctx)) {
      if ((ledger[tag] ?? 0) > stored.lastModified) {
        entries.delete(key);
        return null;
      }
    }
    return { lastModified: stored.lastModified, value: stored.value };
  }

  async set(key, data, ctx) {
    if (data === null) return entries.delete(key);
    entries.set(key, {
      value: data,
      lastModified: Date.now(),
      tags: ctx?.tags ?? [],
    });
  }

  async revalidateTag(tags) {
    recordExpiry(Array.isArray(tags) ? tags : [tags]);
  }

  resetRequestCache() {
    if (process.env.LAB_LOG_LEDGER === "1")
      console.log(`LAB ledger reads so far: ${ledgerReads}`);
  }
}
