import path from "path";
import { fileURLToPath } from "url";

import fs from "fs-extra";

import { buildNextConfigTemplate } from "../generators/next-config";
import { getAvailableTemplateNames } from "../lib/templates";
import type { DatabaseConfig, ProjectApproach, ProjectType } from "../types";

/**
 * Templates whose `nextly.config.ts` registers `formBuilderPlugin`. The
 * plugin (and its admin imports) only ship with these scaffolds — every
 * other template gets a leaner package.json and an admin page without the
 * plugin imports so dev never fails with "Cannot find package
 * '@nextlyhq/plugin-form-builder'".
 */
const PROJECT_TYPES_WITH_FORM_BUILDER: ReadonlySet<ProjectType> = new Set([
  "blog",
]);

export function projectUsesFormBuilder(projectType: ProjectType): boolean {
  return PROJECT_TYPES_WITH_FORM_BUILDER.has(projectType);
}

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
  database?: DatabaseConfig;
  databaseUrl?: string;
  /** Plugin package name → fills `{{pluginName}}` (plugin template, D44). */
  pluginName?: string;
  /** Plugin's `nextly` compat range → fills `{{nextlyRange}}` (D44). */
  nextlyRange?: string;
}): Record<string, string> {
  const { database, databaseUrl, pluginName, nextlyRange } = options;

  const map: Record<string, string> = {};
  if (database) {
    map["{{databaseDialect}}"] = database.type;
    map["{{databaseUrl}}"] = databaseUrl || database.envExample;
  }
  if (pluginName) map["{{pluginName}}"] = pluginName;
  if (nextlyRange) map["{{nextlyRange}}"] = nextlyRange;
  return map;
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
 * @nextlyhq packages whose latest version is fetched from npm at runtime.
 * This avoids having to republish create-nextly-app every time a
 * dependency package is updated.
 */
const NEXTLY_PACKAGES = [
  "nextly",
  "@nextlyhq/admin",
  "@nextlyhq/ui",
  "@nextlyhq/adapter-drizzle",
  "@nextlyhq/adapter-postgres",
  "@nextlyhq/adapter-mysql",
  "@nextlyhq/adapter-sqlite",
  "@nextlyhq/plugin-form-builder",
  "@nextlyhq/plugin-sdk",
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
 * Resolve all @nextlyhq/* package versions in parallel.
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
 * Fetches latest @nextlyhq/* versions from npm so you don't need to
 * republish create-nextly-app when other packages are updated.
 *
 * @param projectName - The project name (used as package name)
 * @param database - Database configuration (adapter + driver)
 * @param useYalc - When true, omits @nextlyhq/* packages (they'll be yalc-added)
 * @param projectType - Selected template. Determines optional plugin deps
 *   (e.g. `@nextlyhq/plugin-form-builder` ships only with `blog`).
 */
export async function generatePackageJson(
  projectName: string,
  database: DatabaseConfig,
  useYalc: boolean = false,
  projectType: ProjectType = "blank"
): Promise<string> {
  // Plugins are a publishable library, not an app — different package.json.
  if (projectType === "plugin") {
    return generatePluginPackageJson(projectName, useYalc);
  }

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

  // @nextlyhq/ui declares lucide-react as a peer, so the consumer project has
  // to provide it. Admin bundles its own copy, which does not satisfy that peer
  // under isolated node_modules layouts.
  dependencies["lucide-react"] = "^0.544.0";

  if (!useYalc) {
    const versions = await resolveNextlyVersions();
    dependencies["nextly"] = versions["nextly"];
    dependencies["@nextlyhq/admin"] = versions["@nextlyhq/admin"];
    dependencies["@nextlyhq/ui"] = versions["@nextlyhq/ui"] || "latest";
    dependencies["@nextlyhq/adapter-drizzle"] =
      versions["@nextlyhq/adapter-drizzle"];
    dependencies[database.adapter] = versions[database.adapter] || "latest";
    // Form builder plugin is only included for templates that register
    // it in nextly.config.ts (currently just `blog`). Including it in
    // the blank scaffold would leave imports in the admin page that
    // resolve to an uninstalled package — `next dev` would then fail
    // with "Cannot find package '@nextlyhq/plugin-form-builder'".
    if (projectUsesFormBuilder(projectType)) {
      dependencies["@nextlyhq/plugin-form-builder"] =
        versions["@nextlyhq/plugin-form-builder"] || "latest";
    }
  }

  // drizzle-orm is pinned EXACTLY in the scaffold: Nextly requires 1.0.0-rc.4
  // and a user's `pnpm add drizzle-orm` would resolve npm `latest` (an older
  // line), silently breaking Drizzle's cross-instance is() checks the first
  // time they write a custom query. Pinning it here makes the required
  // version visible and correct from day one. Must match
  // scripts/drizzle-version.cjs.
  dependencies["drizzle-orm"] = "1.0.0-rc.4";

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

  // NOTE: the build-script allowlist (better-sqlite3, sharp, esbuild,
  // unrs-resolver) is NOT emitted here. pnpm 11 no longer reads the `pnpm`
  // field from package.json — it warns and ignores it. The allowlist now
  // lives in pnpm-workspace.yaml (see generatePnpmWorkspaceYaml), which
  // copyTemplate writes alongside this file.
  const pkg = {
    name: projectName,
    version: "0.1.0",
    private: true,
    scripts: {
      // Dev boots Nextly in single-process mode via `next dev`. The lazy
      // per-dialect drizzle-kit import plus the in-process HMR listener
      // replaced the wrapper that previously owned the terminal, schema
      // prompts, and child supervision. `nextly dev` is gone; the only
      // supported dev command is the standard `next dev`.
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
      // First-time setup: sync schema + seed system permissions. Demo
      // content is seeded separately from the admin UI (visit /welcome
      // after running `pnpm dev` and completing /admin/setup).
      "db:setup": "nextly db:sync",
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

/**
 * Resolve the `nextly` compat range a scaffolded plugin declares + uses to fill
 * `{{nextlyRange}}`. Uses the latest published `nextly` (`^x.y.z`); falls back to
 * an open range when offline / using yalc.
 */
async function resolvePluginNextlyRange(useYalc: boolean): Promise<string> {
  if (useYalc) return ">=0.0.0";
  const versions = await resolveNextlyVersions();
  const v = versions["nextly"];
  return v && v !== "latest" ? v : ">=0.0.0";
}

/**
 * Generate `package.json` for a scaffolded plugin (D44). A publishable library:
 * `dist/` ships (the embedded `dev/` playground does not — `files: ["dist"]`),
 * nextly/admin/sdk/react are peers, and devDeps cover build + test + the dev app.
 */
async function generatePluginPackageJson(
  projectName: string,
  useYalc: boolean
): Promise<string> {
  const versions = useYalc ? {} : await resolveNextlyVersions();
  const runtimeVersions = await resolveRuntimeVersions();
  const range = (pkg: string): string => versions[pkg] ?? "latest";

  const peerDependencies: Record<string, string> = {
    nextly: range("nextly"),
    "@nextlyhq/admin": range("@nextlyhq/admin"),
    "@nextlyhq/plugin-sdk": range("@nextlyhq/plugin-sdk"),
    react: PINNED_VERSIONS.react,
    "react-dom": PINNED_VERSIONS["react-dom"],
  };

  // devDeps cover: build (tsup/tsc), test (vitest), lint (eslint), AND the
  // embedded dev/ playground (next + nextly + admin + sqlite adapter).
  const devDependencies: Record<string, string> = {
    nextly: range("nextly"),
    "@nextlyhq/admin": range("@nextlyhq/admin"),
    "@nextlyhq/ui": range("@nextlyhq/ui"),
    "@nextlyhq/plugin-sdk": range("@nextlyhq/plugin-sdk"),
    "@nextlyhq/adapter-drizzle": range("@nextlyhq/adapter-drizzle"),
    "@nextlyhq/adapter-sqlite": range("@nextlyhq/adapter-sqlite"),
    next: runtimeVersions.next,
    react: PINNED_VERSIONS.react,
    "react-dom": PINNED_VERSIONS["react-dom"],
    "better-sqlite3": "^12.0.0",
    "@types/node": PINNED_VERSIONS["@types/node"],
    "@types/react": PINNED_VERSIONS["@types/react"],
    "@types/react-dom": PINNED_VERSIONS["@types/react-dom"],
    typescript: PINNED_VERSIONS.typescript,
    tsup: "^8.5.0",
    vitest: "^4.1.0",
    eslint: PINNED_VERSIONS.eslint,
    "@eslint/js": PINNED_VERSIONS.eslint,
    "typescript-eslint": "^8.0.0",
  };

  const pkg = {
    name: projectName,
    version: "0.1.0",
    description: "A Nextly plugin.",
    type: "module",
    main: "./dist/index.mjs",
    module: "./dist/index.mjs",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.mjs",
      },
      "./admin": {
        types: "./dist/admin/index.d.ts",
        import: "./dist/admin/index.mjs",
      },
    },
    // Only the built library ships. The dev/ playground is never published.
    files: ["dist"],
    keywords: ["nextly", "nextly-plugin"],
    scripts: {
      build: "tsup",
      // Runs the embedded playground (next dev with dev/ as the project root).
      dev: "next dev dev --turbopack",
      "check-types": "tsc --noEmit",
      lint: "eslint .",
      test: "vitest run",
      "types:generate": "nextly generate:types",
    },
    peerDependencies,
    devDependencies,
    // Native build-script allowlist is NOT emitted here: pnpm 11 ignores the
    // package.json `pnpm` field. It lives in pnpm-workspace.yaml instead (written
    // by copyPluginTemplate via generatePnpmWorkspaceYaml).
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

// ============================================================
// pnpm-workspace.yaml Generation
// ============================================================

/**
 * Native dependencies whose install/build scripts must be allow-listed so
 * pnpm 10+ actually compiles them. npm and yarn run these by default.
 *
 * Without the allowlist, `pnpm install` aborts with ERR_PNPM_IGNORED_BUILDS
 * on pnpm 11, better-sqlite3 never gets a compiled binding (sqlite apps crash
 * at boot), and sharp/esbuild/unrs-resolver silently degrade to slow paths.
 *
 * better-sqlite3 is always included: it's a direct dependency only for sqlite
 * scaffolds, but the --use-yalc dev flow installs every adapter (so a
 * postgres/mysql yalc scaffold still pulls and must build better-sqlite3), and
 * allow-listing a package that isn't installed is a harmless no-op.
 */
export const NATIVE_BUILD_DEPENDENCIES = [
  "better-sqlite3",
  "esbuild",
  "sharp",
  "unrs-resolver",
] as const;

/**
 * Generate the `pnpm-workspace.yaml` for a scaffolded project.
 *
 * pnpm 10+ blocks dependency build scripts by default and the allowlist's
 * home changed across versions:
 *   - pnpm 11+ reads `allowBuilds` (a map of package -> boolean) and no longer
 *     reads the `pnpm` field from package.json at all.
 *   - pnpm 10.6+ reads `onlyBuiltDependencies` (an array; deprecated in 11).
 *
 * Both keys are emitted so native deps compile on any pnpm 10.6+/11. pnpm 9
 * runs build scripts by default and ignores this file; npm/yarn ignore it too,
 * so it is safe to ship in every scaffold regardless of package manager.
 */
export function generatePnpmWorkspaceYaml(): string {
  const allowBuilds = NATIVE_BUILD_DEPENDENCIES.map(
    dep => `  ${dep}: true`
  ).join("\n");
  const onlyBuilt = NATIVE_BUILD_DEPENDENCIES.map(dep => `  - ${dep}`).join(
    "\n"
  );

  return (
    "# Allow native dependencies to run their build scripts. pnpm 10+ blocks\n" +
    "# dependency build scripts by default; without this better-sqlite3 has no\n" +
    "# compiled binding (sqlite apps crash at boot) and sharp/esbuild degrade.\n" +
    "#\n" +
    "# pnpm 11+ reads `allowBuilds`; pnpm 10.6+ reads `onlyBuiltDependencies`.\n" +
    "# npm, yarn, and pnpm 9 ignore this file (they run build scripts by default).\n" +
    `allowBuilds:\n${allowBuilds}\n` +
    `onlyBuiltDependencies:\n${onlyBuilt}\n`
  );
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
  /** Schema approach for content templates (code-first, visual) */
  approach?: ProjectApproach;
  /** Explicit paths to base and template directories (from download or --local-template) */
  templateSource?: { basePath: string; templatePath: string };
  /**
   * Suppress the internal "directory already exists" guard. Set by the
   * installer when it has already negotiated a directory conflict with
   * the user (cwd install, or the "remove"/"ignore" choices from the
   * directory-conflict prompt).
   */
  allowExistingTarget?: boolean;
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
    templateSource,
    allowExistingTarget = false,
  } = options;

  // Guard against silently overwriting an existing subdirectory. Skip
  // when targeting cwd (the installer handles emptiness checks there)
  // or when the installer explicitly opted in via allowExistingTarget
  // (after a user-confirmed remove/ignore choice).
  if (
    !allowExistingTarget &&
    targetDir !== process.cwd() &&
    (await fs.pathExists(targetDir))
  ) {
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

  // Plugins are a self-contained library scaffold (src/ + embedded dev/), not an
  // app — no base app, no next.config/.env generation, no frontend page. Copy
  // the plugin tree as-is, generate its package.json, fill placeholders, done.
  if (projectType === "plugin") {
    await copyPluginTemplate({ projectName, typeDir, targetDir, useYalc });
    return;
  }

  // Verify template directories exist
  if (!(await fs.pathExists(baseDir))) {
    throw new Error(
      `Base template not found at ${baseDir}. The package may be corrupted or the download failed.`
    );
  }

  if (!(await fs.pathExists(typeDir))) {
    throw new Error(
      `Template "${projectType}" not found at ${typeDir}. Available templates: ${getAvailableTemplateNames().join(", ")}.`
    );
  }

  await fs.copy(baseDir, targetDir, {
    filter: _src => {
      const basename = path.basename(_src);
      return !SKIP_FILES.has(basename);
    },
  });

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
    // configs/codefirst.config.ts). Copy shared.ts alongside the chosen
    // config so the import resolves at runtime. visual.config.ts has no
    // fields of its own but still harmless to copy.
    const sharedSrc = path.join(configsDir, "shared.ts");
    if (await fs.pathExists(sharedSrc)) {
      await fs.copy(sharedSrc, path.join(targetDir, "shared.ts"), {
        overwrite: true,
      });
    }
  }

  // (Demo seed: src/endpoints/seed/ ships with the template tree and is
  // already copied above. The user triggers seeding from the admin
  // dashboard's SeedDemoContentCard after running /admin/setup — the
  // CLI no longer asks about it.)

  const templateMigrationsDir = path.join(typeDir, "migrations");
  if (await fs.pathExists(templateMigrationsDir)) {
    await fs.copy(templateMigrationsDir, path.join(targetDir, "migrations"), {
      overwrite: false,
    });
  }

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
    useYalc,
    projectType
  );
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    packageJsonContent,
    "utf-8"
  );

  // Step 6b: Write pnpm-workspace.yaml carrying the native-dependency build
  // allowlist. pnpm 10+ blocks dependency build scripts by default and pnpm 11
  // ignores the package.json `pnpm` field, so this file is what lets
  // better-sqlite3/sharp/esbuild compile. Harmless for npm/yarn/pnpm 9.
  await fs.writeFile(
    path.join(targetDir, "pnpm-workspace.yaml"),
    generatePnpmWorkspaceYaml(),
    "utf-8"
  );

  // Step 7: Create SQLite data directory if needed
  // SQLite stores its database file at ./data/nextly.db and the parent
  // directory must exist before the adapter can create the file.
  if (database.type === "sqlite") {
    await fs.ensureDir(path.join(targetDir, "data"));
  }

  // Step 8: Write a database-specific next.config.ts so the scaffold only
  // externalizes the selected adapter and its driver.
  await fs.writeFile(
    path.join(targetDir, "next.config.ts"),
    buildNextConfigTemplate(database),
    "utf-8"
  );

  // Step 9: Replace placeholders in all text files
  // Include approach placeholder for seed scripts
  const placeholders = buildPlaceholderMap({ database, databaseUrl });
  if (approach) {
    placeholders["{{approach}}"] = approach;
  }
  await replacePlaceholders(targetDir, placeholders);
}

/**
 * Copy the plugin template (D44/D45): the whole tree (src/ + embedded dev/ +
 * tsconfig/tsup/vitest/eslint), a generated plugin package.json, then fill
 * `{{pluginName}}` / `{{nextlyRange}}`. No app base, next.config, or .env.
 */
async function copyPluginTemplate(opts: {
  projectName: string;
  typeDir: string;
  targetDir: string;
  useYalc: boolean;
}): Promise<void> {
  const { projectName, typeDir, targetDir, useYalc } = opts;

  if (!(await fs.pathExists(typeDir))) {
    throw new Error(
      `Plugin template not found at ${typeDir}. The package may be corrupted or the download failed.`
    );
  }

  // Copy the whole template tree, minus skip-files and the manifest.
  await fs.copy(typeDir, targetDir, {
    overwrite: true,
    filter: src => {
      const basename = path.basename(src);
      return !SKIP_FILES.has(basename) && basename !== "template.json";
    },
  });

  // Materialize the dev playground env so `pnpm dev` boots with zero manual
  // steps: without dev/.env the dialect defaults to postgresql and the
  // instrumentation hook aborts asking for DATABASE_URL. `overwrite: false`
  // preserves a user's own dev/.env when scaffolding over an existing dir.
  const devEnvExample = path.join(targetDir, "dev", ".env.example");
  if (await fs.pathExists(devEnvExample)) {
    await fs.copy(devEnvExample, path.join(targetDir, "dev", ".env"), {
      overwrite: false,
    });
  }

  // Generate the plugin package.json (database arg is unused for plugins).
  const packageJsonContent = await generatePackageJson(
    projectName,
    { type: "sqlite" } as DatabaseConfig,
    useYalc,
    "plugin"
  );
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    packageJsonContent,
    "utf-8"
  );

  // Write pnpm-workspace.yaml carrying the native-dependency build allowlist.
  // pnpm 11 ignores the package.json `pnpm` field, and the embedded dev/
  // playground uses better-sqlite3 (native build) — so this file is what lets
  // `pnpm install` build it instead of aborting with ERR_PNPM_IGNORED_BUILDS.
  // Harmless for npm/yarn/pnpm 9.
  await fs.writeFile(
    path.join(targetDir, "pnpm-workspace.yaml"),
    generatePnpmWorkspaceYaml(),
    "utf-8"
  );

  // Fill plugin placeholders across the copied tree (src/ + dev/).
  const nextlyRange = await resolvePluginNextlyRange(useYalc);
  await replacePlaceholders(
    targetDir,
    buildPlaceholderMap({ pluginName: projectName, nextlyRange })
  );
}
