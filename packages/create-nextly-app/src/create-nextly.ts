import path from "path";

import * as p from "@clack/prompts";
import * as telemetry from "@nextly/telemetry";
import { classifyError } from "@nextly/telemetry";
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
  templateHasDemoData,
  getDefaultApproach,
} from "./lib/templates";
import { getApproachPromptOptions } from "./prompts/approach";
import { DATABASE_CONFIGS, DATABASE_LABELS } from "./prompts/database";
import { DEMO_DATA_LABELS } from "./prompts/demo-data";
import { isExistingNextProject } from "./prompts/project-name";
import {
  getTemplatePromptOptions,
  isValidTemplateSelection,
} from "./prompts/template";
import type {
  CreateNextlyOptions,
  DatabaseConfig,
  DatabaseType,
  ProjectApproach,
  ProjectType,
} from "./types";
import { detectProject } from "./utils/detect";
import { copyTemplate } from "./utils/template";

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
 * 3. Schema approach (code-first, visual, both) - only for content templates
 * 4. Demo content (yes/no) - only for content templates
 * 5. Database selection (sqlite, postgresql, mysql)
 * 6. Database connection string (only for postgresql/mysql)
 */
export async function createNextly(
  options: CreateNextlyOptions = {}
): Promise<void> {
  const {
    defaults = false,
    skipInstall = false,
    useYalc = false,
    installInCwd = false,
  } = options;
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
    projectName = path.basename(cwd);
    isFreshProject = true;
  } else {
    // Interactive or defaults: get project name
    if (options.projectNameFromArg) {
      projectName = options.projectNameFromArg;
    } else if (!defaults) {
      const name = await p.text({
        message: "What should your project be called?",
        placeholder: "my-nextly-app",
        defaultValue: "my-nextly-app",
        validate: value => {
          // Empty input uses the default value (handled by @clack/prompts defaultValue)
          if (!value || !value.trim()) return undefined;
          if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) {
            return "Use lowercase letters, numbers, hyphens, dots, or underscores";
          }
        },
      });

      if (p.isCancel(name)) {
        p.cancel("Cancelled.");
        return;
      }

      projectName = name;
    } else {
      projectName = "my-nextly-app";
    }

    isFreshProject = true;
  }

  // --- Step 2: Template selection ---

  let projectType: ProjectType;

  if (options.projectType) {
    projectType = options.projectType;
  } else if (defaults) {
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

      approach = selected as ProjectApproach;
    }
  }

  // Telemetry: template + approach selected (no project name).
  telemetry.capture("template_selected", {
    template: projectType,
    approach: approach ?? null,
  });

  // --- Step 4: Demo content (only for content templates with demo data) ---

  let demoData = false;

  if (templateHasDemoData(projectType)) {
    // Content template selected - ask about demo content
    if (options.demoData !== undefined) {
      demoData = options.demoData;
    } else if (defaults) {
      demoData = false;
    } else {
      const includeDemoData = await p.confirm({
        message: "Include demo content?",
        active: DEMO_DATA_LABELS.active,
        inactive: DEMO_DATA_LABELS.inactive,
        initialValue: true,
      });

      if (p.isCancel(includeDemoData)) {
        p.cancel("Cancelled.");
        return;
      }

      demoData = includeDemoData;
    }
  }

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

    databaseType = db as DatabaseType;
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
    const s = p.spinner();
    let templateSource: TemplateSource | undefined;

    try {
      // Resolve template source (download from GitHub or use local path).
      // For "blank" template without --local-template, we use the bundled
      // fallback embedded in the CLI. For content templates (blog) we
      // resolve via GitHub or a local path. --use-yalc also triggers
      // resolution for the blank template so local-dev runs always pair
      // yalc-linked packages with the live template rather than a
      // potentially-stale bundled copy.
      if (projectType !== "blank" || options.localTemplatePath || useYalc) {
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

      // When installInCwd is true, scaffold directly into cwd (no subdirectory)
      const targetDir = installInCwd ? cwd : path.join(cwd, projectName);

      if (installInCwd) {
        // For cwd installation, check if directory is empty enough
        const entries = await fs.readdir(cwd);
        const nonHidden = entries.filter(e => !e.startsWith("."));
        if (nonHidden.length > 0) {
          s.stop("Directory not empty");
          p.cancel(
            "Directory is not empty. Remove existing files or use a project name to create a subdirectory."
          );
          return;
        }
        await copyTemplate({
          projectName,
          projectType,
          targetDir: cwd,
          database,
          databaseUrl,
          useYalc,
          approach,
          demoData,
          templateSource,
        });
      } else {
        await copyTemplate({
          projectName,
          projectType,
          targetDir,
          database,
          databaseUrl,
          useYalc,
          approach,
          demoData,
          templateSource,
        });
        cwd = targetDir;
      }

      s.stop("Project scaffolded");
    } catch (error) {
      s.stop("Scaffolding failed");
      if (!installInCwd) {
        // Clean up partial copy
        const targetDir = path.join(cwd, projectName!);
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
      projectInfo = await detectProject(cwd);
      s.stop(`Detected Next.js ${projectInfo.nextVersion || "unknown"}`);
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
        isFreshProject
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
        await patchNextConfig(cwd);
      }

      // Both flows: generate .env with database URL and NEXTLY_SECRET
      const envDatabase = databaseUrl
        ? { ...database, connectionUrl: databaseUrl, envExample: databaseUrl }
        : database;
      await generateEnv(cwd, envDatabase);
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
    if (demoData) {
      lines.push(
        `  Demo content (${pc.dim("posts, authors, categories")}) will be seeded automatically.`
      );
    }
    lines.push(`  Visit ${pc.cyan("http://localhost:3000")} to see your blog.`);
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

  p.note(lines.join("\n"), "Next steps");

  // Telemetry: full successful scaffold (after install + config + env).
  telemetry.capture("scaffold_completed", {
    total_duration_ms: Date.now() - overallStartedAt,
    template: projectType,
    database: databaseType,
    approach: approach ?? null,
    demo_data: demoData,
  });

  p.outro(`Docs: ${pc.cyan("https://nextlyhq.com/docs")}`);
}
