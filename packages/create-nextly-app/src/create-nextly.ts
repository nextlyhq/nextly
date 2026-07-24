import path from "path";

import * as p from "@clack/prompts";
import * as telemetry from "@nextlyhq/telemetry";
import { classifyError } from "@nextlyhq/telemetry";
import fs from "fs-extra";
import pc from "picocolors";

import { generateAdminPage } from "./generators/admin";
import { generateConfig } from "./generators/config";
import { generateEnv } from "./generators/env";
import { generateMediaRoutes } from "./generators/media-routes";
import { patchNextConfig } from "./generators/next-config";
import { generateRoutes } from "./generators/routes";
import { generateTypesDirectory } from "./generators/types";
import { installDependencies } from "./installers/dependencies";
import {
  resolveTemplateSource,
  cleanupDownload,
  type TemplateSource,
} from "./lib/download-template";
import {
  templateHasApproaches,
  getDefaultApproach,
  shouldUseBundledTemplate,
} from "./lib/templates";
import { getApproachPromptOptions } from "./prompts/approach";
import { DATABASE_CONFIGS, DATABASE_LABELS } from "./prompts/database";
import {
  DEFAULT_PROJECT_NAME,
  isExistingNextProject,
  promptDirectoryConflict,
  promptForProjectName,
} from "./prompts/project-name";
import {
  getTemplatePromptOptions,
  isValidTemplateSelection,
} from "./prompts/template";
import type {
  CreateNextlyOptions,
  DatabaseConfig,
  DatabaseType,
  ProjectApproach,
  ProjectInfo,
  ProjectType,
} from "./types";
import { detectPackageManager, detectProject } from "./utils/detect";
import { emptyDirectory, isDirectoryNotEmpty } from "./utils/fs";
import { copyTemplate } from "./utils/template";

/**
 * Pick a safe project name when the user has chosen "install in cwd".
 *
 * `path.basename("/")` returns `""`, which would silently propagate through
 * the scaffold (the `isFreshProject && projectName` guard later in this
 * file evaluates false on empty strings) and leave the user with a half-
 * scaffolded directory. Also defends against directory names that aren't
 * valid as the `package.json` "name" field (npm forbids uppercase, etc).
 */
function cwdProjectName(cwd: string): string {
  const basename = path.basename(cwd);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(basename)) {
    return DEFAULT_PROJECT_NAME;
  }
  return basename;
}

/**
 * Main entry point for scaffolding Nextly in a Next.js project.
 *
 * Two flows:
 * 1. Empty directory -> scaffold Next.js + install Nextly
 * 2. Existing Next.js project -> install Nextly into it
 *
 * Interactive prompt order:
 * 1. Project name (or detect existing project)
 * 2. Template selection (blank, blog, etc.)
 * 3. Schema approach (code-first, visual) — only for content templates
 * 4. Demo content (yes/no) - only for content templates
 * 5. Database selection (sqlite, postgresql, mysql)
 * 6. Database connection string (only for postgresql/mysql)
 */
export async function createNextly(
  options: CreateNextlyOptions = {}
): Promise<void> {
  const { defaults = false, skipInstall = false, useYalc = false } = options;
  // installInCwd may flip to true at the interactive prompt when the user
  // answers with "." or "./", so it has to be mutable.
  let installInCwd = options.installInCwd ?? false;
  let { cwd = process.cwd() } = options;

  let isFreshProject = false;
  let projectName: string | undefined;

  // Track end-to-end scaffold duration for telemetry. Captured on success and failure.
  const overallStartedAt = Date.now();

  // --- Header ---

  p.intro(
    pc.bold(pc.cyan("Nextly")) + pc.dim(" - Open-source CMS for Next.js")
  );

  // --- Step 1: Detect or prompt for project name ---

  const existingProject = await isExistingNextProject(cwd);

  if (existingProject) {
    p.log.success(`${pc.green("Next.js")} project detected`);

    if (!defaults) {
      const shouldInstall = await p.confirm({
        message: "Install Nextly in this project?",
        initialValue: true,
      });

      if (p.isCancel(shouldInstall) || !shouldInstall) {
        p.cancel("Cancelled. No changes were made.");
        return;
      }
    }
  } else if (installInCwd) {
    // "." was passed but it's not a Next.js project - scaffold in cwd
    projectName = cwdProjectName(cwd);
    isFreshProject = true;
  } else {
    // Interactive or defaults: get project name
    if (options.projectNameFromArg) {
      projectName = options.projectNameFromArg;
    } else if (!defaults) {
      // Single source of truth for the project-name prompt. The helper
      // funnels the user's answer through the same resolver as the
      // positional CLI argument so "." / "./" / "./foo" / "foo/" behave
      // identically on the command line and at the prompt.
      const result = await promptForProjectName();
      if (result.kind === "cancelled") {
        p.cancel("Cancelled.");
        return;
      }
      if (result.value.installInCwd) {
        installInCwd = true;
        projectName = cwdProjectName(cwd);
      } else {
        projectName = result.value.projectName ?? DEFAULT_PROJECT_NAME;
      }
    } else {
      projectName = DEFAULT_PROJECT_NAME;
    }

    isFreshProject = true;
  }

  // --- Step 1b: Directory-conflict recovery ---
  //
  // Resolve any "directory already has files" conflict NOW, before the user
  // wastes time answering template / approach / database prompts. The
  // original bug (silent fall-through to a cwd install that aborted after
  // five answered prompts) is the reason this check exists; running it
  // late would partially re-create that bad UX.
  //
  // `allowExistingTarget` is captured here and reused by the scaffold step
  // below. It's only meaningful when `isFreshProject` is true; for the
  // "install into existing Next project" path, the user has already
  // consented to using their current directory.
  let allowExistingTarget = false;
  if (isFreshProject && projectName) {
    const conflictTargetDir = installInCwd ? cwd : path.join(cwd, projectName);
    if (await isDirectoryNotEmpty(conflictTargetDir)) {
      const targetLabel = installInCwd
        ? "the current directory"
        : `"${projectName}"`;
      const choice = await promptDirectoryConflict(targetLabel);
      if (choice === "cancel") {
        p.cancel("Cancelled. No changes were made.");
        return;
      }
      // Both "remove" and "ignore" tell copyTemplate the conflict has
      // already been negotiated with the user. emptyDirectory only
      // empties the directory (it preserves `.git`), so the dir still
      // exists afterwards — copyTemplate's "directory already exists"
      // guard would still trip on the subdirectory path unless we
      // flip the flag here.
      allowExistingTarget = true;
      if (choice === "remove") {
        await emptyDirectory(conflictTargetDir);
      }
      // "ignore" falls through — overlay the template on top of
      // existing files (fs.copy overwrites by default).
    }
  }

  // --- Step 2: Template selection ---

  let projectType: ProjectType;

  if (options.projectType) {
    // Honour an explicit --template flag regardless of project kind.
    projectType = options.projectType;
  } else if (defaults || existingProject) {
    // Existing Next.js projects always get the blank template by default.
    // Content templates (blog, etc.) ship their own pages and routes, and
    // overlaying them on a user's existing app would clobber their frontend
    // or surprise them with unrelated routes. Users who really want a
    // content template into an existing app can still opt in via --template.
    projectType = "blank";
  } else {
    const template = await p.select({
      message: "Pick a starting template:",
      options: getTemplatePromptOptions(),
    });

    if (p.isCancel(template)) {
      p.cancel("Cancelled.");
      return;
    }

    // If user selects the disabled "coming soon" hint, fall back to blank
    projectType = isValidTemplateSelection(template) ? template : "blank";
  }

  // The plugin template scaffolds a standalone publishable package. In an
  // existing Next.js project the fresh-scaffold path is skipped entirely, so
  // proceeding would install app dependencies and generate app config while
  // never copying the plugin source — a broken hybrid. Fail fast instead.
  if (projectType === "plugin" && !isFreshProject) {
    p.cancel(
      "The Plugin template creates a standalone package and cannot be installed into an existing Next.js project. Run create-nextly-app in an empty directory instead."
    );
    return;
  }

  // --- Step 3: Schema approach (only for content templates with approaches) ---

  let approach: ProjectApproach | undefined;

  if (templateHasApproaches(projectType)) {
    // Content template selected - ask about schema approach
    if (options.approach) {
      approach = options.approach;
    } else if (defaults) {
      approach = getDefaultApproach(projectType);
    } else {
      const selected = await p.select({
        message: "How would you like to define your content schema?",
        options: getApproachPromptOptions(),
      });

      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        return;
      }

      approach = selected;
    }
  }

  // Telemetry: template + approach selected (no project name).
  telemetry.capture("template_selected", {
    template: projectType,
    approach: approach ?? null,
  });

  // Cross-promotion note: the two approaches aren't mutually exclusive —
  // a code-first project can grow UI-defined collections later via the
  // visual schema builder, and vice versa. Surface that here so users
  // don't feel locked in by their initial pick.
  if (approach === "code-first") {
    p.note(
      "You can extend this project later with the Visual Schema Builder\n" +
        "in the admin UI. UI-created collections coexist with code ones.",
      "Tip"
    );
  } else if (approach === "visual") {
    p.note(
      "You can mix in code-first later by exporting your schema from\n" +
        "/admin/schema-builder. UI and code-defined collections coexist.",
      "Tip"
    );
  }

  // --- Step 4 (removed): demo-content prompt ---
  // SeedDemoContentCard prompts the user instead. The --demo-data
  // CLI flag still parses (for backwards compatibility) but is now
  // a no-op.

  // --- Step 5: Database selection ---

  let databaseType: DatabaseType;

  if (options.database) {
    databaseType = options.database;
  } else if (defaults) {
    databaseType = "sqlite";
  } else {
    const db = await p.select({
      message: "Which database will you use?",
      options: (["sqlite", "postgresql", "mysql"] as const).map(value => ({
        value,
        label: DATABASE_LABELS[value].label,
        hint: DATABASE_LABELS[value].hint,
      })),
    });

    if (p.isCancel(db)) {
      p.cancel("Cancelled.");
      return;
    }

    databaseType = db;
  }

  const database: DatabaseConfig = {
    type: databaseType,
    ...DATABASE_CONFIGS[databaseType],
  };

  // Telemetry: database choice (no connection string).
  telemetry.capture("database_selected", { database: databaseType });

  // --- Step 6: Database connection string (only for PostgreSQL/MySQL) ---

  let databaseUrl: string;

  if (databaseType === "sqlite") {
    // SQLite: auto-fill, no prompt needed
    databaseUrl = "file:./data/nextly.db";
  } else if (defaults) {
    // Defaults mode for PG/MySQL: use placeholder (user must update .env)
    databaseUrl = database.connectionUrl;
  } else {
    const placeholders: Record<string, string> = {
      postgresql: "postgresql://user:password@localhost:5432/nextly",
      mysql: "mysql://user:password@localhost:3306/nextly",
    };

    const dbLabel = databaseType === "postgresql" ? "PostgreSQL" : "MySQL";

    const url = await p.text({
      message: `Enter your ${dbLabel} connection string:`,
      placeholder: placeholders[databaseType],
    });

    if (p.isCancel(url)) {
      p.cancel("Cancelled.");
      return;
    }

    // Use the provided value or fall back to placeholder
    databaseUrl = url?.trim() || database.connectionUrl;
  }

  // --- Scaffold project from template ---

  if (isFreshProject && projectName) {
    const targetDir = installInCwd ? cwd : path.join(cwd, projectName);

    const s = p.spinner();
    let templateSource: TemplateSource | undefined;

    try {
      // Resolve template source (download from GitHub or use local path).
      // Bundled templates (blank, plugin) scaffold from the copy shipped
      // inside the CLI package by default; content templates (blog) and any
      // explicit source override (--local-template, --use-yalc, a non-main
      // --branch) resolve live. See shouldUseBundledTemplate for the rules.
      if (
        !shouldUseBundledTemplate(projectType, {
          localTemplatePath: options.localTemplatePath,
          useYalc,
          branch: options.branch,
        })
      ) {
        s.start("Resolving template...");
        templateSource = await resolveTemplateSource(projectType, {
          localTemplatePath: options.localTemplatePath,
          branch: options.branch,
        });
        s.stop("Template ready");
        s.start("Scaffolding project...");
      } else {
        s.start("Scaffolding project...");
      }

      await copyTemplate({
        projectName,
        projectType,
        targetDir,
        database,
        databaseUrl,
        useYalc,
        approach,
        templateSource,
        // Suppress copyTemplate's "directory already exists" guard when the
        // installer has already negotiated the conflict with the user
        // (either by emptying the dir or accepting an overlay). Without
        // this, the "ignore" path would still throw on the subdirectory
        // case where the target was non-empty.
        allowExistingTarget,
      });

      if (!installInCwd) cwd = targetDir;

      s.stop("Project scaffolded");
    } catch (error) {
      s.stop("Scaffolding failed");
      // Roll back only when this CLI run created the target subdirectory
      // from scratch (`allowExistingTarget === false`). Skip rollback when:
      //   - installInCwd: the user owns their cwd; never delete it.
      //   - allowExistingTarget: the target pre-existed (user picked
      //     "remove" or "ignore"). In the "remove" case `.git` was
      //     preserved by emptyDirectory(); rolling back here would
      //     `fs.remove(targetDir)` and destroy it. In the "ignore" case a
      //     partial scaffold on top of user files is still better than
      //     losing the user's files.
      if (!installInCwd && !allowExistingTarget) {
        if (await fs.pathExists(targetDir)) {
          await fs.remove(targetDir);
        }
      }
      // Telemetry: scaffolding failed (no message; error_code only).
      telemetry.capture("scaffold_failed", {
        stage: "scaffold",
        error_code: classifyError(error, "template-download"),
        duration_ms: Date.now() - overallStartedAt,
      });
      p.cancel((error as Error).message);
      process.exit(1);
    } finally {
      // Clean up temporary download directory
      if (templateSource) {
        await cleanupDownload(templateSource);
      }
    }
  }

  // --- Detect project ---

  let projectInfo;
  {
    const s = p.spinner();
    s.start("Detecting project...");
    try {
      if (projectType === "plugin") {
        // A plugin scaffold is a publishable library, not a Next.js app: the
        // library code lives at src/ and the Next app lives in dev/, so the
        // app-shaped detection would reject it ("App Router not detected").
        // Downstream only consumes packageManager for fresh scaffolds
        // (install + next-steps), so detect that and describe the fixed
        // plugin layout statically.
        projectInfo = {
          isNextJs: false,
          isAppRouter: false,
          hasTypescript: true,
          packageManager: await detectPackageManager(cwd),
          nextVersion: null,
          srcDir: true,
          appDir: "dev/src/app",
        } satisfies ProjectInfo;
        s.stop("Detected plugin package");
      } else {
        projectInfo = await detectProject(cwd);
        s.stop(`Detected Next.js ${projectInfo.nextVersion || "unknown"}`);
      }
    } catch (error) {
      s.stop("Detection failed");
      telemetry.capture("scaffold_failed", {
        stage: "detect",
        error_code: classifyError(error, "config"),
        duration_ms: Date.now() - overallStartedAt,
      });
      p.cancel((error as Error).message);
      process.exit(1);
    }
  }

  // --- Install dependencies ---

  if (skipInstall) {
    p.log.warn("Skipping dependency installation (--skip-install)");
  } else {
    const s = p.spinner();
    s.start("Installing dependencies...");
    const installStartedAt = Date.now();
    telemetry.capture("install_started", {});
    try {
      await installDependencies(
        cwd,
        projectInfo,
        database,
        useYalc,
        isFreshProject,
        projectType
      );
      s.stop("Dependencies installed");
      telemetry.capture("install_completed", {
        duration_ms: Date.now() - installStartedAt,
      });
    } catch (error) {
      s.stop("Failed to install dependencies");
      telemetry.capture("install_failed", {
        duration_ms: Date.now() - installStartedAt,
        error_code: classifyError(error, "install"),
      });
      p.cancel((error as Error).message);
      process.exit(1);
    }
  }

  // --- Generate configuration files ---

  {
    const s = p.spinner();
    s.start("Setting up environment...");
    try {
      if (!isFreshProject) {
        // Existing project: generate Nextly config files
        await generateConfig(cwd, projectType);
        await generateRoutes(cwd, projectInfo);
        await generateAdminPage(cwd, projectInfo);
        await generateMediaRoutes(cwd, projectInfo);
        await generateTypesDirectory(cwd, projectInfo);
        await patchNextConfig(cwd, database);
      }

      // App flows generate a root .env. A plugin is a library — its env lives
      // in the embedded dev/ playground (dev/.env.example), so skip it here.
      if (projectType !== "plugin") {
        const envDatabase = databaseUrl
          ? { ...database, connectionUrl: databaseUrl, envExample: databaseUrl }
          : database;
        await generateEnv(cwd, envDatabase);
      }
      s.stop("Environment configured");
    } catch (error) {
      s.stop("Failed to generate configuration");
      telemetry.capture("scaffold_failed", {
        stage: "config",
        error_code: classifyError(error, "config"),
        duration_ms: Date.now() - overallStartedAt,
      });
      p.cancel((error as Error).message);
      process.exit(1);
    }
  }

  // --- Success output ---

  const pm = projectInfo.packageManager;
  // npm requires `npm run <script>`; pnpm/yarn/bun accept the bare
  // form as a shorthand for `run`. Without this, scaffolds chosen
  // with npm print `npm dev` which fails with "Unknown command: dev".
  const devCommand = pm === "npm" ? "npm run dev" : `${pm} dev`;

  // Build next steps content
  const lines: string[] = [];

  if (isFreshProject && projectName && !installInCwd) {
    lines.push(`  ${pc.bold("cd")} ${projectName}`);
  }
  if (projectType === "plugin") {
    // Plugin scaffold: a publishable library with an embedded /dev playground.
    // No app DB / /admin/setup / storage notes — those don't apply.
    lines.push(`  ${pc.bold(devCommand)}`);
    lines.push(
      `  ${pc.dim("→ runs the embedded /dev playground (SQLite, hot-reload)")}`
    );
    lines.push("");
    lines.push(
      `  Open ${pc.cyan("http://localhost:3000/admin")} — auto-logged-in with your plugin registered.`
    );
    lines.push(
      `  Edit your plugin in ${pc.dim("src/")}; the ${pc.dim("dev/")} app is never published.`
    );
    lines.push("");
    lines.push(
      `  ${pc.bold(`${pm} test`)} runs the in-memory integration harness.`
    );
    lines.push(
      `  ${pc.bold(`${pm} run build`)}, then ${pc.bold("npm publish")} to ship.`
    );
    lines.push("");
    lines.push(
      `  Use it in an app: add ${pc.dim("myPlugin()")} to ${pc.dim("plugins")} in nextly.config.ts.`
    );
  } else {
    lines.push(`  ${pc.bold(devCommand)}`);
    lines.push("");

    // Database-specific note
    if (databaseType === "sqlite") {
      lines.push(
        `  Your database (SQLite) is stored at ${pc.dim("./data/nextly.db")}`
      );
    } else {
      lines.push(
        `  Make sure your ${DATABASE_LABELS[databaseType].label} server is running before starting.`
      );
    }
    lines.push(
      `  ${pc.bold(devCommand)} will create system tables on first run.`
    );

    // Template-specific notes
    if (projectType === "blog") {
      lines.push(
        `  Visit ${pc.cyan("http://localhost:3000")} to see your blog.`
      );
    }

    lines.push(
      `  Visit ${pc.cyan("http://localhost:3000/admin/setup")} to create your admin account.`
    );
    lines.push("");

    // Storage note
    lines.push(
      `  Storage: Using local disk ${pc.dim("(./public/uploads)")} by default.`
    );
    lines.push("  See docs to configure S3, Vercel Blob, or other providers.");
  }

  p.note(lines.join("\n"), "Next steps");

  // Telemetry: full successful scaffold (after install + config + env).
  telemetry.capture("scaffold_completed", {
    total_duration_ms: Date.now() - overallStartedAt,
    template: projectType,
    database: databaseType,
    approach: approach ?? null,
  });

  p.outro(`Docs: ${pc.cyan("https://nextlyhq.com/docs")}`);
}
