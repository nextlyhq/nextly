/**
 * The blog template's Cache Components read function, as an app runs it: the
 * lifetime it gives each read, the tags, the key, and its registration. The
 * file is copied into a temporary directory, its `next/cache` and
 * `nextly/runtime` imports pointed at stand-ins that record what they are
 * called with.
 *
 * The guide prints the same function for apps made before it shipped, so the
 * last case holds the guide's copy to the template's.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEMPLATE = join(
  __dirname,
  "../../../../templates/blog/src/nextly/cached-read.ts"
);
const GUIDE = join(__dirname, "../../../../docs/guides/isr-caching.mdx");
/** nextly's read path, which gives a read its handlers don't serve its revalidate. */
const CACHED_FIND = join(
  __dirname,
  "../../../nextly/src/runtime/cache/cached-find.ts"
);
/** Where nextly keeps the app's registered `"use cache"` read function. */
const REGISTERED_READ = join(
  __dirname,
  "../../../nextly/src/runtime/cache/registered-read.ts"
);

/** What the stand-ins record. */
interface Calls {
  cacheLife: { revalidate: number; expire: number }[];
  cacheTag: string[][];
  run: string[];
  registered: [unknown, unknown][];
}

const NEXT_CACHE = `const calls = globalThis.__cachedReadCalls;
export const cacheLife = profile => { calls.cacheLife.push(profile); };
export const cacheTag = (...tags) => { calls.cacheTag.push(tags); };
`;
const NEXTLY_RUNTIME = `const calls = globalThis.__cachedReadCalls;
export const runRegisteredRead = async key => { calls.run.push(key); return "read:" + key; };
export const registerCachedRead = (fn, value) => { calls.registered.push([fn, value]); };
`;

let dir = "";
let calls: Calls;
let cachedRead: (
  key: string,
  tags: string[],
  revalidate: number | false
) => Promise<unknown>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-cached-read-"));
  calls = { cacheLife: [], cacheTag: [], run: [], registered: [] };
  (globalThis as { __cachedReadCalls?: Calls }).__cachedReadCalls = calls;
  await writeFile(join(dir, "next-cache.mjs"), NEXT_CACHE);
  await writeFile(join(dir, "nextly-runtime.mjs"), NEXTLY_RUNTIME);
  const source = (await readFile(TEMPLATE, "utf8"))
    .replace('"next/cache"', JSON.stringify(join(dir, "next-cache.mjs")))
    .replace(
      '"nextly/runtime"',
      JSON.stringify(join(dir, "nextly-runtime.mjs"))
    );
  await writeFile(join(dir, "cached-read.ts"), source);
  ({ cachedRead } = await import(join(dir, "cached-read.ts")));
});

afterAll(async () => {
  delete (globalThis as { __cachedReadCalls?: Calls }).__cachedReadCalls;
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("blog template: the Cache Components read function", () => {
  it("caches a revalidate: false read until a tag expires it, never by time", async () => {
    calls.cacheLife.length = 0;
    await cachedRead("k", ["nextly:posts"], false);
    expect(calls.cacheLife).toEqual([
      { revalidate: Infinity, expire: Infinity },
    ]);
  });

  it("gives a timed read its revalidate, and an expire past it", async () => {
    calls.cacheLife.length = 0;
    await cachedRead("k", [], 600);
    await cachedRead("k", [], 5);
    expect(calls.cacheLife).toEqual([
      { revalidate: 600, expire: 1200 },
      { revalidate: 5, expire: 300 },
    ]);
  });

  it("never expires a timed read within 5 minutes, so a static prerender keeps it", async () => {
    // Next.js leaves a "use cache" entry that expires within 5 minutes out of
    // a static prerender, and a route that must be static then fails to build.
    calls.cacheLife.length = 0;
    for (const revalidate of [1, 30, 60, 149, 150]) {
      await cachedRead("k", [], revalidate);
    }
    expect(
      calls.cacheLife.every(life => life.expire >= 300),
      JSON.stringify(calls.cacheLife)
    ).toBe(true);
  });

  it("refreshes a read its handlers don't serve within a minute of a visit, and holds none past 5 minutes", async () => {
    // nextly bounds such a read by its revalidate, past which a visit is
    // served the entry once while it refreshes, and relies on this function to
    // expire the entry. Observed through nextly's own read path, in production
    // with no handlers installed, with this function registered as the app's:
    // what it is handed is what an app's read gets.
    const registry = (await import(REGISTERED_READ)) as {
      setCachedRead(read: typeof cachedRead | undefined): void;
    };
    const { applyCache } = (await import(CACHED_FIND)) as {
      applyCache(
        unstableCache: null,
        reader: () => Promise<unknown>,
        options: {
          keyParts: string[];
          tags: string[];
          revalidate?: number | false;
        }
      ): Promise<unknown>;
    };
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    registry.setCachedRead(cachedRead);
    calls.cacheLife.length = 0;
    try {
      // Cached until a write expires it, as a read asks by default.
      await applyCache(null, async () => "unused", {
        keyParts: ["posts"],
        tags: ["nextly:posts"],
        revalidate: false,
      });
    } finally {
      registry.setCachedRead(undefined);
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
    expect(calls.cacheLife).toHaveLength(1);
    const [{ revalidate, expire }] = calls.cacheLife;
    expect(
      revalidate,
      "refreshed within a minute of a visit"
    ).toBeLessThanOrEqual(30);
    expect(revalidate, "a timed read").toBeGreaterThan(0);
    expect(expire, "kept in a static prerender, and no older").toBe(300);
  });

  it("tags the entry and runs the reader registered for its key", async () => {
    calls.cacheTag.length = 0;
    calls.run.length = 0;
    await expect(
      cachedRead('["posts","a"]', ["nextly:posts", "nextly:posts:a"], false)
    ).resolves.toBe('read:["posts","a"]');
    expect(calls.cacheTag).toEqual([["nextly:posts", "nextly:posts:a"]]);
    expect(calls.run).toEqual(['["posts","a"]']);
  });

  it("registers itself with the value Next.js inlines for Cache Components", () => {
    expect(calls.registered).toEqual([
      [cachedRead, process.env.__NEXT_CACHE_COMPONENTS],
    ]);
  });

  it("is the function the caching guide prints", async () => {
    const template = await readFile(TEMPLATE, "utf8");
    const guide = await readFile(GUIDE, "utf8");
    // The template's code after its doc comment, and the guide's block after
    // its file-name line, compared without the guide's list indentation.
    const code = template.slice(template.indexOf("*/") + 2).trim();
    const block =
      /```ts\n {3}\/\/ src\/nextly\/cached-read\.ts\n([\s\S]*?)\n {3}```/.exec(
        guide
      );
    expect(block, "the guide's cached-read block").not.toBeNull();
    const printed = (block?.[1] ?? "")
      .split("\n")
      .map(line => line.replace(/^ {3}/, ""))
      .join("\n")
      .trim();
    expect(printed).toBe(code);
  });
});
