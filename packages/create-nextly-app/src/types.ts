/**
 * Project type / template selection.
 * "blog" is the first content template added for alpha.
 */
export type ProjectType = "blank" | "blog";

/**
 * Schema approach selection for content templates.
 * - code-first: Full schema definitions in nextly.config.ts (like Payload CMS)
 * - visual: Empty config, schemas created via Admin Panel UI (like Strapi/WordPress)
 * - both: Core schemas in code, additional schemas creatable via Admin Panel
 */
export type ProjectApproach = "code-first" | "visual" | "both";

/**
 * Template manifest structure (matches template.json files).
 * Each template directory contains a template.json with this shape.
 */
export interface TemplateManifest {
  name: string;
  label: string;
  description: string;
  hint: string;
  approaches: ProjectApproach[];
  defaultApproach: ProjectApproach | null;
  collections: string[];
  singles: string[];
  hasDemoData: boolean;
  hasFrontendPages: boolean;
  recommendedDatabase: string;
  release: string;
}

/**
 * Supported database types
 */
export type DatabaseType = "postgresql" | "mysql" | "sqlite";

/**
 * Supported package managers
 */
export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * Database configuration for scaffolding
 */
export interface DatabaseConfig {
  type: DatabaseType;
  adapter: string;
  /** Database driver peer dependency (e.g., pg, better-sqlite3, mysql2) */
  databaseDriver: string;
  connectionUrl: string;
  envExample: string;
}

/**
 * Detected project information
 */
export interface ProjectInfo {
  isNextJs: boolean;
  isAppRouter: boolean;
  hasTypescript: boolean;
  packageManager: PackageManager;
  nextVersion: string | null;
  srcDir: boolean;
  appDir: string;
}

/**
 * Options for createNextly function
 */
export interface CreateNextlyOptions {
  /** Working directory (defaults to process.cwd()) */
  cwd?: string;
  /** Skip interactive prompts and use defaults */
  defaults?: boolean;
  /** Pre-selected project type / template name */
  projectType?: ProjectType;
  /** Pre-selected database type */
  database?: DatabaseType;
  /** Skip dependency installation (useful for local testing before packages are published) */
  skipInstall?: boolean;
  /** Use yalc for local package installation (for testing before npm publish) */
  useYalc?: boolean;
  /**
   * Project name derived from the CLI's positional `[directory]` argument.
   * Must be a bare directory name (no slashes). Callers pass the basename
   * of the user-provided argument.
   */
  projectNameFromArg?: string;
  /**
   * When true, the CLI was invoked with "." meaning "install in current directory".
   * Different from projectNameFromArg which creates a subdirectory.
   */
  installInCwd?: boolean;
  /** Schema approach for content templates (code-first, visual, both) */
  approach?: ProjectApproach;
  /** Include demo content when scaffolding a content template */
  demoData?: boolean;
  /** Path to local templates directory (for development, bypasses GitHub download) */
  localTemplatePath?: string;
  /** Git branch for template download from GitHub (defaults to "main") */
  branch?: string;
}

/**
 * Result of environment file generation
 */
export interface EnvGenerationResult {
  created: boolean;
  updated: boolean;
}
