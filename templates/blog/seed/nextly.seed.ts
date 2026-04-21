/**
 * Blog Template Seed Script
 *
 * Seeds demo content for the blog template on first run. Media files are
 * resolved local-first, then from a configurable GitHub base URL as fallback,
 * and any per-file failures are reported in an end-of-run summary.
 *
 * The {{approach}} placeholder is replaced by the CLI during scaffolding.
 *
 * This script is idempotent - safe to run multiple times.
 */

import fs from "fs";
import path from "path";

import { getNextly } from "@revnixhq/nextly";

// Approach is replaced by the CLI during scaffolding
const APPROACH = "{{approach}}";

interface SeedMediaConfig {
  baseUrl?: string;
}

interface SeedData {
  // Optional. Lets the template fetch missing media from a public URL when
  // the local file is absent (e.g. user deleted it, scaffold skipped it).
  seedMedia?: SeedMediaConfig;
  // Users double as authors in this template (users-as-authors pattern
  // from Task 17). `slug`, `bio`, and `avatarUrl` are user-extension
  // scalar fields (see ../configs/codefirst.config.ts). `avatarUrl` can
  // be either a full URL or a filename; relative filenames get prefixed
  // with `seedMedia.baseUrl` at seed time.
  users: Array<{
    name: string;
    email: string;
    password: string;
    slug: string;
    bio: string;
    avatarUrl?: string;
  }>;
  categories: Array<{
    name: string;
    slug: string;
    description: string;
  }>;
  tags?: Array<{
    name: string;
    slug: string;
    description: string;
  }>;
  posts: Array<{
    title: string;
    slug: string;
    excerpt: string;
    author: string;
    categories: string[];
    tags?: string[];
    featured?: boolean;
    seo?: {
      metaTitle?: string;
      metaDescription?: string;
      canonical?: string;
      noindex?: boolean;
    };
    publishedAt: string;
    status: string;
    featuredImage: string;
    content: Record<string, unknown>;
  }>;
  siteSettings: {
    siteName: string;
    tagline: string;
    siteDescription: string;
    logo: string;
    social: {
      twitter?: string;
      github?: string;
      linkedin?: string;
    };
  };
}

type UploadOutcome =
  | { id: string }
  | {
      miss: string;
      reason: "not-found" | "fetch-failed" | "upload-failed";
      detail?: string;
    };

/**
 * Determine the MIME type from a file extension.
 */
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Try local disk first; fall back to seedMedia.baseUrl + filename if set.
 * Returns the buffer and its source, or an error descriptor if both paths fail.
 */
async function resolveSeedMedia(
  filename: string,
  seedMedia?: SeedMediaConfig
): Promise<
  | { buffer: Buffer; source: "local" | "remote" }
  | { error: "not-found" | "fetch-failed"; detail?: string }
> {
  // Local disk first
  const localPath = path.join(process.cwd(), "seed", "media", filename);
  if (fs.existsSync(localPath)) {
    return { buffer: fs.readFileSync(localPath), source: "local" };
  }

  // Remote fallback
  if (!seedMedia?.baseUrl) {
    return { error: "not-found" };
  }

  const url = seedMedia.baseUrl.endsWith("/")
    ? seedMedia.baseUrl + filename
    : `${seedMedia.baseUrl}/${filename}`;

  const attempt = async (): Promise<Response> =>
    fetch(url, { signal: AbortSignal.timeout(10_000) });

  try {
    let res = await attempt();
    if (!res.ok) {
      // Retry once on 5xx; 4xx is permanent
      if (res.status >= 500 && res.status < 600) {
        res = await attempt();
      }
      if (!res.ok) {
        return { error: "fetch-failed", detail: `HTTP ${res.status}` };
      }
    }
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), source: "remote" };
  } catch (err) {
    // One network-level retry
    try {
      const res = await attempt();
      if (!res.ok) {
        return { error: "fetch-failed", detail: `HTTP ${res.status}` };
      }
      const arrayBuffer = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), source: "remote" };
    } catch (err2) {
      return {
        error: "fetch-failed",
        detail: err2 instanceof Error ? err2.message : String(err2),
      };
    }
  }
}

/**
 * Upload a seed media file. Never throws - returns a typed outcome so callers
 * can aggregate misses into an end-of-run summary.
 */
async function uploadMediaFile(
  nextly: Awaited<ReturnType<typeof getNextly>>,
  filename: string,
  altText: string,
  seedMedia?: SeedMediaConfig
): Promise<UploadOutcome> {
  const resolved = await resolveSeedMedia(filename, seedMedia);

  if ("error" in resolved) {
    return { miss: filename, reason: resolved.error, detail: resolved.detail };
  }

  try {
    const media = await nextly.media.upload({
      file: {
        data: resolved.buffer,
        name: filename,
        mimetype: getMimeType(filename),
        size: resolved.buffer.length,
      },
      altText,
    });
    return { id: media.id as string };
  } catch (err) {
    return {
      miss: filename,
      reason: "upload-failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Check if a collection already has entries (for idempotency).
 */
async function collectionHasEntries(
  nextly: Awaited<ReturnType<typeof getNextly>>,
  collection: string
): Promise<boolean> {
  try {
    const result = await nextly.find({
      collection,
      limit: 1,
    });
    return result.totalDocs > 0;
  } catch {
    return false;
  }
}

/**
 * Main seed function - called by Nextly on first run.
 */
export default async function seed(): Promise<void> {
  const nextly = await getNextly();

  const seedDataPath = path.join(process.cwd(), "seed", "seed-data.json");
  if (!fs.existsSync(seedDataPath)) {
    console.log("  No seed-data.json found, skipping seed.");
    return;
  }

  const seedData: SeedData = JSON.parse(fs.readFileSync(seedDataPath, "utf-8"));
  const seedMedia = seedData.seedMedia;

  const hasExistingPosts = await collectionHasEntries(nextly, "posts");
  if (hasExistingPosts) {
    console.log("  Content already exists, skipping seed.");
    return;
  }

  if (APPROACH === "visual") {
    console.log("  ⚠ Visual approach: schema seeding not yet implemented.");
    console.log(
      "    Create your collections (posts, authors, categories) in the Admin Panel"
    );
    console.log("    before the blog frontend will display content.");
    console.log("    For auto-setup, use the code-first approach instead.");
  }

  // Step 1: Upload media up front so content records can reference IDs directly.
  // Per-file failures are captured into `outcomes` for an end-of-run summary.
  console.log("  Uploading seed media...");
  const outcomes: UploadOutcome[] = [];
  const mediaIdByFilename = new Map<string, string>();

  const uploadAndTrack = async (
    filename: string,
    altText: string
  ): Promise<void> => {
    if (mediaIdByFilename.has(filename)) return; // dedupe
    const outcome = await uploadMediaFile(nextly, filename, altText, seedMedia);
    outcomes.push(outcome);
    if ("id" in outcome) {
      mediaIdByFilename.set(filename, outcome.id);
    }
  };

  // Post cover images go through the media upload path.
  // User avatars are text URLs (resolved below) so they don't get
  // uploaded here; they stay as raw URLs in the `avatarUrl` user field.
  for (const post of seedData.posts) {
    if (post.featuredImage) {
      await uploadAndTrack(post.featuredImage, post.title);
    }
  }

  // Resolve an avatarUrl to a full URL. Absolute URLs pass through; bare
  // filenames are prefixed with seedMedia.baseUrl so GitHub-hosted seed
  // assets work without uploading into the media collection.
  const resolveAvatarUrl = (raw: string | undefined): string | null => {
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = seedMedia?.baseUrl;
    if (!base) return null;
    return base.endsWith("/") ? base + raw : `${base}/${raw}`;
  };

  // Step 2: Create content entries, linking media IDs where we have them.
  console.log("  Creating users...");
  const userIdMap: Record<string, string> = {};
  for (const user of seedData.users) {
    // Skip if user already exists (idempotency: a re-run shouldn't
    // collide on the unique email index).
    const existing = await nextly.find({
      collection: "users",
      where: { email: { equals: user.email } },
      limit: 1,
      depth: 0,
    });
    if (existing.totalDocs > 0) {
      userIdMap[user.slug] = existing.docs[0].id as string;
      continue;
    }
    const created = await nextly.users.create({
      email: user.email,
      password: user.password,
      data: {
        name: user.name,
        slug: user.slug,
        bio: user.bio,
        avatarUrl: resolveAvatarUrl(user.avatarUrl),
      },
    });
    userIdMap[user.slug] = created.id as string;
  }

  console.log("  Creating categories...");
  const categoryIdMap: Record<string, string> = {};
  for (const category of seedData.categories) {
    const created = await nextly.create({
      collection: "categories",
      data: {
        title: category.name,
        name: category.name,
        slug: category.slug,
        description: category.description,
      },
    });
    categoryIdMap[category.slug] = created.id as string;
  }

  console.log("  Creating tags...");
  const tagIdMap: Record<string, string> = {};
  for (const tag of seedData.tags ?? []) {
    const created = await nextly.create({
      collection: "tags",
      data: {
        title: tag.name,
        name: tag.name,
        slug: tag.slug,
        description: tag.description,
      },
    });
    tagIdMap[tag.slug] = created.id as string;
  }

  console.log("  Creating posts...");
  for (const post of seedData.posts) {
    const authorId = userIdMap[post.author];
    const categoryIds = post.categories
      .map(slug => categoryIdMap[slug])
      .filter(Boolean);
    const tagIds = (post.tags ?? [])
      .map(slug => tagIdMap[slug])
      .filter(Boolean);
    const featuredImageId = post.featuredImage
      ? mediaIdByFilename.get(post.featuredImage)
      : undefined;

    await nextly.create({
      collection: "posts",
      data: {
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        content: post.content,
        author: authorId || undefined,
        categories: categoryIds.length > 0 ? categoryIds : undefined,
        tags: tagIds.length > 0 ? tagIds : undefined,
        featured: post.featured ?? false,
        seo: post.seo,
        publishedAt: post.publishedAt,
        status: post.status,
        ...(featuredImageId ? { featuredImage: featuredImageId } : {}),
      },
    });
  }

  console.log("  Updating site settings...");
  try {
    await nextly.updateGlobal({
      slug: "site-settings",
      data: {
        title: seedData.siteSettings.siteName,
        siteName: seedData.siteSettings.siteName,
        tagline: seedData.siteSettings.tagline,
        siteDescription: seedData.siteSettings.siteDescription,
        social: seedData.siteSettings.social,
      },
    });
  } catch {
    console.log("  Could not update site settings (will be set up in admin).");
  }

  // Step 3: End-of-run summary
  const uploaded = outcomes.filter(o => "id" in o).length;
  const missed = outcomes.filter(
    (o): o is Extract<UploadOutcome, { miss: string }> => "miss" in o
  );
  const total = outcomes.length;

  console.log(
    `  Demo content loaded: ${seedData.posts.length} posts, ${seedData.authors.length} authors, ${seedData.categories.length} categories`
  );

  if (total === 0) {
    console.log("  Media: no media declared in seed-data.json.");
  } else if (missed.length === 0) {
    console.log(`  Media: ${uploaded}/${total} files seeded.`);
  } else {
    console.log(`  Media: ${uploaded}/${total} files seeded.`);
    console.log("  Skipped:");
    for (const m of missed) {
      const detail = m.detail ? `: ${m.detail}` : "";
      console.log(`    - ${m.miss} (${m.reason}${detail})`);
    }
    console.log(
      "  Content was still seeded; affected posts/authors will render without images."
    );
  }
}
