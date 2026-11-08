/**
 * The blog template's demo seed, run whole against an in-memory Nextly, for
 * the author profiles it makes and the posts it credits to them.
 *
 * - An author whose seed data gives an absolute avatar address gets that
 *   image in the media library as their profile's avatar, fetched at seed
 *   time; one that can't be fetched leaves the profile without an avatar and
 *   the seed reports it, never failing.
 * - A run that could not make an author's profile leaves that author's posts
 *   uncredited; the next run makes the profile and credits the posts, so a
 *   retry ends where a first clean run does.
 *
 * The seed reads its data from the project's `src/endpoints/seed`, so each
 * test runs it in a scratch project of its own.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { seed } from "../../../../templates/blog/src/endpoints/seed/index";

type Row = Record<string, unknown>;
type Where = Record<string, { equals?: unknown }>;

const AVATAR = "https://cdn.example/avatars/ada.png";

/** An image server's answer: a PNG. */
const pngAnswer = async () =>
  new Response(new Uint8Array([137, 80, 78, 71]), {
    status: 200,
    headers: { "content-type": "image/png" },
  });

/** One author with one post, as a custom seed would give them. */
function seedData(avatarUrl?: string) {
  return {
    users: [
      {
        name: "Ada Lovelace",
        email: "ada@example.com",
        password: "ChangeMe@123",
        slug: "ada-lovelace",
        bio: "Writes about engines.",
        ...(avatarUrl ? { avatarUrl } : {}),
        role: "author",
      },
    ],
    categories: [],
    tags: [],
    posts: [
      {
        title: "Notes on the Engine",
        slug: "notes-on-the-engine",
        excerpt: "An excerpt.",
        author: "ada-lovelace",
        categories: [],
        publishedAt: "2026-01-01T00:00:00.000Z",
        status: "published",
        featuredImage: "",
        content: { root: { children: [] } },
      },
    ],
    siteSettings: {
      siteName: "Demo",
      tagline: "A blog",
      siteDescription: "Demo blog",
      logo: "",
      social: {},
    },
  };
}

/**
 * A Nextly holding its rows in memory, answering the calls the seed makes.
 * `failAuthorCreates` refuses that many author creates first, as a database
 * that dropped a connection would.
 */
function memoryNextly(options: { failAuthorCreates?: number } = {}) {
  const rows: Record<string, Row[]> = {};
  let failAuthorCreates = options.failAuthorCreates ?? 0;
  let next = 0;
  const id = () => `id-${++next}`;
  const table = (name: string) => (rows[name] ??= []);
  const matches = (row: Row, where?: Where) =>
    Object.entries(where ?? {}).every(
      ([key, test]) => row[key] === test.equals
    );

  const upload = vi.fn(
    async (args: {
      file: { name: string; mimetype: string };
      altText: string;
    }) => {
      const row = { id: id(), filename: args.file.name, ...args };
      table("media").push(row);
      return row;
    }
  );
  const nextly = {
    permissions: { find: async () => ({ items: [] }) },
    roles: {
      find: async () => ({ items: [] }),
      create: async ({ data }: { data: Row }) => ({
        item: { id: id(), ...data },
      }),
    },
    users: {
      find: async ({ search }: { search: string }) => ({
        items: table("users").filter(user => user.email === search),
      }),
      create: async ({ email, data }: { email: string; data: Row }) => {
        const row = { id: id(), email, ...data };
        table("users").push(row);
        return { item: row };
      },
      update: async () => ({}),
    },
    media: { upload },
    find: async ({
      collection,
      where,
      limit,
    }: {
      collection: string;
      where?: Where;
      limit?: number;
    }) => {
      const found = table(collection).filter(row => matches(row, where));
      return {
        items: found.slice(0, limit ?? found.length),
        meta: { total: found.length },
      };
    },
    create: async ({ collection, data }: { collection: string; data: Row }) => {
      if (collection === "authors" && failAuthorCreates > 0) {
        failAuthorCreates--;
        throw new Error("connection reset");
      }
      const row = { id: id(), ...data };
      table(collection).push(row);
      return { item: row };
    },
    update: async ({
      collection,
      id: rowId,
      data,
    }: {
      collection: string;
      id: string;
      data: Row;
    }) => {
      const row = table(collection).find(r => r.id === rowId);
      if (!row) throw new Error(`no ${collection} ${rowId}`);
      for (const [key, value] of Object.entries(data))
        if (value !== undefined && key !== "_rev") row[key] = value;
      return { item: row };
    },
    updateSingle: async () => ({}),
  };
  return { nextly, rows, upload };
}

let project: string;

/** Run the seed in the scratch project, with `data` as its seed data. */
async function runSeed(
  nextly: ReturnType<typeof memoryNextly>["nextly"],
  data: ReturnType<typeof seedData>
) {
  const dir = path.join(project, "src", "endpoints", "seed");
  await mkdir(path.join(dir, "media"), { recursive: true });
  await writeFile(path.join(dir, "seed-data.json"), JSON.stringify(data));
  return seed({ nextly: nextly as never, config: { collections: [] } });
}

beforeEach(async () => {
  project = await mkdtemp(path.join(tmpdir(), "blog-seed-"));
  vi.spyOn(process, "cwd").mockReturnValue(project);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(project, { recursive: true, force: true });
});

describe("the blog seed's author avatars from an absolute address", () => {
  it("fetches the image into the media library and gives it to the profile", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        })
    );
    vi.stubGlobal("fetch", fetch);
    const { nextly, rows, upload } = memoryNextly();

    const result = await runSeed(nextly, seedData(AVATAR));

    expect(fetch).toHaveBeenCalledWith(AVATAR, expect.anything());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toMatchObject({
      file: { name: "ada.png", mimetype: "image/png" },
      altText: "Ada Lovelace",
    });
    const [author] = rows.authors;
    expect(author.avatar).toBe(rows.media[0].id);
    expect(result.warnings).toEqual([]);
  });

  it("makes the profile without an avatar, and reports it, when the image can't be fetched", async () => {
    for (const fails of [
      async () => {
        throw new Error("getaddrinfo ENOTFOUND cdn.example");
      },
      async () => new Response("missing", { status: 404 }),
    ]) {
      vi.stubGlobal("fetch", vi.fn(fails));
      const { nextly, rows, upload } = memoryNextly();

      const result = await runSeed(nextly, seedData(AVATAR));

      expect(upload).not.toHaveBeenCalled();
      expect(rows.authors).toHaveLength(1);
      expect(rows.authors[0].avatar).toBeUndefined();
      expect(rows.posts[0].byline).toBe(rows.authors[0].id);
      expect(result.warnings).toEqual([
        expect.stringContaining(`media "${AVATAR}": fetch-failed`),
      ]);
    }
  });
  it("uploads no avatar again for a profile that has one", async () => {
    vi.stubGlobal("fetch", vi.fn(pngAnswer));
    const { nextly, rows, upload } = memoryNextly();

    await runSeed(nextly, seedData(AVATAR));
    await runSeed(nextly, seedData(AVATAR));

    expect(upload).toHaveBeenCalledTimes(1);
    expect(rows.media).toHaveLength(1);
    expect(rows.authors).toHaveLength(1);
    expect(rows.authors[0].avatar).toBe(rows.media[0].id);
  });

  it("gives a profile the avatar an earlier run could not load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 }))
    );
    const { nextly, rows } = memoryNextly();
    await runSeed(nextly, seedData(AVATAR));
    expect(rows.authors[0].avatar).toBeUndefined();

    vi.stubGlobal("fetch", vi.fn(pngAnswer));
    const second = await runSeed(nextly, seedData(AVATAR));
    expect(second.warnings).toEqual([]);
    expect(rows.authors).toHaveLength(1);
    expect(rows.media).toHaveLength(1);
    expect(rows.authors[0].avatar).toBe(rows.media[0].id);
  });
});

describe("the blog seed run again", () => {
  it("credits a post the first run left uncredited once the author's profile is made", async () => {
    const { nextly, rows } = memoryNextly({ failAuthorCreates: 1 });

    const first = await runSeed(nextly, seedData());
    expect(rows.authors ?? []).toHaveLength(0);
    expect(rows.posts).toHaveLength(1);
    expect(rows.posts[0].byline).toBeUndefined();
    expect(first.warnings).toEqual([
      expect.stringContaining('author "ada-lovelace": connection reset'),
    ]);

    const second = await runSeed(nextly, seedData());
    expect(second.warnings).toEqual([]);
    expect(rows.authors).toHaveLength(1);
    expect(rows.posts).toHaveLength(1);
    expect(rows.posts[0].byline).toBe(rows.authors[0].id);
  });

  // An editor may rename a profile; it is still that user's, found by its
  // account, so the rerun makes no second profile and uploads nothing.
  it("finds a profile an editor renamed since by its account", async () => {
    vi.stubGlobal("fetch", vi.fn(pngAnswer));
    const { nextly, rows, upload } = memoryNextly({ failAuthorCreates: 0 });
    await runSeed(nextly, seedData(AVATAR));
    rows.authors[0].slug = "ada-the-countess";
    rows.posts[0].byline = undefined;

    const second = await runSeed(nextly, seedData(AVATAR));
    expect(second.warnings).toEqual([]);
    expect(rows.authors).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(rows.media).toHaveLength(1);
    expect(rows.posts[0].byline).toBe(rows.authors[0].id);
  });

  it("keeps a byline the post was given since", async () => {
    const { nextly, rows } = memoryNextly();
    await runSeed(nextly, seedData());
    rows.posts[0].byline = "chosen-by-an-editor";

    await runSeed(nextly, seedData());
    expect(rows.posts[0].byline).toBe("chosen-by-an-editor");
  });
});
