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

import { isCliEntry } from "../../../scripts/cli-entry.mjs";
import config from "../nextly.config";
import {
  KITCHEN_SINK_DOCUMENT,
  KITCHEN_SINK_SLUG,
  KITCHEN_SINK_TITLE,
} from "../seed/kitchen-sink";

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
  blockPagesCreated: number;
}

const EMPTY_RESULT: SeedResult = {
  skipped: false,
  usersCreated: 0,
  categoriesCreated: 0,
  tagsCreated: 0,
  postsCreated: 0,
  mediaUploaded: 0,
  blockPagesCreated: 0,
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
/**
 * The kitchen-sink page, which is the only content in this repo that renders a
 * block at all.
 *
 * Published rather than draft: the `/blocks/<slug>` route reads with the default
 * `published` scope, so a draft row 404s from a page that looks entirely correct.
 *
 * Idempotent on the SLUG, like every seeder beside it. The document is expected
 * to change as blocks gain defaults, and an existing row is left alone rather
 * than overwritten — a re-seed must not discard whatever a developer was in the
 * middle of trying on the page.
 */
/**
 * The slice of the Nextly client this seeder uses, stated rather than widened.
 *
 * The seeders around it take the instance as `any`, because they reach across
 * users, media and dynamic collections and the instance's shape is assembled at
 * boot. This one asks two questions of one collection, so the contract is small
 * enough to write down — and writing it down is what makes a change to either
 * call a type error here rather than a runtime failure during a seed.
 */
interface BlockPageStore {
  find(args: {
    collection: string;
    where: { slug: { equals: string } };
    limit: number;
  }): Promise<{ meta: { total: number } }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

async function seedBlockPages(nextly: BlockPageStore) {
  const existing = await nextly.find({
    collection: "block-pages",
    where: { slug: { equals: KITCHEN_SINK_SLUG } },
    limit: 1,
  });
  if (existing.meta.total > 0) return { created: 0 };

  try {
    await nextly.create({
      collection: "block-pages",
      data: {
        title: KITCHEN_SINK_TITLE,
        slug: KITCHEN_SINK_SLUG,
        content: KITCHEN_SINK_DOCUMENT,
        status: "published",
      },
    });
  } catch (error) {
    /*
     * The find above and this create are two operations, and `slug` carries a
     * database-level unique constraint — so two seed runs starting together can
     * both find nothing and the loser's insert is refused. Reaching that is
     * ordinary rather than exotic: booting the app runs a seed, and a
     * contributor running `db:seed` beside it is the race.
     *
     * Refused for THAT reason means the page is already there, which is the
     * outcome this function exists to reach, so it is not a failure. Pinned to
     * the code rather than swallowing everything: a bare catch here would claim
     * "already seeded" about a dropped connection or a validation error, and the
     * seed would report success having written nothing.
     *
     * Measured rather than assumed — inserting this slug twice against the dev
     * database throws `NextlyError` with `code: "DUPLICATE"` and status 409.
     */
    if (!isDuplicateRefusal(error)) throw error;
    return { created: 0 };
  }
  return { created: 1 };
}

/** Whether a create was refused because the row is already there. */
function isDuplicateRefusal(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "DUPLICATE"
  );
}

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

  // AFTER the posts, because the page's `core/collection-loop` draws them. Seeded
  // in the other order the loop renders an empty container on a fresh database,
  // which reads as a broken block rather than as an empty collection.
  const blockPages = await seedBlockPages(nextly);
  result.blockPagesCreated = blockPages.created;

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
    /*
     * The content seeders are gated on an empty database because they write
     * rows an author may since have edited or deleted, and re-creating those
     * would fight whoever owns the database.
     *
     * The kitchen-sink page is not one of those. It is keyed on a slug nothing
     * else writes and it is idempotent on that slug, so it is safe to offer to a
     * database that already has users — and gating it behind the empty check
     * meant an existing checkout never received the page at all, since a
     * contributor reaches this path on every run after their first.
     */
    const blockPages = await seedBlockPages(nextly);
    return {
      ...EMPTY_RESULT,
      skipped: true,
      reason: "users-exist",
      blockPagesCreated: blockPages.created,
    };
  }
  return seedForce();
}

// CLI entry: `pnpm db:seed` runs seedIfEmpty. Wrapped in an async IIFE
// because tsx compiles this to CJS where top-level await isn't allowed.
if (isCliEntry(import.meta.url)) {
  void (async () => {
    try {
      const result = await seedIfEmpty();
      if (result.skipped) {
        // The page is reported separately, because the skip message otherwise
        // says nothing happened on a run that created it.
        console.log(
          `[nextly] seed skipped (${result.reason ?? "no-op"})` +
            (result.blockPagesCreated > 0
              ? `, added ${result.blockPagesCreated} block page`
              : "")
        );
      } else {
        console.log(
          `[nextly] seed complete: ${result.usersCreated} user, ` +
            `${result.postsCreated} posts, ${result.categoriesCreated} categories, ` +
            `${result.tagsCreated} tags, ${result.mediaUploaded} media, ` +
            `${result.blockPagesCreated} block pages`
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
