/**
 * Template Registry
 *
 * Hardcoded list of available templates. When a new template is added
 * to /templates/ in the monorepo, add an entry here too. The CLI uses
 * this registry to show template options in the interactive prompt and
 * to validate --template flag values.
 */

import type { ProjectApproach, TemplateManifest } from "../types.js";

import { BUNDLED_TEMPLATES } from "./bundled-templates";

// All available templates - ordered as they appear in the CLI prompt
export const AVAILABLE_TEMPLATES: readonly TemplateManifest[] = [
  {
    name: "blank",
    label: "Blank",
    description: "Start fresh with an empty config",
    hint: "Empty project, define your own schemas",
    approaches: [],
    defaultApproach: null,
    collections: [],
    singles: [],
    hasDemoData: false,
    hasFrontendPages: true,
    recommendedDatabase: "any",
    release: "alpha",
  },
  {
    name: "blog",
    label: "Blog",
    description: "A complete blog with posts, authors, and categories",
    hint: "Posts, authors, categories, clean design",
    approaches: ["code-first", "visual"],
    defaultApproach: "code-first",
    collections: ["posts", "authors", "categories"],
    singles: ["site-settings"],
    hasDemoData: true,
    hasFrontendPages: true,
    recommendedDatabase: "any",
    release: "alpha",
  },
  {
    name: "plugin",
    label: "Plugin",
    description: "Build a reusable Nextly plugin (publishable npm package)",
    hint: "Plugin package + embedded /dev playground; no schema approach",
    // Plugins don't ask code-first vs visual, ship no app frontend, and bring
    // their own collections — they are a publishable library, not an app.
    approaches: [],
    defaultApproach: null,
    collections: [],
    singles: [],
    hasDemoData: false,
    hasFrontendPages: false,
    recommendedDatabase: "sqlite",
    release: "alpha",
  },
] as const;

/**
 * Look up a template by name. Returns undefined if not found.
 */
export function getTemplate(name: string): TemplateManifest | undefined {
  return AVAILABLE_TEMPLATES.find(t => t.name === name);
}

/**
 * Get all valid template names for CLI validation.
 */
export function getAvailableTemplateNames(): string[] {
  return AVAILABLE_TEMPLATES.map(t => t.name);
}

/**
 * Check if a template supports approach selection.
 * Templates with empty approaches array (like blank) skip the approach prompt.
 */
export function templateHasApproaches(name: string): boolean {
  const template = getTemplate(name);
  return !!template && template.approaches.length > 0;
}

/**
 * Check if a template supports demo data.
 */
export function templateHasDemoData(name: string): boolean {
  const template = getTemplate(name);
  return !!template && template.hasDemoData;
}

/**
 * Get the default approach for a template.
 * Returns "code-first" if the template has no default set.
 */
export function getDefaultApproach(name: string): ProjectApproach {
  const template = getTemplate(name);
  return template?.defaultApproach ?? "code-first";
}

/**
 * Whether a scaffold should copy the template bundled in the CLI rather than
 * resolve one from GitHub or a local path.
 *
 * The bundled copy works offline and matches the package versions this CLI
 * release installs, where a template downloaded from GitHub `main` can already
 * use APIs those packages do not have. An explicit source (--local-template,
 * --use-yalc, or any --branch, `main` included) still resolves live, because
 * the bundled copy would quietly ignore what was asked for.
 */
export function shouldUseBundledTemplate(
  projectType: string,
  options: {
    localTemplatePath?: string;
    useYalc?: boolean;
    branch?: string;
  }
): boolean {
  return (
    BUNDLED_TEMPLATES.some(name => name === projectType) &&
    !options.localTemplatePath &&
    !options.useYalc &&
    options.branch === undefined
  );
}
