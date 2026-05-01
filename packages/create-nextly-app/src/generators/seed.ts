import path from "path";

import fs from "fs-extra";

// Note: This file is currently unused (Schema Builder mode and blog/ecommerce
// templates have been removed). Kept for future template re-introduction.

// ============================================================
// Seed Templates — Schema Builder Mode
// ============================================================
//
// When the user selects "Schema Builder" mode, collections and singles are NOT
// defined in nextly.config.ts. Instead, a nextly.seed.ts file is generated
// that creates them in the database as unlocked (editable) entries.
//
// Seeding (in current architecture, task 24 phase 3) is invoked from a
// project-local auth-gated POST route at /admin/api/seed — no longer
// from the CLI. Schema Builder reintroduction may revisit this.

/**
 * Blog CMS seed template.
 *
 * Creates: posts, categories collections + blog-settings single.
 */
const BLOG_SEED = `import { container } from "@revnixhq/nextly";

/**
 * Seed blog collections and singles into the database.
 *
 * These are created as UI-editable entries — you can modify fields,
 * add new collections, or delete them via the admin dashboard.
 *
 * Run: npm run db:setup
 */
export default async function seed() {
  const collectionRegistry = container.get<any>("collectionRegistryService");
  const singleRegistry = container.get<any>("singleRegistryService");

  // ── Posts collection ────────────────────────────────────────────────────
  try {
    await collectionRegistry.registerCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      tableName: "posts",
      fields: [
        // Note: "title" and "slug" are auto-generated system columns
        { name: "content", type: "richText" },
        { name: "author", type: "relationship", relationTo: "users" },
        {
          name: "categories",
          type: "relationship",
          relationTo: "categories",
          hasMany: true,
        },
        {
          name: "status",
          type: "select",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Published", value: "published" },
          ],
          defaultValue: "draft",
        },
        { name: "publishedAt", type: "date" },
      ],
      source: "ui",
      locked: false,
    });
    console.log("  Created collection: posts");
  } catch (e: any) {
    if (e?.code === "DUPLICATE_KEY") {
      console.log("  Collection already exists: posts");
    } else {
      throw e;
    }
  }

  // ── Categories collection ───────────────────────────────────────────────
  try {
    await collectionRegistry.registerCollection({
      slug: "categories",
      labels: { singular: "Category", plural: "Categories" },
      tableName: "categories",
      fields: [
        // Note: "title" and "slug" are auto-generated system columns
        { name: "name", type: "text", required: true },
        { name: "description", type: "text" },
      ],
      source: "ui",
      locked: false,
    });
    console.log("  Created collection: categories");
  } catch (e: any) {
    if (e?.code === "DUPLICATE_KEY") {
      console.log("  Collection already exists: categories");
    } else {
      throw e;
    }
  }

  // ── Blog Settings single ────────────────────────────────────────────────
  try {
    await singleRegistry.registerSingle({
      slug: "blog-settings",
      label: "Blog Settings",
      tableName: "blog-settings",
      fields: [
        { name: "blogTitle", type: "text", required: true, label: "Blog Title" },
        { name: "tagline", type: "text", label: "Tagline" },
        { name: "postsPerPage", type: "number", defaultValue: 10 },
      ],
      source: "ui",
      locked: false,
    });
    console.log("  Created single: blog-settings");
  } catch (e: any) {
    if (e?.code === "DUPLICATE_KEY") {
      console.log("  Single already exists: blog-settings");
    } else {
      throw e;
    }
  }
}
`;

/**
 * E-commerce seed template (placeholder for future).
 */
const ECOMMERCE_SEED = `import { container } from "@revnixhq/nextly";

export default async function seed() {
  const collectionRegistry = container.get<any>("collectionRegistryService");
  const singleRegistry = container.get<any>("singleRegistryService");

  // ── Products collection ─────────────────────────────────────────────────
  try {
    await collectionRegistry.registerCollection({
      slug: "products",
      labels: { singular: "Product", plural: "Products" },
      tableName: "products",
      fields: [
        // Note: "title" and "slug" are auto-generated system columns
        { name: "name", type: "text", required: true },
        { name: "description", type: "text" },
        { name: "price", type: "number", required: true },
        { name: "compareAtPrice", type: "number" },
        { name: "inventory", type: "number", defaultValue: 0 },
        { name: "category", type: "relationship", relationTo: "product-categories" },
        { name: "featured", type: "checkbox", defaultValue: false },
        {
          name: "status",
          type: "select",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Active", value: "active" },
            { label: "Archived", value: "archived" },
          ],
          defaultValue: "draft",
        },
      ],
      source: "ui",
      locked: false,
    });
    console.log("  Created collection: products");
  } catch (e: any) {
    if (e?.code === "DUPLICATE_KEY") {
      console.log("  Collection already exists: products");
    } else {
      throw e;
    }
  }

  // ── Product Categories collection ───────────────────────────────────────
  try {
    await collectionRegistry.registerCollection({
      slug: "product-categories",
      labels: { singular: "Product Category", plural: "Product Categories" },
      tableName: "product_categories",
      fields: [
        // Note: "title" and "slug" are auto-generated system columns
        { name: "name", type: "text", required: true },
        { name: "description", type: "text" },
      ],
      source: "ui",
      locked: false,
    });
    console.log("  Created collection: product-categories");
  } catch (e: any) {
    if (e?.code === "DUPLICATE_KEY") {
      console.log("  Collection already exists: product-categories");
    } else {
      throw e;
    }
  }

  // ── Store Settings single ───────────────────────────────────────────────
  try {
    await singleRegistry.registerSingle({
      slug: "store-settings",
      label: "Store Settings",
      tableName: "store-settings",
      fields: [
        { name: "storeName", type: "text", required: true, label: "Store Name" },
        { name: "currency", type: "text", defaultValue: "USD" },
        { name: "contactEmail", type: "text", label: "Contact Email" },
      ],
      source: "ui",
      locked: false,
    });
    console.log("  Created single: store-settings");
  } catch (e: any) {
    if (e?.code === "DUPLICATE_KEY") {
      console.log("  Single already exists: store-settings");
    } else {
      throw e;
    }
  }
}
`;

// Seed templates for future project types (blog, ecommerce).
// These are not currently used since those templates have been removed,
// but kept for when they are re-introduced.
const SEED_TEMPLATES: Record<string, string> = {
  blog: BLOG_SEED,
  ecommerce: ECOMMERCE_SEED,
};

// ============================================================
// Public API
// ============================================================

/**
 * Generate a nextly.seed.ts file for Schema Builder mode.
 *
 * The seed file creates collections and singles in the database as
 * unlocked entries that can be edited via the admin dashboard.
 *
 * @param cwd - Working directory
 * @param projectType - Selected project type (blog, ecommerce, etc.)
 * @returns true if seed file was generated, false if no template for this type
 */
export async function generateSeedFile(
  cwd: string,
  projectType: string
): Promise<boolean> {
  const template = SEED_TEMPLATES[projectType];
  if (!template) return false;

  const seedPath = path.join(cwd, "nextly.seed.ts");
  await fs.writeFile(seedPath, template, "utf-8");
  return true;
}
