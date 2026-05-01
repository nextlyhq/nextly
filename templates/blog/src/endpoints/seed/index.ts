/**
 * Blog Template Seed Script (Payload-style)
 *
 * Exports a `seed({ nextly })` function that populates demo content
 * (roles, posts, categories, tags, navigation, site-settings,
 * homepage, newsletter form). Triggered from the auth-gated POST
 * route at `src/app/admin/api/seed/route.ts` — the route validates
 * the caller has a super-admin session, then constructs an
 * authenticated Nextly instance and passes it here. Idempotent —
 * safe to re-run.
 *
 * Media files resolve local-first, then from a configurable GitHub
 * base URL as fallback, with per-file failures captured in an
 * end-of-run summary.
 *
 * The {{approach}} placeholder is replaced by the CLI during
 * scaffolding.
 */

import fs from "fs";
import path from "path";

import type { Nextly } from "@revnixhq/nextly";

// Role definitions for the three content roles the blog template seeds.
// Inlined (rather than imported from a sibling file) because the CLI
// only copies `seed-data.json` and `media/` from the template's seed/
// folder into the scaffolded project - arbitrary .ts files under seed/
// do not survive scaffolding. Keeping the role seed here means it
// ships end-to-end.
//
// Fine-grained permissions are intentionally not assigned on these
// roles. Permissions auto-generate when collections register and are
// wired to the `super-admin` role on first boot. Configure per-role
// permissions via the admin UI at /admin/roles/<slug> or with
// nextly.roles.setPermissions({...}).
const TEMPLATE_ROLES = [
  {
    slug: "admin",
    name: "Administrator",
    description:
      "Full access to all content, taxonomy, media, and user management.",
    level: 100,
  },
  {
    slug: "editor",
    name: "Editor",
    description:
      "Can create, edit, and publish any post. Manages categories, tags, and media.",
    level: 50,
  },
  {
    slug: "author",
    name: "Author",
    description:
      "Can draft and edit their own posts. Reads published posts and taxonomy.",
    level: 10,
  },
] as const;

/**
 * Pick permission IDs appropriate for each role. Fetches the catalog of
 * auto-generated collection/single permissions (registered by Nextly
 * during collection sync) and slices it per role scope.
 *
 * - admin: every permission in the system (broad default - tighten via
 *   /admin/roles/<slug> after seeding).
 * - editor: content + media permissions.
 * - author: posts + media (create/read) and read-only access to the
 *   content taxonomy.
 *
 * Returns an empty array if fetching permissions fails; callers still
 * get a "at least one permission required" error from the core service
 * in that case and the role will be skipped with a warning.
 */
async function pickPermissionIdsForRoles(
  nextly: Nextly
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = { admin: [], editor: [], author: [] };
  try {
    const all = await nextly.permissions.find({ limit: 500 });
    const perms = all.docs;
    out.admin = perms.map(p => (p as { id: string }).id);
    out.editor = perms
      .filter(p => {
        const resource = (p as { resource?: string }).resource;
        return (
          resource === "posts" ||
          resource === "categories" ||
          resource === "tags" ||
          resource === "media" ||
          resource === "form-submissions"
        );
      })
      .map(p => (p as { id: string }).id);
    out.author = perms
      .filter(p => {
        const resource = (p as { resource?: string }).resource;
        const action = (p as { action?: string }).action;
        if (resource === "posts" || resource === "media") return true;
        if (
          (resource === "categories" || resource === "tags") &&
          action === "read"
        ) {
          return true;
        }
        return false;
      })
      .map(p => (p as { id: string }).id);
  } catch (err) {
    console.log(
      `  Warning: could not list permissions: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return out;
}

async function seedRoles(
  nextly: Nextly
): Promise<Record<string, string>> {
  const roleIdBySlug: Record<string, string> = {};

  // First pass: find any existing roles by listing.
  try {
    const existing = await nextly.roles.find({ limit: 100, page: 1 });
    for (const role of TEMPLATE_ROLES) {
      const match = existing.docs.find(
        r => (r as { slug?: string }).slug === role.slug
      );
      if (match) roleIdBySlug[role.slug] = (match as { id: string }).id;
    }
  } catch (err) {
    console.log(
      `  Warning: could not list roles: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Second pass: create any roles that weren't found. Pass through the
  // curated permission-ID list so the core validator
  // ("At least one permission is required to create a role") is
  // satisfied. Requires the Direct API to forward permissionIds through
  // `data.permissionIds` (wired up in packages/nextly Direct API rbac
  // namespace).
  const rolePermissionIds = await pickPermissionIdsForRoles(nextly);
  for (const role of TEMPLATE_ROLES) {
    if (roleIdBySlug[role.slug]) continue;
    const permissionIds = rolePermissionIds[role.slug] ?? [];
    if (permissionIds.length === 0) {
      console.log(
        `  Warning: no permissions resolved for "${role.slug}", skipping. ` +
          "Create the role via /admin/roles and re-run the seed."
      );
      continue;
    }
    try {
      const created = await nextly.roles.create({
        data: {
          name: role.name,
          slug: role.slug,
          description: role.description,
          level: role.level,
          permissionIds,
        },
      });
      roleIdBySlug[role.slug] = created.id as string;
      console.log(
        `  Seeded role: ${role.slug} (${permissionIds.length} permissions)`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  Warning: could not create role "${role.slug}": ${msg}. ` +
          "Create it via /admin/roles and re-run the seed."
      );
    }
  }

  return roleIdBySlug;
}

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
    /**
     * Role slug to assign. Must match a role seeded by `seedRoles`
     * (`admin`, `editor`, or `author`). Missing role silently falls
     * through without assignment - the user still exists but has
     * no content role.
     */
    role?: "admin" | "editor" | "author";
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
  navigation?: {
    headerLinks?: Array<{
      label: string;
      href: string;
      openInNewTab?: boolean;
    }>;
    footerReadLinks?: Array<{ label: string; href: string }>;
    showThemeToggle?: boolean;
    showSearchIcon?: boolean;
  };
  homepage?: {
    heroTitle?: string;
    heroSubtitle?: string;
    showFeaturedPost?: boolean;
    featuredSectionTitle?: string;
    showLatestPosts?: boolean;
    latestSectionTitle?: string;
    latestPostsCount?: number;
    showCategoryStrip?: boolean;
    showNewsletterCta?: boolean;
    newsletterHeading?: string;
    newsletterSubheading?: string;
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
  // Local disk first. Co-located with this file under
  // src/endpoints/seed/media after Task 24 phase 3.
  const localPath = path.join(
    process.cwd(),
    "src",
    "endpoints",
    "seed",
    "media",
    filename
  );
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
  nextly: Nextly,
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
  nextly: Nextly,
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
 * Main seed function. Invoked from the auth-gated POST route at
 * `src/app/admin/api/seed/route.ts`. Receives a Nextly instance the
 * route has already initialised with `{ config }` and a verified
 * super-admin session.
 */
export async function seed({ nextly }: { nextly: Nextly }): Promise<void> {
  // Both `seed-data.json` and `media/` ship colocated with this file.
  // We read them at runtime (not via import) so the same code path
  // works in dev (where Next.js doesn't bundle filesystem reads) and
  // in production builds (where they're copied as static assets).
  const seedDataPath = path.join(
    process.cwd(),
    "src",
    "endpoints",
    "seed",
    "seed-data.json"
  );
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

  // Step 2a: Seed roles first so user creation can assign them.
  console.log("  Seeding roles...");
  const roleIdBySlug = await seedRoles(nextly);

  // Step 2b: Create content entries, linking media IDs where we have them.
  console.log("  Creating users...");
  const userIdMap: Record<string, string> = {};
  for (const user of seedData.users) {
    // Idempotency: look up by email via the dedicated users namespace.
    // `nextly.find({ collection: "users" })` routes through the dynamic
    // collections path (which only knows about user-defined collections
    // like dc_posts) and throws "schema not found"; users is a core
    // collection with its own query namespace.
    const existing = await nextly.users.findOne({ search: user.email });
    // Build role IDs array if seed-data declares one. Nextly's user
    // mutation service accepts `roles: string[]` in the create/update
    // payload and handles the `user_roles` join rows automatically.
    const roleSlug = user.role;
    const roleIds =
      roleSlug && roleIdBySlug[roleSlug] ? [roleIdBySlug[roleSlug]] : [];

    let userId: string;
    if (existing) {
      userId = existing.id as string;
      if (roleIds.length > 0) {
        // Re-running seed against an existing user: update roles.
        // Wrapped in try/catch so a role-assignment failure doesn't
        // block the rest of the seed.
        try {
          await nextly.users.update({
            id: userId,
            data: { roles: roleIds },
          });
        } catch (err) {
          console.log(
            `  Warning: could not update role "${roleSlug}" on ${user.email}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } else {
      const created = await nextly.users.create({
        email: user.email,
        password: user.password,
        data: {
          name: user.name,
          slug: user.slug,
          bio: user.bio,
          avatarUrl: resolveAvatarUrl(user.avatarUrl),
          ...(roleIds.length > 0 ? { roles: roleIds } : {}),
        },
      });
      userId = created.id as string;
    }
    userIdMap[user.slug] = userId;
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

  // Navigation single: seed default link arrays + UI toggles. Wrapped in
  // try/catch since Single DDL may not have landed on every install path
  // (see findings/task-17-sub-6-schema-resolver-known-issues.md).
  if (seedData.navigation) {
    console.log("  Updating navigation...");
    try {
      await nextly.updateGlobal({
        slug: "navigation",
        data: seedData.navigation,
      });
    } catch {
      console.log(
        "  Could not update navigation (edit in admin under Singles / Navigation)."
      );
    }
  }

  // Homepage single: hero copy + section visibility toggles. Same
  // try/catch rationale as navigation above.
  if (seedData.homepage) {
    console.log("  Updating homepage...");
    try {
      await nextly.updateGlobal({
        slug: "homepage",
        data: seedData.homepage,
      });
    } catch {
      console.log(
        "  Could not update homepage (edit in admin under Singles / Homepage)."
      );
    }
  }

  // Newsletter form: seed via the form-builder plugin. The frontend
  // NewsletterCta component submits to `form-submissions` referencing
  // this form's id. Wrapped in try/catch because the plugin's forms
  // collection may not be registered on every install path.
  console.log("  Seeding Newsletter form...");
  try {
    const existing = await nextly.find({
      collection: "forms",
      where: { slug: { equals: "newsletter" } },
      limit: 1,
    });
    if (existing.totalDocs === 0) {
      // Payload shape: the form-builder plugin's `forms` collection has
      // top-level `name` (required, internal), `slug` (required, unique),
      // `fields` (required, JSON array of field configs), `status`
      // (defaults to "draft" — must be "published" to accept submissions),
      // and a `settings` group for submit button text, confirmation type
      // and success message. Earlier versions of this seed used
      // `title`/`submitButtonLabel`/`confirmationMessage` at the top
      // level, which tripped the collection's NOT NULL constraint on
      // `name` with the opaque error "Missing required field: 'name'
      // cannot be empty".
      await nextly.create({
        collection: "forms",
        data: {
          // `title` is auto-injected as a NOT NULL column by Nextly's
          // runtime-schema-generator for any dynamic collection that does
          // not define its own `title` field. The form-builder plugin's
          // forms collection uses `name` for the internal label, so the
          // `title` column has no corresponding field definition and must
          // be populated explicitly. Without this, the insert fails with
          // "Missing required field: 'title' cannot be empty".
          title: "Newsletter",
          name: "Newsletter",
          slug: "newsletter",
          status: "published",
          fields: [
            {
              blockType: "text",
              name: "name",
              label: "Name",
              required: false,
              width: 50,
            },
            {
              blockType: "email",
              name: "email",
              label: "Email",
              required: true,
              width: 50,
            },
          ],
          settings: {
            submitButtonText: "Subscribe",
            confirmationType: "message",
            successMessage:
              "Thanks for subscribing! We'll be in touch.",
          },
        },
      });
      console.log("  Newsletter form created.");
    }
  } catch (err) {
    console.log(
      `  Could not seed Newsletter form: ${err instanceof Error ? err.message : String(err)}`
    );
    console.log(
      "  Create it manually at /admin/collections/forms with slug 'newsletter'."
    );
  }

  // Step 3: End-of-run summary
  const uploaded = outcomes.filter(o => "id" in o).length;
  const missed = outcomes.filter(
    (o): o is Extract<UploadOutcome, { miss: string }> => "miss" in o
  );
  const total = outcomes.length;

  // `authors` was renamed to `users` in the users-as-authors migration
  // (Task 17). Old field name lingered here and threw
  //   TypeError: Cannot read properties of undefined (reading 'length')
  // which was swallowed by the silent errorLog inside seedAll and surfaced
  // only as the opaque "Seeding failed with 1 error(s)".
  console.log(
    `  Demo content loaded: ${seedData.posts.length} posts, ${seedData.users.length} users, ${seedData.categories.length} categories`
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
