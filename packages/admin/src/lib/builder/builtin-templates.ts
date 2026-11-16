/**
 * The templates the Builder offers of its own, for each kind.
 *
 * Each passes the same check as a plugin's (`template-check`): a test runs
 * every one through it, so one that fails is fixed here, never exempted. None
 * adds a field named like the entity's built-in Title or Slug, which every
 * entity already has. Templates for pages designed visually come from the
 * plugin that makes such pages, not from here.
 *
 * @module lib/builder/builtin-templates
 */
import type { SchemaTemplate } from "./schema-templates";

export const BUILT_IN_TEMPLATES: readonly SchemaTemplate[] = [
  {
    id: "blog-posts",
    kind: "collection",
    category: "Content",
    name: "Blog posts",
    description: "Articles with an excerpt, a cover image, an author and tags.",
    icon: "Newspaper",
    fields: [
      { name: "excerpt", label: "Excerpt", type: "textarea" },
      { name: "cover_image", label: "Cover image", type: "upload" },
      { name: "body", label: "Body", type: "richText", required: true },
      {
        name: "author",
        label: "Author",
        type: "relationship",
        relationTo: "authors",
      },
      { name: "tags", label: "Tags", type: "chips" },
      { name: "published_on", label: "Published on", type: "date" },
    ],
  },
  {
    id: "authors",
    kind: "collection",
    category: "Content",
    name: "Authors",
    description: "People who write, with a photo, a short bio and an email.",
    icon: "User",
    fields: [
      { name: "photo", label: "Photo", type: "upload" },
      { name: "bio", label: "Bio", type: "textarea" },
      { name: "email", label: "Email", type: "email" },
    ],
  },
  {
    id: "products",
    kind: "collection",
    category: "Commerce",
    name: "Products",
    description: "Things for sale, with a price, a SKU, images and stock.",
    icon: "ShoppingBag",
    fields: [
      { name: "description", label: "Description", type: "richText" },
      { name: "price", label: "Price", type: "number", required: true },
      { name: "sku", label: "SKU", type: "text", unique: true },
      { name: "in_stock", label: "In stock", type: "checkbox" },
      {
        name: "images",
        label: "Images",
        type: "repeater",
        fields: [
          { name: "image", label: "Image", type: "upload" },
          { name: "alt", label: "Alternative text", type: "text" },
        ],
      },
    ],
  },
  {
    id: "site-settings",
    kind: "single",
    category: "Site",
    name: "Site settings",
    description: "The site's name, tagline, logo and contact email.",
    icon: "Settings",
    fields: [
      { name: "site_name", label: "Site name", type: "text", required: true },
      { name: "tagline", label: "Tagline", type: "text" },
      { name: "logo", label: "Logo", type: "upload" },
      { name: "contact_email", label: "Contact email", type: "email" },
    ],
  },
  {
    id: "home-page",
    kind: "single",
    category: "Site",
    name: "Home page",
    description: "A heading, an introduction and a call to action.",
    icon: "Home",
    fields: [
      { name: "heading", label: "Heading", type: "text", required: true },
      { name: "introduction", label: "Introduction", type: "richText" },
      {
        name: "call_to_action",
        label: "Call to action",
        type: "group",
        fields: [
          { name: "label", label: "Button label", type: "text" },
          { name: "link", label: "Link", type: "text" },
        ],
      },
    ],
  },
  {
    id: "seo",
    kind: "fieldGroup",
    category: "Content",
    name: "SEO",
    description: "A meta title, a meta description and a share image.",
    icon: "Search",
    fields: [
      { name: "meta_title", label: "Meta title", type: "text" },
      { name: "meta_description", label: "Meta description", type: "textarea" },
      { name: "share_image", label: "Share image", type: "upload" },
    ],
  },
  {
    id: "address",
    kind: "fieldGroup",
    category: "Contact",
    name: "Address",
    description: "A street address, city, postal code and country.",
    icon: "MapPin",
    fields: [
      { name: "street", label: "Street", type: "text" },
      { name: "city", label: "City", type: "text" },
      { name: "postal_code", label: "Postal code", type: "text" },
      { name: "country", label: "Country", type: "text" },
    ],
  },
];
