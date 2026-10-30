import { readFile } from "node:fs/promises";

import { unstable_cache } from "next/cache";

// LAB_REVALIDATE seconds gives every cached read a lifetime (mechanism a);
// unset, entries live until a tag expires them, as nextly's reads do.
const lifetime = process.env.LAB_REVALIDATE
  ? Number(process.env.LAB_REVALIDATE)
  : false;

export const readItem = unstable_cache(
  async () => {
    const data = JSON.parse(await readFile(process.env.LAB_DATA!, "utf8")) as {
      value: string;
      writtenAt: number;
    };
    return { ...data, readAt: Date.now() };
  },
  ["item"],
  { tags: ["item"], revalidate: lifetime }
);
