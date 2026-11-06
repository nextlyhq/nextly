/**
 * Every image the blog template's demo seed names is one it can load.
 *
 * The seed reads each file from its own media folder, and only then from
 * `seedMedia.baseUrl`. Two posts named images that were in neither place, so
 * they seeded without a featured image, and the base URL pointed at a folder
 * the repository does not have, so every author avatar resolved to a 404.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = path.resolve(
  here,
  "../../../../templates/blog/src/endpoints/seed"
);
const MEDIA = path.join(SEED, "media");
const data = JSON.parse(
  readFileSync(path.join(SEED, "seed-data.json"), "utf8")
);

/** Every bare image filename anywhere in the seed data: featured images, avatars, the logo. */
function imageNames(value: unknown): string[] {
  if (typeof value === "string") {
    return /^[\w.-]+\.(?:svg|webp|png|jpe?g|gif|avif)$/i.test(value)
      ? [value]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap(imageNames);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(imageNames);
  return [];
}

describe("blog template: seed media", () => {
  it("names only images its media folder has", () => {
    const names = imageNames(data);
    // A floor, so a walk that found nothing cannot pass by checking nothing.
    expect(names.length).toBeGreaterThanOrEqual(data.posts.length);
    expect(names.filter(name => !existsSync(path.join(MEDIA, name)))).toEqual(
      []
    );
  });

  it("gives every post a featured image", () => {
    expect(
      data.posts.filter(
        (post: { featuredImage?: string }) => !post.featuredImage
      )
    ).toEqual([]);
  });

  it("falls back to the media folder's own path in the repository", () => {
    const relative = path
      .relative(path.resolve(here, "../../../.."), MEDIA)
      .split(path.sep)
      .join("/");
    expect(data.seedMedia.baseUrl).toMatch(
      new RegExp(
        `^https://raw\\.githubusercontent\\.com/nextlyhq/nextly/main/${relative}/$`
      )
    );
  });

  it("recognises the names it checks", () => {
    expect(
      imageNames({
        a: ["x.webp", "not an image", { b: "logo.svg" }],
        c: "https://e.com/y.png",
      })
    ).toEqual(["x.webp", "logo.svg"]);
  });
});
