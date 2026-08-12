import type { RegistryPlugin } from "./types";

/**
 * The curated catalogue. Array order is the grid's default order.
 *
 * Scope: packages that call `definePlugin` and therefore appear in
 * `plugins: [...]`. The `storage-*` packages are deliberately absent. They are
 * storage adapters configured through `storage:` rather than plugins, they
 * never appear in `branding.plugins`, and listing them in a plugin directory
 * would tell a user to install them the wrong way.
 *
 * Descriptions are copied from each plugin's own `definePlugin` declaration so
 * the catalogue and the installed detail page say the same thing. Where a
 * plugin declares none, the text here is the one being added to the plugin in
 * the same change rather than a second, drifting copy.
 *
 * @module lib/plugins/registry/entries
 */
export const REGISTRY_ENTRIES: RegistryPlugin[] = [
  {
    id: "@nextlyhq/plugin-page-builder",
    name: "Page Builder",
    description: "Build pages visually from blocks with drag-and-drop editing",
    author: "Nextly",
    category: "content",
    tags: ["blocks", "editor", "pages"],
    icon: { lucide: "LayoutTemplate" },
    install: {
      package: "@nextlyhq/plugin-page-builder",
      configSnippet: "plugins: [pageBuilder()]",
    },
    links: {
      homepage: "https://nextlyhq.com",
      repository: "https://github.com/nextlyhq/nextly",
    },
  },
  {
    id: "@nextlyhq/plugin-form-builder",
    name: "Form Builder",
    description: "Create and manage forms with submission tracking",
    author: "Nextly",
    category: "forms",
    tags: ["forms", "submissions"],
    icon: { lucide: "ClipboardList" },
    install: {
      package: "@nextlyhq/plugin-form-builder",
      configSnippet: "plugins: [formBuilder()]",
    },
    links: {
      homepage: "https://nextlyhq.com",
      repository: "https://github.com/nextlyhq/nextly",
    },
  },
  {
    id: "@nextlyhq/plugin-seo",
    name: "SEO",
    description:
      "Add an SEO meta field group to your collections, with title, description and social preview fields",
    author: "Nextly",
    category: "seo",
    tags: ["seo", "meta"],
    icon: { lucide: "Search" },
    install: {
      package: "@nextlyhq/plugin-seo",
      configSnippet: "plugins: [seo()]",
    },
    links: {
      homepage: "https://nextlyhq.com",
      repository: "https://github.com/nextlyhq/nextly",
    },
  },
];
