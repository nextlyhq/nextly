/**
 * Template Registry
 *
 * Hardcoded list of available templates. When a new template is added
 * to /templates/ in the monorepo, add an entry here too. The CLI uses
 * this registry to show template options in the interactive prompt and
 * to validate --template flag values.
 */

import type { ProjectApproach, TemplateManifest } from "../types.js";

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
 * Templates whose files ship inside the CLI package itself (copied by the
 * build; see tsup.config.ts). Content templates (blog) are download-only.
 */
const BUNDLED_TEMPLATES: ReadonlySet<string> = new Set(["blank", "plugin"]);

/**
 * Decide whether a scaffold should use the CLI-bundled copy of a template
 * instead of resolving one from GitHub or a local path.
 *
 * Bundled copies keep offline scaffolds working and always match the
 * installed CLI's package versions (a GitHub-main template can drift ahead
 * of the npm packages the scaffold installs). Any explicit source override
 * — --local-template, --use-yalc, or a non-main --branch — forces live
 * resolution so development workflows pair live templates with local
 * packages and users can scaffold from release branches.
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
    BUNDLED_TEMPLATES.has(projectType) &&
    !options.localTemplatePath &&
    !options.useYalc &&
    (options.branch ?? "main") === "main"
  );
}
