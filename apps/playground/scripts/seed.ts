/**
 * Playground seed script.
 *
 * Idempotent contributor-focused seeder. Re-running is safe: each step
 * checks for existing rows and skips creates that would duplicate.
 *
 * Auto-runs from the dev wrapper (`scripts/dev-playground.mjs`) before
 * `next dev` starts. Also runnable standalone via `pnpm db:seed` for
 * manual reseeding, and called by `scripts/reset.ts` after a wipe.
 *
 * The seed exists for contributor demo only - end users scaffolding via
 * `create-nextly-app` get the blog template's seed instead, which is a
 * fuller workflow with role/permission demoing.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { getNextly } from "nextly";
import { seedPermissions, seedSuperAdmin } from "nextly/database/seeders";

import config from "../nextly.config";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND_DIR = path.resolve(HERE, "..");
const SEED_DIR = path.join(PLAYGROUND_DIR, "seed");

// Match what apps/playground/nextly.config.ts has in admin.devAutoLogin
// so the auto-login feature finds this user on the first /admin visit.
const DEV_USER = {
  email: "dev@nextly.local",
  password: "DevPassword123!",
  name: "Dev User",
};

interface SeedData {
  categories: Array<{ title: string; slug: string; description: string }>;
  tags: Array<{ title: string; slug: string; description: string }>;
  posts: Array<{
    title: string;
    slug: string;
    excerpt: string;
    categories: string[];
    tags?: string[];
    featuredImage?: string;
    publishedAt: string;
    status: string;
  }>;
}

export interface SeedResult {
  /** True when the seed exited early because content already existed. */
  skipped: boolean;
  reason?: string;
  usersCreated: number;
  categoriesCreated: number;
  tagsCreated: number;
  postsCreated: number;
  mediaUploaded: number;
}

const EMPTY_RESULT: SeedResult = {
  skipped: false,
  usersCreated: 0,
  categoriesCreated: 0,
  tagsCreated: 0,
  postsCreated: 0,
  mediaUploaded: 0,
};

async function loadSeedData(): Promise<SeedData> {
  const raw = await fs.readFile(path.join(SEED_DIR, "seed-data.json"), "utf-8");
  return JSON.parse(raw) as SeedData;
}

async function ensureSuperAdmin(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nextly instance from getNextly() has dynamic shape
  nextly: any
): Promise<{ created: number }> {
  const existing = await nextly.users.findOne({ search: DEV_USER.email });
  if (existing) return { created: 0 };

  // Bootstrap permissions + super-admin via the framework's documented
  // seeder primitives. nextly.adapter is the connected DrizzleAdapter
  // exposed by the Nextly instance.
  const adapter = nextly.adapter;
  await seedPermissions(adapter, { silent: true });
  await seedSuperAdmin(adapter, {
    email: DEV_USER.email,
    password: DEV_USER.password,
    name: DEV_USER.name,
    silent: true,
  });
  return { created: 1 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nextly instance has dynamic shape
async function seedCategories(nextly: any, data: SeedData) {
  const idBySlug = new Map<string, string>();
  let created = 0;
  for (const c of data.categories) {
    const existing = await nextly.find({
      collection: "categories",
      where: { slug: { equals: c.slug } },
      limit: 1,
    });
    if (existing.meta.total > 0) {
      idBySlug.set(c.slug, existing.items[0].id as string);
      continue;
    }
    const result = await nextly.create({
      collection: "categories",
      data: c,
    });
    idBySlug.set(c.slug, result.item.id as string);
    created++;
  }
  return { idBySlug, created };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nextly instance has dynamic shape
async function seedTags(nextly: any, data: SeedData) {
  const idBySlug = new Map<string, string>();
  let created = 0;
  for (const t of data.tags) {
    const existing = await nextly.find({
      collection: "tags",
      where: { slug: { equals: t.slug } },
      limit: 1,
    });
    if (existing.meta.total > 0) {
      idBySlug.set(t.slug, existing.items[0].id as string);
      continue;
    }
    const result = await nextly.create({
      collection: "tags",
      data: t,
    });
    idBySlug.set(t.slug, result.item.id as string);
    created++;
  }
  return { idBySlug, created };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nextly instance has dynamic shape
async function seedMedia(nextly: any, filenames: string[]) {
  const idByFilename = new Map<string, string>();
  let uploaded = 0;
  for (const filename of filenames) {
    // `media` is a core collection, not a dynamic one. Use the
    // dedicated nextly.media namespace - nextly.find({ collection: "media" })
    // routes through the dynamic-collections handler which only knows
    // about user-defined collections from nextly.config.ts.
    const existing = await nextly.media.find({ search: filename, limit: 1 });
    const matched = existing.items.find(
      (m: { filename?: string }) => m.filename === filename
    );
    if (matched) {
      idByFilename.set(filename, matched.id as string);
      continue;
    }
    const buffer = await fs.readFile(path.join(SEED_DIR, "media", filename));
    const media = await nextly.media.upload({
      file: {
        data: buffer,
        name: filename,
        mimetype: "image/webp",
        size: buffer.length,
      },
      altText: filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
    });
    idByFilename.set(filename, media.id as string);
    uploaded++;
  }
  return { idByFilename, uploaded };
}

async function seedPosts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Nextly instance has dynamic shape
  nextly: any,
  data: SeedData,
  categoryIds: Map<string, string>,
  tagIds: Map<string, string>,
  mediaIds: Map<string, string>
) {
  let created = 0;
  for (const p of data.posts) {
    const existing = await nextly.find({
      collection: "posts",
      where: { slug: { equals: p.slug } },
      limit: 1,
    });
    if (existing.meta.total > 0) continue;

    const categories = p.categories
      .map(slug => categoryIds.get(slug))
      .filter((id): id is string => Boolean(id));
    const tags = (p.tags ?? [])
      .map(slug => tagIds.get(slug))
      .filter((id): id is string => Boolean(id));
    const featuredImage = p.featuredImage
      ? mediaIds.get(p.featuredImage)
      : undefined;

    await nextly.create({
      collection: "posts",
      data: {
        title: p.title,
        slug: p.slug,
        excerpt: p.excerpt,
        publishedAt: p.publishedAt,
        status: p.status,
        ...(featuredImage ? { featuredImage } : {}),
        ...(categories.length ? { categories } : {}),
        ...(tags.length ? { tags } : {}),
      },
    });
    created++;
  }
  return { created };
}

/**
 * Run the seed unconditionally. Used by reset.ts after a wipe.
 */
export async function seedForce(): Promise<SeedResult> {
  const nextly = await getNextly({ config });
  const data = await loadSeedData();

  const result: SeedResult = { ...EMPTY_RESULT };

  const adminResult = await ensureSuperAdmin(nextly);
  result.usersCreated = adminResult.created;

  const cats = await seedCategories(nextly, data);
  result.categoriesCreated = cats.created;

  const tagsRes = await seedTags(nextly, data);
  result.tagsCreated = tagsRes.created;

  const mediaFilenames = Array.from(
    new Set(
      data.posts
        .map(p => p.featuredImage)
        .filter((f): f is string => Boolean(f))
    )
  );
  const media = await seedMedia(nextly, mediaFilenames);
  result.mediaUploaded = media.uploaded;

  const posts = await seedPosts(
    nextly,
    data,
    cats.idBySlug,
    tagsRes.idBySlug,
    media.idByFilename
  );
  result.postsCreated = posts.created;

  return result;
}

/**
 * Run the seed only when the database has no users yet. Idempotent
 * across repeated wrapper invocations.
 */
export async function seedIfEmpty(): Promise<SeedResult> {
  const nextly = await getNextly({ config });
  const existing = await nextly.users.find({ limit: 1 });
  if (existing.meta.total > 0) {
    return { ...EMPTY_RESULT, skipped: true, reason: "users-exist" };
  }
  return seedForce();
}

// CLI entry: `pnpm db:seed` runs seedIfEmpty. Wrapped in an async IIFE
// because tsx compiles this to CJS where top-level await isn't allowed.
const isCliEntry =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] != null &&
  import.meta.url === `file://${process.argv[1]}`;

if (isCliEntry) {
  void (async () => {
    try {
      const result = await seedIfEmpty();
      if (result.skipped) {
        console.log(`[nextly] seed skipped (${result.reason ?? "no-op"})`);
      } else {
        console.log(
          `[nextly] seed complete: ${result.usersCreated} user, ` +
            `${result.postsCreated} posts, ${result.categoriesCreated} categories, ` +
            `${result.tagsCreated} tags, ${result.mediaUploaded} media`
        );
      }
      process.exit(0);
    } catch (err) {
      console.error(
        "[nextly] seed crashed:",
        err instanceof Error ? err.message : String(err)
      );
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      process.exit(1);
    }
  })();
}
