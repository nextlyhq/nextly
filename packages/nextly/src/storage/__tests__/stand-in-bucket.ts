/**
 * A storage that keeps files in memory, keyed and addressed exactly as the
 * S3, Vercel Blob or UploadThing adapter keys and addresses them: on S3
 * `YYYY/MM/<uuid>-<name>`, on Vercel Blob a URL with a random suffix, which is
 * also the blob's path, and on UploadThing a random file key served at
 * `.../f/<key>`. For tests of what core stores and removes through each
 * adapter's contract, where the adapter packages themselves are not
 * dependencies of this one.
 */
import { randomUUID } from "node:crypto";

import type { IStorageAdapter, UploadOptions } from "../types";

/** The stand-in storage, by the adapter it keys and addresses files as. */
export class Bucket implements IStorageAdapter {
  readonly files = new Map<string, Buffer>();
  constructor(private readonly scheme: "s3" | "vercel-blob" | "uploadthing") {}

  async upload(buffer: Buffer, options: UploadOptions) {
    if (this.scheme === "s3") {
      const key = `2026/10/${randomUUID()}-${options.filename}`;
      this.files.set(key, buffer);
      return { url: this.getPublicUrl(key), path: key };
    }
    if (this.scheme === "uploadthing") {
      const key = randomUUID().replace(/-/g, "");
      this.files.set(key, buffer);
      return { url: this.getPublicUrl(key), path: key };
    }
    const dot = options.filename.lastIndexOf(".");
    const suffix = randomUUID().slice(0, 8);
    const url = `https://abc123.public.blob.vercel-storage.com/${options.filename.slice(0, dot)}-${suffix}${options.filename.slice(dot)}`;
    this.files.set(url, buffer);
    return { url, path: url };
  }
  async delete(filePath: string) {
    this.files.delete(filePath);
  }
  async exists(filePath: string) {
    return this.files.has(filePath);
  }
  getPublicUrl(filePath: string) {
    if (this.scheme === "s3") {
      return `https://bucket.s3.eu-west-1.amazonaws.com/${filePath}`;
    }
    if (this.scheme === "uploadthing") return `https://utfs.io/f/${filePath}`;
    return filePath;
  }
  getType() {
    return this.scheme;
  }
}
