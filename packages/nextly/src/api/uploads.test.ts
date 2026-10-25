/**
 * The route that serves local uploads Next.js has no static file for.
 *
 * Driven through the real `MediaStorage` and `LocalStorageAdapter` over a
 * temporary folder, with only the singleton accessor and Nextly's start-up
 * replaced: which adapter answers, how a URL becomes a path, and whether
 * that path stays in the folder are the properties under test, so none of
 * them is doubled.
 *
 * @module api/uploads.test
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalStorageAdapter } from "../storage/adapters/local-adapter";
import { DEFAULT_READ_MAX_BYTES } from "../storage/fetch-stored-bytes";
import { MediaStorage } from "../storage/storage";
import type { IStorageAdapter } from "../storage/types";

const mocks = vi.hoisted(() => ({
  storage: null as MediaStorage | null,
}));

vi.mock("../init", () => ({
  getNextly: vi.fn(async () => ({})),
  getCachedNextly: vi.fn(async () => ({})),
}));

vi.mock("../storage/storage", async importOriginal => {
  const actual = await importOriginal<typeof import("../storage/storage")>();
  return {
    ...actual,
    getMediaStorage: vi.fn(() => {
      if (!mocks.storage) throw new Error("no storage set for this test");
      return mocks.storage;
    }),
  };
});

const { createUploadsHandlers } = await import("./uploads");

/** The bytes of a 1x1 PNG, so the stored file is what an upload would be. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let root: string;
let uploads: string;
let adapter: LocalStorageAdapter;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "nextly-uploads-route-"));
  uploads = path.join(root, "public", "uploads");
  await fs.mkdir(uploads, { recursive: true });
  mocks.storage = new MediaStorage({
    local: { uploadDir: uploads, publicPath: "/uploads" },
  });
  adapter = mocks.storage.getAdapterForCollection(
    "media"
  ) as LocalStorageAdapter;
});

afterEach(async () => {
  mocks.storage = null;
  await fs.rm(root, { recursive: true, force: true });
});

const handlers = () => createUploadsHandlers();

function get(urlPath: string, headers?: Record<string, string>) {
  return handlers().GET(
    new Request(`http://localhost:3000${urlPath}`, { headers })
  );
}

/** Store a file the way an upload does, and return its URL. */
async function upload(filename: string, bytes: Buffer): Promise<string> {
  const result = await adapter.upload(bytes, {
    filename,
    mimeType: "application/octet-stream",
  });
  return result.url;
}

/** Place a file in the folder by hand, under a name no upload generates. */
async function place(relative: string, bytes: Buffer | string) {
  const full = path.join(uploads, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return `/uploads/${relative}`;
}

async function bytesOf(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe("a stored file", () => {
  it("is served whole at the URL the upload was given, with its type", async () => {
    const url = await upload("photo.png", PNG);

    const response = await get(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG.length));
    expect(await bytesOf(response)).toEqual(PNG);
  });

  it("forbids type sniffing", async () => {
    const response = await get(await upload("photo.png", PNG));
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("is cached for a year as immutable, because its generated name is never rewritten", async () => {
    const response = await get(await upload("photo.png", PNG));
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(response.headers.get("last-modified")).not.toBeNull();
  });

  it("placed by hand under a name no upload generates is revalidated, not cached as immutable", async () => {
    const response = await get(await place("logo.png", PNG));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate"
    );
  });

  it("an SVG carries the policy that stops its scripts running", async () => {
    const response = await get(
      await upload(
        "icon.svg",
        Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")
      )
    );
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'none'"
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("of a type no accepted format names downloads as unknown bytes, never rendered", async () => {
    const response = await get(
      await place("2026/01/notes.html", "<script>1</script>")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream"
    );
    expect(response.headers.get("content-disposition")).toBe("attachment");
  });

  it("a video is served with its type", async () => {
    const response = await get(await upload("clip.mp4", Buffer.alloc(32, 1)));
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });
});

describe("a file larger than a buffered read may hold", () => {
  // The adapter's `read` refuses past this cap; the route streams instead,
  // so the cap is no limit on what it can serve.
  it("is streamed whole, without going through the capped read", async () => {
    const big = Buffer.alloc(DEFAULT_READ_MAX_BYTES + 1024, 7);
    big.write("tail", big.length - 4);
    const url = await upload("long.mp4", big);
    const read = vi.spyOn(adapter, "read");

    const response = await get(url);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(big.length));
    const body = await bytesOf(response);
    expect(body.length).toBe(big.length);
    expect(body.subarray(-4).toString()).toBe("tail");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("ranges", () => {
  const bytes = Buffer.from("0123456789");
  let url: string;

  beforeEach(async () => {
    url = await upload("clip.mp4", bytes);
  });

  it("a span is answered with exactly those bytes", async () => {
    const response = await get(url, { range: "bytes=2-5" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect((await bytesOf(response)).toString()).toBe("2345");
  });

  it("an open-ended span runs to the end", async () => {
    const response = await get(url, { range: "bytes=7-" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 7-9/10");
    expect((await bytesOf(response)).toString()).toBe("789");
  });

  it("a suffix span is the last bytes", async () => {
    const response = await get(url, { range: "bytes=-3" });
    expect(response.status).toBe(206);
    expect((await bytesOf(response)).toString()).toBe("789");
  });

  it("a span past the end is refused with the file's size", async () => {
    const response = await get(url, { range: "bytes=10-" });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */10");
  });

  it("several spans are answered with the whole file", async () => {
    const response = await get(url, { range: "bytes=0-1,4-5" });
    expect(response.status).toBe(200);
    expect((await bytesOf(response)).toString()).toBe("0123456789");
  });

  it("a span asked If-Range of another version is answered with the whole file", async () => {
    const response = await get(url, {
      range: "bytes=2-5",
      "if-range": '"not-this-file"',
    });
    expect(response.status).toBe(200);
    expect((await bytesOf(response)).toString()).toBe("0123456789");
  });

  it("a span asked If-Range of this version is still a span", async () => {
    const tag = (await get(url)).headers.get("etag") ?? "";
    const response = await get(url, { range: "bytes=2-5", "if-range": tag });
    expect(response.status).toBe(206);
  });
});

describe("revalidation", () => {
  it("answers 304 to the ETag it gave", async () => {
    const url = await upload("photo.png", PNG);
    const tag = (await get(url)).headers.get("etag") ?? "";

    const response = await get(url, { "if-none-match": tag });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("answers 304 to a date no earlier than the file's", async () => {
    const url = await upload("photo.png", PNG);
    const since = new Date(Date.now() + 60_000).toUTCString();
    const response = await get(url, { "if-modified-since": since });
    expect(response.status).toBe(304);
  });

  it("serves the file to an ETag it never gave", async () => {
    const url = await upload("photo.png", PNG);
    const response = await get(url, { "if-none-match": '"other"' });
    expect(response.status).toBe(200);
  });
});

describe("HEAD", () => {
  it("states the headers and sends no body", async () => {
    const url = await upload("photo.png", PNG);
    const response = await handlers().HEAD(
      new Request(`http://localhost:3000${url}`, { method: "HEAD" })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(String(PNG.length));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.body).toBeNull();
  });
});

describe("what is not served", () => {
  it("a missing file is 404", async () => {
    const response = await get("/uploads/2026/01/nothing-here.png");
    expect(response.status).toBe(404);
  });

  it("a path outside the adapter's URL is 404, though the file exists", async () => {
    await place("photo.png", PNG);
    const response = await get("/media/photo.png");
    expect(response.status).toBe(404);
  });

  it("a file beside the storage folder, reached by an encoded ../, is 404", async () => {
    await fs.writeFile(path.join(root, "public", "secret.txt"), "private");
    const response = await get("/uploads/..%2Fsecret.txt");
    expect(response.status).toBe(404);
  });

  it("a sibling folder sharing the storage folder's name as a prefix is 404", async () => {
    const sibling = path.join(root, "public", "uploads-private");
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, "secret.txt"), "private");
    const response = await get("/uploads/....//uploads-private/secret.txt");
    expect(response.status).toBe(404);
  });

  it("a link in the folder pointing outside it is 404", async () => {
    const outside = path.join(root, "outside.png");
    await fs.writeFile(outside, PNG);
    await fs.symlink(outside, path.join(uploads, "linked.png"));
    const response = await get("/uploads/linked.png");
    expect(response.status).toBe(404);
  });

  it("a dotfile in the folder is 404", async () => {
    await place(".gitignore", "*\n");
    const response = await get("/uploads/.gitignore");
    expect(response.status).toBe(404);
  });

  it("a folder is 404", async () => {
    await place("2026/01/a.png", PNG);
    const response = await get("/uploads/2026/01");
    expect(response.status).toBe(404);
  });
});

describe("with cloud storage holding media", () => {
  /** A cloud adapter: its files are on another host, never on this disk. */
  function cloudAdapter(): IStorageAdapter {
    return {
      upload: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      read: vi.fn(),
      getPublicUrl: vi.fn((key: string) => `https://bucket.example/${key}`),
      getType: () => "s3",
    } as unknown as IStorageAdapter;
  }

  it("answers 404 for every path, a file in the local folder included, and never asks the cloud adapter", async () => {
    const cloud = cloudAdapter();
    mocks.storage = new MediaStorage({
      local: { uploadDir: uploads, publicPath: "/uploads" },
      plugins: [
        {
          name: "s3",
          type: "s3",
          collections: { media: true },
          adapter: cloud,
        },
      ],
    });
    const url = await place("2026/01/left-over.png", PNG);

    const response = await get(url);

    expect(response.status).toBe(404);
    expect(cloud.read).not.toHaveBeenCalled();
    expect(cloud.exists).not.toHaveBeenCalled();
  });

  it("still serves a local storage plugin configured for another collection", async () => {
    const elsewhere = path.join(root, "public", "files");
    const local = new LocalStorageAdapter({
      basePath: elsewhere,
      baseUrl: "/files",
    });
    mocks.storage = new MediaStorage({
      local: { uploadDir: uploads, publicPath: "/uploads" },
      plugins: [
        {
          name: "s3",
          type: "s3",
          collections: { media: true },
          adapter: cloudAdapter(),
        },
        {
          name: "local-storage",
          type: "local",
          collections: { files: true },
          adapter: local,
        },
      ],
    });
    const stored = await local.upload(PNG, {
      filename: "doc.png",
      mimeType: "image/png",
    });

    const response = await get(stored.url);

    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toEqual(PNG);
  });
});
