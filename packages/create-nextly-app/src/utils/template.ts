import path from "path";
import { fileURLToPath } from "url";

import fs from "fs-extra";

import type { DatabaseConfig, ProjectApproach, ProjectType } from "../types";

// ============================================================
// Text File Extensions (for placeholder replacement)
// ============================================================

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".env",
  ".md",
  ".css",
  ".html",
  ".mjs",
  ".cjs",
]);

/**
 * Files to skip during template copy.
 */
const SKIP_FILES = new Set([".DS_Store", "Thumbs.db", ".gitkeep"]);

// ============================================================
// Template Path Resolution
// ============================================================

/**
 * Resolve the path to the templates directory.
 *
 * Resolution order:
 * 1. Explicit localTemplatePath (--local-template flag, for development)
 * 2. Bundled templates in the package (fallback for blank template)
 *
 * For content templates (blog, etc.), the CLI downloads templates from
 * GitHub Codeload at runtime. This function is used for bundled/local
 * template resolution only.
 *
 * @param localTemplatePath - Optional explicit path (from --local-template flag)
 */
export function resolveTemplatePath(localTemplatePath?: string): string {
  // If a local template path is explicitly provided (for development), use it
  if (localTemplatePath) {
    if (fs.existsSync(localTemplatePath)) {
      return localTemplatePath;
    }
    throw new Error(
      `Local templates directory not found at ${localTemplatePath}. Check the --local-template path.`
    );
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // From dist/ -> ../templates/ (bundled fallback in published package)
  const fromDist = path.resolve(__dirname, "../templates");
  if (fs.existsSync(fromDist)) {
    return fromDist;
  }

  // From src/utils/ -> ../../templates/ (development without build)
  const fromSrc = path.resolve(__dirname, "../../templates");
  if (fs.existsSync(fromSrc)) {
    return fromSrc;
  }

  throw new Error(
    "Could not find templates directory. Use --local-template to specify the templates path, or ensure templates are bundled."
  );
}

// ============================================================
// Placeholder Replacement
// ============================================================

/**
 * Build the placeholder map from user selections.
 */
function buildPlaceholderMap(options: {
  database: DatabaseConfig;
  databaseUrl?: string;
}): Record<string, string> {
  const { database, databaseUrl } = options;

  return {
    "{{databaseDialect}}": database.type,
    "{{databaseUrl}}": databaseUrl || database.envExample,
  };
}

/**
 * Replace `{{placeholder}}` markers in a file's content.
 * Only processes text files; skips binary files.
 */
async function replacePlaceholdersInFile(
  filePath: string,
  placeholders: Record<string, string>
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  // .env.example has no extension from extname — check basename
  const basename = path.basename(filePath);

  const isTextFile =
    TEXT_EXTENSIONS.has(ext) ||
    basename.startsWith(".env") ||
    basename === ".gitignore";

  if (!isTextFile) return;

  let content = await fs.readFile(filePath, "utf-8");
  let changed = false;

  for (const [placeholder, value] of Object.entries(placeholders)) {
    if (content.includes(placeholder)) {
      content = content.replaceAll(placeholder, value);
      changed = true;
    }
  }

  if (changed) {
    await fs.writeFile(filePath, content, "utf-8");
  }
}

/**
 * Replace placeholders in all files within a directory (recursive).
 */
async function replacePlaceholders(
  dir: string,
  placeholders: Record<string, string>
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await replacePlaceholders(fullPath, placeholders);
    } else if (entry.isFile()) {
      await replacePlaceholdersInFile(fullPath, placeholders);
    }
  }
}

// ============================================================
// Package.json Generation
// ============================================================

/**
 * Pinned dependency versions for generated projects.
 *
 * `next` and `eslint-config-next` are resolved at runtime from the npm
 * registry so that fresh projects always get the latest release without
 * needing to republish create-nextly-app.  The remaining versions use
 * wide semver ranges that rarely need updating.
 */
const PINNED_VERSIONS: Record<string, string> = {
  // Next.js ecosystem — resolved at runtime via fetchLatestVersion()
  // (see generatePackageJson)
  react: "^19.1.0",
  "react-dom": "^19.1.0",
  // Dev dependencies
  typescript: "^5",
  "@types/node": "^20",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "@tailwindcss/postcss": "^4",
  tailwindcss: "^4",
  eslint: "^9",
};

/**
 * Packages whose latest version is fetched from the npm registry at
 * runtime so the CLI always scaffolds with the newest release.
 */
const RUNTIME_RESOLVED_PACKAGES = ["next", "eslint-config-next"] as const;

/**
 * @revnixhq packages whose latest version is fetched from npm at runtime.
 * This avoids having to republish create-nextly-app every time a
 * dependency package is updated.
 */
const NEXTLY_PACKAGES = [
  "@revnixhq/nextly",
  "@revnixhq/admin",
  "@revnixhq/adapter-drizzle",
  "@revnixhq/adapter-postgres",
  "@revnixhq/adapter-mysql",
  "@revnixhq/adapter-sqlite",
];

/** Cache so we only fetch once per CLI run. */
let resolvedNextlyVersions: Record<string, string> | null = null;

/**
 * Fetch the latest version of a package from the npm registry.
 * Returns `"latest"` on failure (network error, timeout, not published yet).
 */
async function fetchLatestVersion(pkg: string): Promise<string> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return "latest";
    const data = (await res.json()) as Record<string, string>;
    return data.latest ? `^${data.latest}` : "latest";
  } catch {
    return "latest";
  }
}

/**
 * Resolve all @revnixhq/* package versions in parallel.
 * Results are cached for the lifetime of the CLI process.
 */
export async function resolveNextlyVersions(): Promise<Record<string, string>> {
  if (resolvedNextlyVersions) return resolvedNextlyVersions;

  const entries = await Promise.all(
    NEXTLY_PACKAGES.map(
      async pkg => [pkg, await fetchLatestVersion(pkg)] as const
    )
  );
  resolvedNextlyVersions = Object.fromEntries(entries);
  return resolvedNextlyVersions;
}

/** Cache for runtime-resolved package versions (next, eslint-config-next). */
let resolvedRuntimeVersions: Record<string, string> | null = null;

/**
 * Resolve latest versions for Next.js ecosystem packages in parallel.
 * Falls back to a safe semver range if the registry is unreachable.
 */
async function resolveRuntimeVersions(): Promise<Record<string, string>> {
  if (resolvedRuntimeVersions) return resolvedRuntimeVersions;

  const FALLBACKS: Record<string, string> = {
    next: "^16.1.0",
    "eslint-config-next": "^16.1.0",
  };

  const entries = await Promise.all(
    RUNTIME_RESOLVED_PACKAGES.map(async pkg => {
      const version = await fetchLatestVersion(pkg);
      return [pkg, version === "latest" ? FALLBACKS[pkg] : version] as const;
    })
  );

  resolvedRuntimeVersions = Object.fromEntries(entries);
  return resolvedRuntimeVersions;
}

/**
 * Generate a `package.json` string for a fresh Nextly project.
 *
 * Fetches latest @revnixhq/* versions from npm so you don't need to
 * republish create-nextly-app when other packages are updated.
 *
 * @param projectName - The project name (used as package name)
 * @param database - Database configuration (adapter + driver)
 * @param useYalc - When true, omits @revnixhq/* packages (they'll be yalc-added)
 */
export async function generatePackageJson(
  projectName: string,
  database: DatabaseConfig,
  useYalc: boolean = false
): Promise<string> {
  // Fetch latest Next.js (and eslint-config-next) version from npm
  const runtimeVersions = await resolveRuntimeVersions();

  const dependencies: Record<string, string> = {
    next: runtimeVersions.next,
    react: PINNED_VERSIONS.react,
    "react-dom": PINNED_VERSIONS["react-dom"],
  };

  // @tanstack/react-query is externalized from admin bundle to avoid duplicate
  // instances - must be installed in the consumer project
  dependencies["@tanstack/react-query"] = "^5.62.0";

  if (!useYalc) {
    const versions = await resolveNextlyVersions();
    dependencies["@revnixhq/nextly"] = versions["@revnixhq/nextly"];
    dependencies["@revnixhq/admin"] = versions["@revnixhq/admin"];
    dependencies["@revnixhq/ui"] = versions["@revnixhq/ui"] || "latest";
    dependencies["@revnixhq/adapter-drizzle"] =
      versions["@revnixhq/adapter-drizzle"];
    dependencies[database.adapter] = versions[database.adapter] || "latest";
    // Form builder plugin ships with every scaffold so templates that
    // want it (e.g. the blog template's Newsletter form) work out of
    // the box. It's a small dep and unused templates simply don't
    // import it - no runtime cost.
    dependencies["@revnixhq/plugin-form-builder"] =
      versions["@revnixhq/plugin-form-builder"] || "latest";
  }

  // DB drivers are regular deps of their respective adapter packages and
  // will be installed as transitive deps. No need to list them here.

  const devDependencies: Record<string, string> = {
    typescript: PINNED_VERSIONS.typescript,
    "@types/node": PINNED_VERSIONS["@types/node"],
    "@types/react": PINNED_VERSIONS["@types/react"],
    "@types/react-dom": PINNED_VERSIONS["@types/react-dom"],
    "@tailwindcss/postcss": PINNED_VERSIONS["@tailwindcss/postcss"],
    tailwindcss: PINNED_VERSIONS.tailwindcss,
    eslint: PINNED_VERSIONS.eslint,
    "eslint-config-next": runtimeVersions["eslint-config-next"],
    // Pagefind powers /search in the blog template. Zero-config
    // static index generated at `next build` time. Templates that
    // don't ship a /search page simply won't invoke it.
    pagefind: "^1.1.0",
  };

  const pkg = {
    name: projectName,
    version: "0.1.0",
    private: true,
    scripts: {
      // F1 PR 4: dev now boots Nextly in single-process mode via `next dev`.
      // The lazy drizzle-kit/api import (PR 1) plus the in-process HMR
      // listener (PR 2) replaced the wrapper that previously owned the
      // terminal, schema prompts, and child supervision. `nextly dev` is
      // gone; the only supported dev command is the standard `next dev`.
      dev: "next dev --turbopack",
      // Build: migrate DB + compile Next.js + (if present) generate
      // the Pagefind search index. Templates without the search
      // script silently skip the last step.
      build:
        "nextly migrate && next build && (test -f scripts/build-search-index.mjs && node scripts/build-search-index.mjs || true)",
      "search:index": "node scripts/build-search-index.mjs",
      start: "next start",
      lint: "next lint",
      nextly: "nextly",
      // First-time setup: create system tables, seed demo content.
      "db:setup": "nextly db:sync --seed",
      "db:migrate": "nextly migrate",
      "db:migrate:status": "nextly migrate:status",
      "db:migrate:fresh": "nextly migrate:fresh",
      "db:migrate:reset": "nextly migrate:reset",
      "types:generate": "nextly generate:types",
    },
    dependencies,
    devDependencies,
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

// ============================================================
// Copy Template (Main Orchestrator)
// ============================================================

export interface CopyTemplateOptions {
  projectName: string;
  projectType: ProjectType;
  targetDir: string;
  database: DatabaseConfig;
  databaseUrl?: string;
  useYalc?: boolean;
  /** Schema approach for content templates (code-first, visual, both) */
  approach?: ProjectApproach;
  /** Include demo content seed files */
  demoData?: boolean;
  /** Explicit paths to base and template directories (from download or --local-template) */
  templateSource?: { basePath: string; templatePath: string };
}

/**
 * Copy templates to the target directory, handle approach-specific config,
 * seed files, and placeholder replacement.
 *
 * Steps:
 * 1. Copy base template -> targetDir
 * 2. Copy template src/ (frontend pages, components) -> targetDir
 * 3. Copy approach-specific config as nextly.config.ts
 * 4. Copy seed files if demo data selected
 * 5. Remove base page.tsx if template has (frontend) route group
 * 6. Generate package.json
 * 7. Replace placeholders in all text files
 */
export async function copyTemplate(
  options: CopyTemplateOptions
): Promise<void> {
  const {
    projectName,
    projectType,
    targetDir,
    database,
    databaseUrl,
    useYalc = false,
    approach,
    demoData = false,
    templateSource,
  } = options;

  // Check target directory doesn't already exist (skip for cwd installation)
  if (targetDir !== process.cwd() && (await fs.pathExists(targetDir))) {
    throw new Error(
      `Directory "${path.basename(targetDir)}" already exists. Please choose a different name.`
    );
  }

  // Resolve template paths - either from explicit source or local resolution
  let baseDir: string;
  let typeDir: string;

  if (templateSource) {
    // Paths provided by download or --local-template resolution
    baseDir = templateSource.basePath;
    typeDir = templateSource.templatePath;
  } else {
    // Fall back to bundled templates (for blank template or development)
    const templatesRoot = resolveTemplatePath();
    baseDir = path.join(templatesRoot, "base");
    typeDir = path.join(templatesRoot, projectType);
  }

  // Verify template directories exist
  if (!(await fs.pathExists(baseDir))) {
    throw new Error(
      `Base template not found at ${baseDir}. The package may be corrupted or the download failed.`
    );
  }

  if (!(await fs.pathExists(typeDir))) {
    throw new Error(
      `Template "${projectType}" not found at ${typeDir}. Available templates: blank, blog.`
    );
  }

  // Step 1: Copy base template (admin routes, API routes, layout, styles, etc.)
  await fs.copy(baseDir, targetDir, {
    filter: _src => {
      const basename = path.basename(_src);
      return !SKIP_FILES.has(basename);
    },
  });

  // Step 2: Copy template's src/ directory (frontend pages, components)
  // Skip configs/, seed/, and template.json - those are handled separately
  const templateSrcDir = path.join(typeDir, "src");
  if (await fs.pathExists(templateSrcDir)) {
    await fs.copy(templateSrcDir, path.join(targetDir, "src"), {
      overwrite: true,
      filter: _src => {
        const basename = path.basename(_src);
        return !SKIP_FILES.has(basename);
      },
    });
  }

  // Also copy template's nextly.config.ts if it exists at root (for blank template)
  const templateRootConfig = path.join(typeDir, "nextly.config.ts");
  if (await fs.pathExists(templateRootConfig)) {
    await fs.copy(
      templateRootConfig,
      path.join(targetDir, "nextly.config.ts"),
      { overwrite: true }
    );
  }

  // Step 3: Copy approach-specific config (for content templates with configs/ dir)
  const configsDir = path.join(typeDir, "configs");
  if (approach && (await fs.pathExists(configsDir))) {
    // Map approach name to config filename
    const configFileName =
      approach === "code-first"
        ? "codefirst.config.ts"
        : `${approach}.config.ts`;
    const configSrc = path.join(configsDir, configFileName);

    if (await fs.pathExists(configSrc)) {
      await fs.copy(configSrc, path.join(targetDir, "nextly.config.ts"), {
        overwrite: true,
      });
    }

    // The approach configs import from "./shared" (see templates/blog/
    // configs/codefirst.config.ts and both.config.ts). Copy shared.ts
    // alongside the chosen config so the import resolves at runtime.
    // visual.config.ts has no fields of its own but still harmless to copy.
    const sharedSrc = path.join(configsDir, "shared.ts");
    if (await fs.pathExists(sharedSrc)) {
      await fs.copy(sharedSrc, path.join(targetDir, "shared.ts"), {
        overwrite: true,
      });
    }
  }

  // Step 4: Copy seed files if demo data was selected
  if (demoData) {
    const seedDir = path.join(typeDir, "seed");
    if (await fs.pathExists(seedDir)) {
      // Copy nextly.seed.ts to project root
      const seedScript = path.join(seedDir, "nextly.seed.ts");
      if (await fs.pathExists(seedScript)) {
        await fs.copy(seedScript, path.join(targetDir, "nextly.seed.ts"));
      }

      // Copy seed data directory (seed-data.json + media files)
      await fs.ensureDir(path.join(targetDir, "seed"));
      const seedDataFile = path.join(seedDir, "seed-data.json");
      if (await fs.pathExists(seedDataFile)) {
        await fs.copy(
          seedDataFile,
          path.join(targetDir, "seed", "seed-data.json")
        );
      }

      // Copy seed media files
      const seedMediaDir = path.join(seedDir, "media");
      if (await fs.pathExists(seedMediaDir)) {
        await fs.copy(seedMediaDir, path.join(targetDir, "seed", "media"), {
          filter: _src => {
            const basename = path.basename(_src);
            // Skip README.md from media dir - it's dev documentation
            return !SKIP_FILES.has(basename) && basename !== "README.md";
          },
        });
      }
    }
  }

  // Step 5: Remove base template's page.tsx if blog template has (frontend) route group
  // Both can't coexist since (frontend)/page.tsx also serves the / route
  const frontendPagePath = path.join(
    targetDir,
    "src",
    "app",
    "(frontend)",
    "page.tsx"
  );
  const basePagePath = path.join(targetDir, "src", "app", "page.tsx");
  if (
    (await fs.pathExists(frontendPagePath)) &&
    (await fs.pathExists(basePagePath))
  ) {
    await fs.remove(basePagePath);
  }

  // Step 6: Generate package.json
  const packageJsonContent = await generatePackageJson(
    projectName,
    database,
    useYalc
  );
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    packageJsonContent,
    "utf-8"
  );

  // Step 7: Create SQLite data directory if needed
  // SQLite stores its database file at ./data/nextly.db and the parent
  // directory must exist before the adapter can create the file.
  if (database.type === "sqlite") {
    await fs.ensureDir(path.join(targetDir, "data"));
  }

  // Step 8: Replace placeholders in all text files
  // Include approach placeholder for seed scripts
  const placeholders = buildPlaceholderMap({ database, databaseUrl });
  if (approach) {
    placeholders["{{approach}}"] = approach;
  }
  await replacePlaceholders(targetDir, placeholders);
}
