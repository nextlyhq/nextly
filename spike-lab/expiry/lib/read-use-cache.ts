import { readFile } from "node:fs/promises";

import { cacheTag } from "next/cache";

// The same read under `use cache`, whose entries go through `cacheHandlers`
// rather than the incremental cache.
export async function readItemUseCache() {
  "use cache";
  cacheTag("item");
  const data = JSON.parse(await readFile(process.env.LAB_DATA!, "utf8")) as {
    value: string;
  };
  return { ...data, readAt: Date.now() };
}
