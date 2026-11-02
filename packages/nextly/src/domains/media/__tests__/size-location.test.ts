/**
 * Whether a size's recorded URL is where the storage configured now serves
 * its file (`servedHere`), the answer `nextly media remove-sizes` and a
 * delete (`storedFilesOf`) both take before removing anything for a size.
 *
 * A URL's scheme and host are case-insensitive and its path is not, so
 * `HTTPS://New-Bucket.example/x` is the same file as
 * `https://new-bucket.example/x`, and a URL naming another host never is,
 * however either is cased. Taken for this storage's file, another host's
 * size would be removed from this storage by its key, which can be another
 * item's file, and its own would stay with nothing naming it.
 */
import { describe, expect, it } from "vitest";

import { servedHere, type SizeLocator } from "../size-location";
import { storedFilesOf } from "../stored-files";

const KEY = "2026/11/photo-small.webp";

/** A storage serving each key under `base`, of `type`. */
function storage(base: string, type = "s3"): SizeLocator {
  return { getPublicUrl: path => `${base}/${path}`, getType: () => type };
}

describe("a size's URL on an object storage", () => {
  const here = storage("https://new-bucket.example");

  it("is served here on this storage's host (the control)", () => {
    expect(servedHere(`https://new-bucket.example/${KEY}`, KEY, here)).toBe(
      true
    );
  });

  it("is not served here on another host (the control)", () => {
    expect(servedHere(`https://old-bucket.example/${KEY}`, KEY, here)).toBe(
      false
    );
  });

  it("is served here on this storage's host with its scheme in capitals", () => {
    expect(servedHere(`HTTPS://new-bucket.example/${KEY}`, KEY, here)).toBe(
      true
    );
  });

  it("is served here on this storage's host spelled in mixed case", () => {
    expect(servedHere(`https://New-Bucket.Example/${KEY}`, KEY, here)).toBe(
      true
    );
  });

  it("is not served here on another host with its scheme in capitals", () => {
    expect(servedHere(`HTTPS://old-bucket.example/${KEY}`, KEY, here)).toBe(
      false
    );
  });

  // The harmful case: both URLs with the scheme in capitals were read as
  // relative to the site, and two hosts with one path as one storage.
  it("is not served here on another host when this storage writes its scheme in capitals too", () => {
    const shouting = storage("HTTPS://new-bucket.example");

    expect(servedHere(`HTTPS://old-bucket.example/${KEY}`, KEY, shouting)).toBe(
      false
    );
    // The control: its own host, so served here.
    expect(servedHere(`https://new-bucket.example/${KEY}`, KEY, shouting)).toBe(
      true
    );
  });

  it("keeps the case of the path: another path is another file", () => {
    expect(
      servedHere(`https://new-bucket.example/${KEY.toUpperCase()}`, KEY, here)
    ).toBe(false);
  });
});

describe("a size's URL on local disk", () => {
  const disk = storage("/uploads", "local");

  it("is served here relative to the site", () => {
    expect(servedHere(`/uploads/${KEY}`, KEY, disk)).toBe(true);
  });

  // Local disk is served from the site under either spelling, so an
  // absolute URL with its path counts, however its scheme and host are cased.
  it("reads an absolute URL the same whatever the case of its scheme and host", () => {
    const lower = servedHere(`http://localhost:3000/uploads/${KEY}`, KEY, disk);
    const upper = servedHere(`HTTP://LOCALHOST:3000/uploads/${KEY}`, KEY, disk);

    expect(lower).toBe(true);
    expect(upper).toBe(lower);
  });

  it("is not served here under another path", () => {
    expect(servedHere(`/elsewhere/${KEY}`, KEY, disk)).toBe(false);
  });
});

// The delete reads a size through the same answer.
describe("a delete's reading of a size recorded by its URL alone", () => {
  const record = (base: string) => ({
    filename: "2026/11/photo.png",
    url: `${base}/2026/11/photo.png`,
    thumbnailUrl: null,
    sizes: JSON.stringify({ small: { url: `${base}/${KEY}` } }),
  });

  it("removes it when it is on this storage, its scheme in capitals", () => {
    const files = storedFilesOf(
      record("HTTPS://new-bucket.example"),
      storage("https://new-bucket.example")
    );

    expect(files.paths).toContain(KEY);
    expect(files.notHere).toEqual([]);
  });

  it("names it, removing nothing for it, when another host serves it", () => {
    const files = storedFilesOf(
      record("HTTPS://old-bucket.example"),
      storage("HTTPS://new-bucket.example")
    );

    expect(files.paths).not.toContain(KEY);
    expect(files.notHere).toEqual([`HTTPS://old-bucket.example/${KEY}`]);
  });
});
