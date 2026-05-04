/**
 * Single source of truth for the blog template's schema.
 *
 * For code-first projects: this manifest documents the same schema that
 * `src/collections/*` and `src/globals/*` declare via `defineCollection`
 * / `defineSingle`. Phase A of the seed is skipped for these projects —
 * the user's `nextly.config.ts` already registered everything at boot.
 *
 * For visual-schema-builder projects: Phase A reads this manifest and
 * registers each collection / single via `dynamicCollectionService` /
 * `dynamicSingleService`. After Phase A, both approaches converge to the
 * same DB shape and Phase C can populate content uniformly.
 *
 * Edits MUST stay in sync with the corresponding TS files until we ship
 * a generator. Drift is caught at E2E time when a visual-approach project
 * runs the seed and a missing manifest field surfaces a registration
 * mismatch — track this as a known limitation until the generator lands.
 */

export interface ManifestField {
  name: string;
  type:
    | "text"
    | "textarea"
    | "richText"
    | "date"
    | "select"
    | "checkbox"
    | "number"
    | "upload"
    | "relationship"
    | "group"
    | "array";
  required?: boolean;
  unique?: boolean;
  hasMany?: boolean;
  relationTo?: string;
  defaultValue?: unknown;
  maxLength?: number;
  options?: Array<{ label: string; value: string }>;
  fields?: ManifestField[];
}

export interface ManifestCollection {
  slug: string;
  tableName: string;
  labels: { singular: string; plural: string };
  fields: ManifestField[];
}

export interface ManifestSingle {
  slug: string;
  tableName: string;
  label: string;
  fields: ManifestField[];
}

export interface ManifestUserExtension {
  name: string;
  type: ManifestField["type"];
  maxLength?: number;
}

export interface SchemaManifest {
  collections: ManifestCollection[];
  singles: ManifestSingle[];
  userExtensionFields: ManifestUserExtension[];
}

export const BLOG_SCHEMA_MANIFEST: SchemaManifest = {
  collections: [
    {
      slug: "posts",
      tableName: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "slug", type: "text", required: true, unique: true },
        { name: "content", type: "richText" },
        { name: "featuredImage", type: "upload", relationTo: "media" },
        { name: "author", type: "relationship", relationTo: "users" },
        {
          name: "categories",
          type: "relationship",
          relationTo: "categories",
          hasMany: true,
        },
        {
          name: "tags",
          type: "relationship",
          relationTo: "tags",
          hasMany: true,
        },
        { name: "excerpt", type: "textarea" },
        { name: "publishedAt", type: "date" },
        { name: "featured", type: "checkbox", defaultValue: false },
        {
          name: "seo",
          type: "group",
          fields: [
            { name: "metaTitle", type: "text" },
            { name: "metaDescription", type: "textarea" },
            { name: "ogImage", type: "upload", relationTo: "media" },
            { name: "canonical", type: "text" },
            { name: "noindex", type: "checkbox", defaultValue: false },
          ],
        },
        {
          name: "status",
          type: "select",
          defaultValue: "draft",
          options: [
            { label: "Draft", value: "draft" },
            { label: "Published", value: "published" },
          ],
        },
        { name: "readingTime", type: "number" },
        { name: "wordCount", type: "number" },
      ],
    },
    {
      slug: "categories",
      tableName: "categories",
      labels: { singular: "Category", plural: "Categories" },
      fields: [
        { name: "name", type: "text", required: true },
        { name: "slug", type: "text", required: true, unique: true },
        { name: "description", type: "textarea" },
      ],
    },
    {
      slug: "tags",
      tableName: "tags",
      labels: { singular: "Tag", plural: "Tags" },
      fields: [
        { name: "name", type: "text", required: true },
        { name: "slug", type: "text", required: true, unique: true },
        { name: "description", type: "textarea" },
      ],
    },
  ],
  singles: [
    {
      slug: "site-settings",
      tableName: "site_settings",
      label: "Site Settings",
      fields: [
        { name: "siteName", type: "text", required: true },
        { name: "tagline", type: "text" },
        { name: "siteDescription", type: "textarea" },
        { name: "logo", type: "upload", relationTo: "media" },
        {
          name: "social",
          type: "group",
          fields: [
            { name: "twitter", type: "text" },
            { name: "github", type: "text" },
            { name: "linkedin", type: "text" },
          ],
        },
      ],
    },
    {
      slug: "navigation",
      tableName: "navigation",
      label: "Navigation",
      fields: [
        {
          name: "headerLinks",
          type: "array",
          fields: [
            { name: "label", type: "text", required: true },
            { name: "href", type: "text", required: true },
            { name: "openInNewTab", type: "checkbox", defaultValue: false },
          ],
        },
        {
          name: "footerReadLinks",
          type: "array",
          fields: [
            { name: "label", type: "text", required: true },
            { name: "href", type: "text", required: true },
          ],
        },
        { name: "showThemeToggle", type: "checkbox", defaultValue: true },
        { name: "showSearchIcon", type: "checkbox", defaultValue: true },
      ],
    },
    {
      slug: "homepage",
      tableName: "homepage",
      label: "Homepage",
      fields: [
        { name: "heroTitle", type: "text", required: true },
        { name: "heroSubtitle", type: "textarea" },
        { name: "showFeaturedPost", type: "checkbox", defaultValue: true },
        {
          name: "featuredSectionTitle",
          type: "text",
          defaultValue: "Featured",
        },
        { name: "showLatestPosts", type: "checkbox", defaultValue: true },
        { name: "latestSectionTitle", type: "text", defaultValue: "Latest" },
        { name: "latestPostsCount", type: "number", defaultValue: 3 },
        { name: "showCategoryStrip", type: "checkbox", defaultValue: true },
        { name: "showNewsletterCta", type: "checkbox", defaultValue: true },
        {
          name: "newsletterHeading",
          type: "text",
          defaultValue: "Get new posts in your inbox",
        },
        {
          name: "newsletterSubheading",
          type: "text",
          defaultValue: "No spam. Unsubscribe anytime.",
        },
      ],
    },
  ],
  userExtensionFields: [
    { name: "bio", type: "textarea", maxLength: 500 },
    { name: "avatarUrl", type: "text" },
    { name: "slug", type: "text" },
  ],
};
