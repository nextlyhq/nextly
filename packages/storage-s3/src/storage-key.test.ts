/**
 * Where a file lands in the bucket under a collection's `prefix`.
 *
 * A file reaches S3 two ways: through the server (`adapter.upload`, which core
 * hands the prefix as `folder`) and directly from the browser (the plugin's
 * `getClientUploadUrl`, which builds the key before signing). Both must give
 * one key for one prefix, whether or not it is written with a trailing slash,
 * since the docs show `prefix: "private/"` and a bare name is just as natural.
 *
 * @module storage-key.test
 */
import { describe, expect, it, vi } from "vitest";

import type { PutObjectCommandInput } from "@aws-sdk/client-s3";

import { S3StorageAdapter } from "./adapter";
import { s3Storage } from "./plugin";

// The server path's single request, kept so a case can read the key it used.
const uploaded: PutObjectCommandInput[] = [];
vi.mock("@aws-sdk/lib-storage", () => ({
  Upload: class {
    constructor(options: { params: PutObjectCommandInput }) {
      uploaded.push(options.params);
    }
    done = async () => ({});
  },
}));

// Stand-in credentials: signing a URL is local arithmetic, and nothing is sent.
const base = {
  bucket: "test-bucket",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "stand-in-secret-for-signing-only",
};

// `<prefix>/<year>/<month>/<uuid>-<name>`, the prefix given without a slash.
function keyUnder(prefix: string, name: string): RegExp {
  return new RegExp(
    `^${prefix}/\\d{4}/\\d{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-${name}$`
  );
}

async function serverKey(folder: string | undefined): Promise<string> {
  uploaded.length = 0;
  const adapter = new S3StorageAdapter(base);
  const result = await adapter.upload(Buffer.from("x"), {
    filename: "receipt.pdf",
    mimeType: "application/pdf",
    collection: "proofs",
    ...(folder !== undefined ? { folder } : {}),
  });
  // The key reported is the key written.
  expect(uploaded[0]?.Key).toBe(result.path);
  return result.path;
}

async function clientKey(prefix: string | undefined): Promise<string> {
  const plugin = s3Storage({
    ...base,
    collections: {
      proofs: {
        clientUploads: true,
        ...(prefix !== undefined ? { prefix } : {}),
      },
    },
  });
  const data = await plugin.getClientUploadUrl?.(
    "receipt.pdf",
    "application/pdf",
    "proofs",
    { size: 1024 }
  );
  if (!data) throw new Error("the plugin offered no client upload");
  // The URL signs the key it reports.
  expect(new URL(data.uploadUrl).pathname).toBe(`/${data.path}`);
  return data.path;
}

describe("S3 keys under a collection prefix", () => {
  it.each(["proofs", "proofs/", "proofs//"])(
    "a server upload under %j lands in one clean folder",
    async folder => {
      const key = await serverKey(folder);
      expect(key).not.toContain("//");
      expect(key).toMatch(keyUnder("proofs", "receipt\\.pdf"));
    }
  );

  it.each(["proofs", "proofs/", "proofs//"])(
    "a client upload under %j lands in the same folder",
    async prefix => {
      const key = await clientKey(prefix);
      expect(key).not.toContain("//");
      expect(key).toMatch(keyUnder("proofs", "receipt\\.pdf"));
    }
  );

  it("keeps a nested prefix's inner slashes", async () => {
    expect(await serverKey("tenant/proofs/")).toMatch(
      keyUnder("tenant/proofs", "receipt\\.pdf")
    );
    expect(await clientKey("tenant/proofs")).toMatch(
      keyUnder("tenant/proofs", "receipt\\.pdf")
    );
  });

  it("puts a file with no prefix at the date folder, both ways", async () => {
    const dateOnly =
      /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-receipt\.pdf$/;
    expect(await serverKey(undefined)).toMatch(dateOnly);
    expect(await clientKey(undefined)).toMatch(dateOnly);
    // A prefix of only slashes names no folder, rather than a leading "/".
    expect(await serverKey("/")).toMatch(dateOnly);
    expect(await clientKey("/")).toMatch(dateOnly);
  });
});
