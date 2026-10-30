// A `cacheHandlers` handler for `use cache`: entries in this instance's memory,
// tag expiries in the same shared ledger as cache-handler.mjs.
import { readFileSync } from "node:fs";

import { recordExpiry } from "./cache-handler.mjs";

const entries = new Map();

function ledger() {
  try {
    return JSON.parse(readFileSync(process.env.LAB_LEDGER, "utf8"));
  } catch {
    return {};
  }
}

const expiredAfter = (tags, timestamp) => {
  const l = ledger();
  return tags.some(tag => (l[tag] ?? 0) > timestamp);
};

export default {
  async get(cacheKey, softTags) {
    const stored = entries.get(cacheKey);
    if (!stored) return undefined;
    if (
      expiredAfter([...stored.entry.tags, ...softTags], stored.entry.timestamp)
    ) {
      entries.delete(cacheKey);
      return undefined;
    }
    const chunks = stored.chunks;
    return {
      ...stored.entry,
      value: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    };
  },
  async set(cacheKey, pendingEntry) {
    const entry = await pendingEntry;
    const chunks = [];
    const reader = entry.value.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    entries.set(cacheKey, { entry: { ...entry, value: undefined }, chunks });
  },
  async refreshTags() {},
  async getExpiration(tags) {
    const l = ledger();
    return Math.max(0, ...tags.map(tag => l[tag] ?? 0));
  },
  async updateTags(tags) {
    recordExpiry(tags);
  },
};
