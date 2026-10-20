import path from "path";

import * as p from "@clack/prompts";
import * as telemetry from "@nextlyhq/telemetry";
import { classifyError } from "@nextlyhq/telemetry";
import fs from "fs-extra";
import pc from "picocolors";

import {
  type BundledSkill,
  bundledSkillsVersion,
  projectNextlyVersion,
  readBundledSkills,
  skillsVersionMismatch,
  writeAgentSkills,
} from "./generators/agent-skills";
import { generateEnv } from "./generators/env";
import { generateIntoExistingApp } from "./generators/existing-app";
import type { GeneratedFiles } from "./generators/generated-files";
import {
  type MediaRouteTemplates,
  readMediaRouteTemplates,
} from "./generators/media-routes";
import { reportGeneratedFiles } from "./generators/report";
import {
  installDependencies,
  nextlyPackagesToInstall,
} from "./installers/dependencies";
import {
  resolveTemplateSource,
  cleanupDownload,
  type TemplateSource,
} from "./lib/download-template";
import {
  nextlySource,
  nextlyVersionConflictMessage,
  nextlyVersionConflicts,
} from "./lib/nextly-release";
import { packageVersion } from "./lib/package-version";
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
  EnvGenerationResult,
  PackageManager,
  ProjectApproach,
  ProjectType,
} from "./types";
import {
  detectPackageManager,
  detectPluginPackage,
  detectProject,
} from "./utils/detect";
import { emptyDirectory, isDirectoryNotEmpty } from "./utils/fs";
import { scriptRunner } from "./utils/package-manager-commands";
import { copyTemplate, resolveTemplatePath } from "./utils/template";

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
 * Stop a run that failed while setting up the app's files: record where it
 * failed, say why, and exit. One place for it, since both the check of the
 * templates before anything is written and the writing itself end this way.
 */
function stopAtConfig(error: unknown, startedAt: number): never {
  telemetry.capture("scaffold_failed", {
    stage: "config",
    error_code: classifyError(error, "config"),
    duration_ms: Date.now() - startedAt,
  });
  p.cancel((error as Error).message);
  process.exit(1);
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
  // Where the project's Nextly packages come from, decided once: this CLI's
  // own release unless a source was asked for (see NextlySource).
  const source = nextlySource({
    cliVersion: packageVersion(),
    useYalc,
    localTemplatePath: options.localTemplatePath,
    branch: options.branch,
  });
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

  // The plugin template creates a standalone package and never installs into an
  // app. Run from inside a Next.js app, which is a natural place to start a
  // plugin for it, it still takes the fresh-scaffold path: installing into the
  // app would add app dependencies and config and never copy the plugin.
  const existingProject =
    options.projectType !== "plugin" && (await isExistingNextProject(cwd));

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

  if (projectType === "plugin") {
    // The plugin playground always runs on SQLite (dev/.env.example), so an
    // answer here would be collected and then ignored.
    if (options.database && options.database !== "sqlite") {
      p.log.warn(
        `The plugin playground runs on SQLite; --database ${options.database} does not apply.`
      );
    }
    databaseType = "sqlite";
  } else if (options.database) {
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

  // --- Step 7: Skills for coding agents ---
  //
  // Asked for an app, new or existing; a plugin is a library and the skills
  // are about building an app. Read now, before anything is installed or
  // written, so a broken bundle stops the run while the project is untouched.

  let agentSkills: BundledSkill[] = [];
  // The release the bundled skills were checked against, from their own
  // frontmatter; which projects get them is decided by it.
  let agentSkillsVersion = "";
  if (projectType !== "plugin" && options.skills !== false) {
    let addSkills = true;
    if (!defaults) {
      const answer = await p.confirm({
        message:
          "Add Nextly skills for coding agents (Claude Code, Codex, Cursor)?",
        initialValue: true,
      });
      if (p.isCancel(answer)) {
        p.cancel("Cancelled.");
        return;
      }
      addSkills = answer;
    }
    if (addSkills) {
      try {
        agentSkills = await readBundledSkills();
        agentSkillsVersion = bundledSkillsVersion(agentSkills);
      } catch (error) {
        p.cancel((error as Error).message);
        process.exit(1);
      }
    }
  }

  // --- Scaffold project from template ---

  // A new project's package manager, settled here before any file is written
  // and kept by detection below: the scaffold writes pnpm-workspace.yaml for
  // its build allowlist whatever manager installs it, so reading the files
  // back would answer differently.
  let scaffoldPackageManager: PackageManager | undefined;

  if (isFreshProject && projectName) {
    const targetDir = installInCwd ? cwd : path.join(cwd, projectName);

    const s = p.spinner();
    let templateSource: TemplateSource | undefined;

    try {
      // Resolve template source (download from GitHub or use local path).
      // Bundled templates (blank, plugin) copy the version shipped inside the
      // CLI, which matches the packages this release installs. Content
      // templates (blog) are downloaded at this release's tag, and any
      // template given an explicit source (--local-template, --branch or
      // --use-yalc) resolves from it, so local-dev runs pair yalc-linked
      // packages with the live template rather than the bundled copy.
      const useBundledTemplate = shouldUseBundledTemplate(projectType, {
        localTemplatePath: options.localTemplatePath,
        useYalc,
        branch: options.branch,
      });
      if (!useBundledTemplate) {
        s.start("Resolving template...");
        templateSource = await resolveTemplateSource(projectType, {
          localTemplatePath: options.localTemplatePath,
          branch: options.branch,
          source,
        });
        s.stop("Template ready");
        s.start("Scaffolding project...");
      } else {
        s.start("Scaffolding project...");
      }

      // Decides whether the scaffold gets a `.npmrc`. Resolved from the user
      // agent of the command that invoked this CLI, which is the package
      // manager that will run the install a moment later; the target has no
      // lockfile yet, so nothing else could answer.
      scaffoldPackageManager = await detectPackageManager(targetDir);

      await copyTemplate({
        projectName,
        projectType,
        targetDir,
        database,
        useYalc,
        approach,
        templateSource,
        packageManager: scaffoldPackageManager,
        // Suppress copyTemplate's "directory already exists" guard when the
        // installer has already negotiated the conflict with the user
        // (either by emptying the dir or accepting an overlay). Without
        // this, the "ignore" path would still throw on the subdirectory
        // case where the target was non-empty.
        allowExistingTarget,
        nextlySource: source,
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
        // A plugin keeps its library in src/ and its Next.js app in dev/, a
        // layout the app detector rejects ("App Router not detected").
        projectInfo = await detectPluginPackage(cwd, scaffoldPackageManager);
        s.stop("Detected plugin package");
      } else {
        projectInfo = await detectProject(cwd, scaffoldPackageManager);
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

  // --- An existing app's Nextly version ---

  // Before anything is written or installed: an app that already has a Nextly
  // package at another version would end with a mixed set, which the
  // lockstep does not allow, and changing a version it chose is not this
  // CLI's to do. So it stops with the app exactly as it was.
  if (!isFreshProject && source.kind === "release") {
    const conflicts = await nextlyVersionConflicts(
      cwd,
      source.cliVersion,
      nextlyPackagesToInstall(database)
    );
    if (conflicts.length > 0) {
      telemetry.capture("scaffold_failed", {
        stage: "detect",
        error_code: "unknown",
        duration_ms: Date.now() - overallStartedAt,
      });
      p.cancel(
        nextlyVersionConflictMessage(
          conflicts,
          source.cliVersion,
          projectInfo.packageManager
        )
      );
      process.exit(1);
    }
  }

  // --- Read what the existing-app path writes ---

  // Every template the existing-app path writes from is read now, before the
  // install and before any file: a missing or incomplete --local-template
  // otherwise stopped the run part-way, with the config already written, so
  // a retry failed on it.
  let mediaRouteTemplates: MediaRouteTemplates | undefined;
  if (!isFreshProject) {
    try {
      mediaRouteTemplates = await readMediaRouteTemplates(
        resolveTemplatePath(options.localTemplatePath)
      );
    } catch (error) {
      stopAtConfig(error, overallStartedAt);
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
      const settingsChanged = await installDependencies(
        cwd,
        projectInfo,
        database,
        source,
        isFreshProject,
        projectType
      );
      s.stop("Dependencies installed");
      // What the install changed in the project's own settings files, said
      // after the spinner so each line stays on screen.
      for (const note of settingsChanged) p.log.info(note);
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

  let envResult: EnvGenerationResult | undefined;

  {
    const s = p.spinner();
    s.start("Setting up environment...");
    // What the existing-app steps did, for the one report printed below.
    const reported: GeneratedFiles[] = [];
    // Said once the spinner stops, after what was written and left alone.
    const warnings: string[] = [];
    try {
      if (!isFreshProject) {
        // Existing project: Nextly's files, each written only where nothing
        // is, and the Next config extended.
        if (mediaRouteTemplates === undefined) {
          throw new Error("The route templates were not read before writing.");
        }
        reported.push(
          ...(await generateIntoExistingApp(
            cwd,
            projectType,
            projectInfo,
            database,
            mediaRouteTemplates
          ))
        );
      }

      // App flows generate a root .env. A plugin is a library — its env lives
      // in the embedded dev/ playground (dev/.env.example), so skip it here.
      // A URL the person typed goes to .env only; .env.example keeps the
      // database's generic example, since a project commits that file and a
      // typed URL carries its password.
      if (projectType !== "plugin") {
        const envDatabase = databaseUrl
          ? { ...database, connectionUrl: databaseUrl }
          : database;
        envResult = await generateEnv(cwd, envDatabase);
      }
      if (agentSkills.length > 0) {
        // Written only into a project on the release the skills were checked
        // against; after the install, so the release read is the one
        // installed.
        const mismatch = skillsVersionMismatch(
          await projectNextlyVersion(cwd),
          agentSkillsVersion
        );
        if (mismatch === null) {
          reported.push(
            // The update command names this CLI's release, whose tag publishes
            // this bundle; the release the skills were checked against may
            // be an older one whose tag carries no user skills.
            await writeAgentSkills(cwd, agentSkills, packageVersion())
          );
        } else {
          warnings.push(mismatch);
        }
      }
      s.stop("Environment configured");
      // One report for every step, the env files and the skills included,
      // after the spinner stops so its lines are not drawn over. Paths, keys
      // and packages only: nothing in it ever carries an env value.
      reportGeneratedFiles(
        envResult ? [...reported, envResult.files] : reported,
        [...(envResult?.warnings ?? []), ...warnings]
      );
    } catch (error) {
      s.stop("Failed to generate configuration");
      stopAtConfig(error, overallStartedAt);
    }
  }

  // --- Success output ---

  const pm = projectInfo.packageManager;
  // Through the shared renderer, so the next-steps screen and the agent guide written into the
  // project cannot disagree about how this manager spells "run a script".
  const devCommand = `${scriptRunner(pm)} dev`;

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
      `  Open ${pc.cyan("http://localhost:3000/admin")} — signed in as the dev user, your plugin registered.`
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
