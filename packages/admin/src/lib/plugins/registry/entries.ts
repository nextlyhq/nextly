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
 * Every value here describes a plugin that may not be installed, so it is a
 * curated claim rather than an observation. Where the plugin IS installed, its
 * own metadata wins: render through `resolveCataloguePresentation` rather than
 * reading `description` or `icon` off an entry directly, or the same plugin
 * will show one face on a browse card and another in the installed list.
 *
 * The icons and descriptions here still match what each plugin declares, so
 * the not-installed preview is honest about what a user will get. Keep them
 * matching when a plugin changes its own; the precedence rule stops a
 * mismatch being VISIBLE, it does not stop the preview being wrong.
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
    icon: { lucide: "Layout" },
    configSnippet: "plugins: [pageBuilder()]",
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
    icon: { lucide: "FileText" },
    // `formBuilderPlugin`, not `formBuilder()`: the factory returns a
    // FormBuilderPluginResult whose definition is at `.plugin`, and the package
    // exports the unwrapped value for exactly this use.
    configSnippet: "plugins: [formBuilderPlugin]",
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
    // `seoPlugin`, and `collections` is required: the plugin adds the SEO group
    // only to the collections it is given, so a bare call does not type-check.
    configSnippet: 'plugins: [seoPlugin({ collections: ["posts"] })]',
    links: {
      homepage: "https://nextlyhq.com",
      repository: "https://github.com/nextlyhq/nextly",
    },
  },
];
