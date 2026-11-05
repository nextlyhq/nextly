/**
 * Init Command
 *
 * Implements the `nextly init` command for project scaffolding.
 * Creates the necessary directory structure, configuration files,
 * and optionally an example collection.
 *
 * @module cli/commands/init
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Interactive mode - prompts for options
 * nextly init
 *
 * # Non-interactive mode with defaults
 * nextly init -y
 * nextly init --yes
 *
 * # Force overwrite existing files
 * nextly init --force
 *
 * # Name what would be written; write nothing
 * nextly init --yes --dry-run
 * ```
 */

import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { confirm, input } from "@inquirer/prompts";
import type { Command } from "commander";
import pc from "picocolors";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { projectUsesSrcLayout } from "../../shared/lib/generated-output-paths";
import { reportDryRun, type DryRunChange } from "../dry-run";
import { exitWithError } from "../errors";
import {
  initAnswersRequired,
  projectAlreadyInitialized,
} from "../errors/areas/commands";
import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../program";
import {
  isPromptForceClosed,
  promptCancelled,
} from "../utils/prompt-cancelled";

/**
 * Options specific to the init command
 */
export interface InitCommandOptions {
  /**
   * Skip prompts and use defaults
   * @default false
   */
  yes?: boolean;

  /**
   * Overwrite existing files
   * @default false
   */
  force?: boolean;

  /**
   * Name every file and folder the run would make, and make none
   * @default false
   */
  dryRun?: boolean;
}

/**
 * Combined options (global + command-specific)
 */
interface ResolvedInitOptions extends InitCommandOptions {
  cwd?: string;
  verbose?: boolean;
  quiet?: boolean;
}

/**
 * User answers from interactive prompts
 */
interface InitAnswers {
  collectionsDir: string;
  createExampleCollection: boolean;
}

/**
 * Every path init writes, under one base: `./src` when the app keeps its code
 * there, `.` when it has a root app/ (the Next.js rule generation follows too,
 * so what init names is where generation writes).
 */
interface InitPaths {
  base: string;
  collectionsDir: string;
  schemasDir: string;
  zodDir: string;
  migrationsDir: string;
  typesDir: string;
  libDir: string;
}

/**
 * One thing init makes, by its path relative to the project as the run names
 * it: a folder, or a file with its content. A file not announced is logged
 * only under `--verbose`.
 */
type InitStep =
  | { kind: "folder"; path: string }
  | { kind: "file"; path: string; content: string; announce: boolean };

function initPaths(cwd: string): InitPaths {
  const base = projectUsesSrcLayout(cwd) ? "./src" : ".";
  return {
    base,
    collectionsDir: `${base}/collections`,
    schemasDir: `${base}/db/schemas/collections`,
    zodDir: `${base}/db/schemas/zod`,
    migrationsDir: `${base}/db/migrations`,
    typesDir: `${base}/types/generated`,
    libDir: `${base}/lib`,
  };
}

/**
 * Execute the init command
 *
 * @param options - Combined global and command options
 * @param context - Command context with logger
 */
export async function runInit(
  options: ResolvedInitOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const cwd = options.cwd ?? process.cwd();

  logger.header("Nextly Init");

  const configPath = join(cwd, "nextly.config.ts");
  if (existsSync(configPath) && !options.force) {
    const refusal = projectAlreadyInitialized(configPath);
    // A dry run names the refusal the real run would end with, and ends
    // normally: the refusal is what the real run would do.
    if (options.dryRun) {
      reportDryRun(logger, {
        changes: [],
        refusals: [`${refusal.what} ${refusal.why}`],
      });
      return;
    }
    exitWithError(logger, refusal);
  }

  const paths = initPaths(cwd);
  const defaults: InitAnswers = {
    collectionsDir: paths.collectionsDir,
    createExampleCollection: true,
  };
  let answers: InitAnswers;

  if (options.yes) {
    answers = { ...defaults };
    logger.info("Using default configuration...");
  } else if (!canPrompt()) {
    // Nobody can answer the questions: stop before anything is written and
    // name the flag that answers them with the defaults.
    exitWithError(logger, initAnswersRequired());
  } else {
    logger.info("Answer a few questions to set up your project.\n");

    try {
      answers = await promptUser(defaults);
    } catch (error) {
      // Ctrl+C at a prompt: nothing has been written yet, and the run ends
      // as interrupted, exit 130.
      if (isPromptForceClosed(error)) {
        logger.warn("\nSetup cancelled.");
        await promptCancelled();
      }
      throw error;
    }
  }

  // The answers decide the steps; the real run makes them and a dry run
  // names them, so both report the same list.
  const steps = initSteps(answers, paths);
  if (options.dryRun) {
    reportDryRun(logger, {
      changes: steps.flatMap(step => {
        const change = stepChange(cwd, step);
        return change ? [change] : [];
      }),
      refusals: filesInTheWay(cwd, steps),
    });
    return;
  }

  logger.newline();
  logger.info("Initializing Nextly...");
  logger.newline();

  for (const step of steps) await makeStep(cwd, step, context);

  logger.newline();
  logger.divider();
  logger.success("Nextly initialized successfully!");
  logger.newline();

  showNextSteps(cwd, context);
}

async function promptUser(defaults: InitAnswers): Promise<InitAnswers> {
  const collectionsDir = await input({
    message: "Collections directory:",
    default: defaults.collectionsDir,
  });

  const createExampleCollection = await confirm({
    message: "Create an example collection?",
    default: true,
  });

  return {
    collectionsDir,
    createExampleCollection,
  };
}

/** Everything init makes for `answers`, in the order it makes it. */
function initSteps(answers: InitAnswers, paths: InitPaths): InitStep[] {
  const folders = [
    answers.collectionsDir,
    paths.schemasDir,
    paths.zodDir,
    paths.migrationsDir,
    paths.typesDir,
  ];
  const steps: InitStep[] = folders.map(path => ({ kind: "folder", path }));
  const file = (path: string, content: string, announce = true): InitStep => ({
    kind: "file",
    path,
    content,
    announce,
  });

  steps.push(file("nextly.config.ts", generateConfigTemplate(answers, paths)));

  if (answers.createExampleCollection) {
    steps.push(
      file(
        `${answers.collectionsDir}/posts.ts`,
        generateExampleCollectionTemplate()
      ),
      file(
        `${answers.collectionsDir}/index.ts`,
        generateCollectionsIndexTemplate()
      ),
      // The config sits at the project root: two levels up from src/lib/,
      // one from a root lib/.
      file(
        `${paths.libDir}/nextly.ts`,
        generateNextlyHelperTemplate(
          paths.base === "./src" ? "../../nextly.config" : "../nextly.config"
        )
      )
    );
  }

  steps.push(
    file(`${paths.typesDir}/.gitkeep`, "", false),
    file(`${paths.migrationsDir}/.gitkeep`, "", false)
  );
  return steps;
}

/**
 * Makes one step in `cwd`, with any folder a file needs. A path resolves
 * against `cwd`, so an absolute collections folder answered at the prompt is
 * where both the folder and its files go.
 */
async function makeStep(
  cwd: string,
  step: InitStep,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const target = resolve(cwd, step.path);

  if (step.kind === "folder") {
    await mkdir(target, { recursive: true });
    logger.success(`Created ${step.path}/`);
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, step.content, "utf-8");
  if (step.announce) logger.success(`Created ${step.path}`);
  else logger.debug(`Created ${step.path}`);
}

/**
 * What a step would change in `cwd`, as a dry run names it: every file, and
 * each folder not already there (making one that exists changes nothing).
 */
function stepChange(cwd: string, step: InitStep): DryRunChange | null {
  if (step.kind === "file") return { action: "write", target: step.path };
  if (existsSync(resolve(cwd, step.path))) return null;
  return { action: "write", target: `${step.path}/` };
}

/**
 * Each folder the steps need that is a file on disk, which the real run's
 * `mkdir` fails on: a folder step's own path, and every folder above a file.
 * A dry run names each as the real run's refusal.
 */
function filesInTheWay(cwd: string, steps: readonly InitStep[]): string[] {
  const needed = new Set<string>();
  for (const step of steps) {
    let folder = step.kind === "folder" ? step.path : dirname(step.path);
    while (folder !== "." && folder !== "" && folder !== dirname(folder)) {
      needed.add(folder);
      folder = dirname(folder);
    }
  }
  return [...needed]
    .filter(folder => {
      const at = resolve(cwd, folder);
      return existsSync(at) && !statSync(at).isDirectory();
    })
    .map(folder => `${folder} is a file, where a folder is needed.`);
}

function generateConfigTemplate(
  answers: InitAnswers,
  paths: InitPaths
): string {
  const collectionsImport = answers.createExampleCollection
    ? `import Posts from "${answers.collectionsDir.replace(/^\.\//, "./")}${answers.collectionsDir.endsWith("/") ? "" : "/"}posts";\n`
    : "";

  const collectionsArray = answers.createExampleCollection
    ? "Posts,"
    : "// Import your collections here";

  return `import { defineConfig } from "nextly/config";
${collectionsImport}
export default defineConfig({
  collections: [
    ${collectionsArray}
  ],
  typescript: {
    outputFile: "${paths.typesDir}/nextly-types.ts",
  },
  db: {
    schemasDir: "${paths.schemasDir}",
    migrationsDir: "${paths.migrationsDir}",
  },
});
`;
}

function generateCollectionsIndexTemplate(): string {
  return `/**
 * Collections Index
 *
 * Re-export all collection definitions from this file.
 * Import this in your nextly.config.ts for cleaner organization.
 */

export { default as Posts } from "./posts";

// Add more collection exports as you create them.
`;
}

/**
 * The `lib/nextly.ts` a generated project gets.
 *
 * Exported so its output can be asserted on. It is a template literal, so
 * nothing here is type-checked or executed by the build, and the two exported
 * startup paths it defines have to agree about booting, about passing the
 * config, and about when initialization is complete.
 */
export function generateNextlyHelperTemplate(
  configImport = "../../nextly.config"
): string {
  return `/**
 * Nextly Instance Helper
 *
 * This file provides a singleton pattern for the Nextly instance
 * and registers code-first collection hooks at startup.
 *
 * Usage in your app:
 * \`\`\`typescript
 * import { getNextlyInstance, initializeNextly } from "@/lib/nextly";
 *
 * // Option 1: Get Nextly instance directly (initializes hooks automatically)
 * const nextly = await getNextlyInstance();
 *
 * // Option 2: Call once at app startup (for hooks only)
 * await initializeNextly();
 * \`\`\`
 */

import { getNextly, type Nextly } from "nextly";
import nextlyConfig from "${configImport}";

// Track initialization state
let initialized = false;

/**
 * Get the Nextly instance with services configured.
 *
 * This function returns a cached singleton instance of Nextly
 * with all services (collections, users, media) ready to use.
 * It also registers any code-first collection hooks.
 */
export async function getNextlyInstance(): Promise<Nextly> {
  // Straight to the boot. It registers the config's collection hooks itself,
  // so there is nothing to arrange first -- and routing through
  // initializeNextly() would cycle, since that function boots by calling
  // this one.

  // Get the Nextly instance with minimal storage/image processor config
  // In a real app, you'd configure these with actual implementations
  const instance = await getNextly({
    // Required on every call, and the reason this module imports the config.
    config: nextlyConfig,
    storage: {
      upload: async () => ({ path: "", url: "" }),
      delete: async () => {},
      getUrl: () => "",
      exists: async () => false,
      getMetadata: async () => ({ size: 0, mimeType: "" }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stub storage adapter for CLI init
    } as any,
    imageProcessor: {
      resize: async (buffer: Buffer) => buffer,
      optimize: async (buffer: Buffer) => buffer,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Stub image processor for CLI init
    } as any,
  });

  // Only once the boot has resolved. Setting it beforehand marks an app
  // initialized when the database or config was unavailable, and the retry a
  // caller then makes returns early without ever booting.
  initialized = true;
  return instance;
}

/**
 * Initialize Nextly and register collection hooks
 *
 * Call this once at app startup (e.g., in your API route handler
 * or server initialization).
 */
export async function initializeNextly(): Promise<void> {
  if (initialized) {
    return;
  }

  try {
    // Boot Nextly, which is what registers the config's collection hooks.
    // Registering them here as well would append the same handlers a second
    // time and run every hook twice, so this defers to the one boot rather
    // than repeating it -- and it has to call something, since a function that
    // reports success without booting leaves an app with no hooks at all.
    await getNextlyInstance();

    initialized = true;
    console.log("[Nextly] Initialized successfully");
  } catch (error) {
    console.error("[Nextly] Initialization failed:", error);
    throw error;
  }
}

/**
 * Check if Nextly has been initialized
 */
export function isNextlyInitialized(): boolean {
  return initialized;
}
`;
}

function generateExampleCollectionTemplate(): string {
  return `import {
  defineCollection,
  text,
  textarea,
  select,
  checkbox,
  type HookHandler,
} from "nextly/config";

// ============================================================================
// HOOKS - Custom business logic for your collection
// ============================================================================

/**
 * Auto-generate slug from title
 *
 * This hook runs before create/update operations and automatically
 * generates a URL-friendly slug from the title if not provided.
 */
const autoSlugHook: HookHandler = async ({ data, operation }) => {
  if ((operation === "create" || operation === "update") && data?.title && !data?.slug) {
    const slug = data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return { ...data, slug };
  }
  return data;
};

/**
 * Log changes for debugging
 *
 * This hook runs after any change operation and logs the action.
 * Replace with your own notification logic (email, Slack, etc.)
 */
const logChangeHook: HookHandler = async ({ data, operation }) => {
  console.log(\`[Posts] \${operation} completed:\`, data?.title);
  // Example: await sendSlackNotification(\`Post \${operation}: \${data?.title}\`);
};

// ============================================================================
// COLLECTION DEFINITION
// ============================================================================

/**
 * Posts Collection
 *
 * An example collection demonstrating Nextly's code-first approach.
 * This includes:
 * - Field definitions with validation
 * - Hooks for auto-slug generation
 * - Admin UI configuration
 *
 * You can customize this or create your own collections.
 */
export default defineCollection({
  // Unique identifier (becomes the table name)
  slug: "posts",

  // Display labels in Admin UI
  labels: {
    singular: "Post",
    plural: "Posts",
  },

  // Field definitions
  fields: [
    text({
      name: "title",
      required: true,
      minLength: 5,
      maxLength: 200,
      admin: {
        placeholder: "Enter post title...",
        description: "The main title of the post",
      },
    }),

    text({
      name: "slug",
      unique: true,
      admin: {
        description: "URL-friendly identifier (auto-generated from title if empty)",
        readOnly: true,
      },
    }),

    text({
      name: "author",
      admin: {
        placeholder: "Author name",
      },
    }),

    textarea({
      name: "excerpt",
      maxLength: 300,
      admin: {
        description: "Brief summary for previews (max 300 characters)",
      },
    }),

    textarea({
      name: "content",
      admin: {
        description: "Main post content",
        rows: 10,
      },
    }),

    select({
      name: "status",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
        { label: "Archived", value: "archived" },
      ],
      defaultValue: "draft",
      required: true,
    }),

    checkbox({
      name: "featured",
      defaultValue: false,
      admin: {
        description: "Show in featured section",
      },
    }),
  ],

  // Enable automatic timestamp fields (createdAt, updatedAt)
  timestamps: true,

  // Hooks for custom business logic
  hooks: {
    // Runs before data is saved to the database
    beforeChange: [autoSlugHook],

    // Runs after data is saved to the database
    afterChange: [logChangeHook],

    // Other available hooks:
    // beforeRead: [],   // Before fetching data
    // afterRead: [],    // After fetching data (can enrich/transform)
    // beforeDelete: [], // Before deletion
    // afterDelete: [],  // After deletion (cleanup, notifications)
  },

  // Admin UI configuration
  admin: {
    useAsTitle: "title",
    group: "Content",
    description: "Blog posts and articles",
  },
});
`;
}

function detectPackageManager(cwd: string): "pnpm" | "yarn" | "npm" {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

function getPackageManagerCommand(pm: "pnpm" | "yarn" | "npm"): string {
  switch (pm) {
    case "pnpm":
      return "pnpm";
    case "yarn":
      return "yarn";
    case "npm":
      return "npx";
  }
}

// ============================================================================
// Next Steps Display
// ============================================================================

/**
 * Show next steps after successful initialization
 */
function showNextSteps(cwd: string, context: CommandContext): void {
  const { logger } = context;
  const pm = detectPackageManager(cwd);
  const cmd = getPackageManagerCommand(pm);

  logger.info(pc.bold("Next steps:"));
  logger.newline();

  // Step 1: Environment setup
  logger.info(
    `  ${pc.cyan("1.")} Copy ${pc.yellow(".env.example")} to ${pc.yellow(".env")} and configure your database`
  );

  // Step 2: Install dependencies (if not already installed)
  if (pm === "npm") {
    logger.info(
      `  ${pc.cyan("2.")} Run ${pc.yellow("npm install nextly")} to install Nextly`
    );
  } else {
    logger.info(
      `  ${pc.cyan("2.")} Run ${pc.yellow(`${pm} add nextly`)} to install Nextly`
    );
  }

  // Step 3: Sync collections
  logger.info(
    `  ${pc.cyan("3.")} Run ${pc.yellow(`${cmd} next dev`)} to sync collections`
  );

  // Step 4: Generate migrations
  logger.info(
    `  ${pc.cyan("4.")} Run ${pc.yellow(`${cmd} nextly migrate:create --name="<migration-name>"`)} to generate migrations`
  );

  // Step 5: Apply migrations
  logger.info(
    `  ${pc.cyan("5.")} Run ${pc.yellow(`${cmd} nextly migrate`)} to apply migrations`
  );

  logger.newline();

  // Documentation link
  logger.info(
    `${pc.gray("Documentation:")} ${pc.cyan("https://nextlyhq.com/docs")}`
  );
  logger.newline();
}

// ============================================================================
// Command Action
// ============================================================================

/** The action of `nextly init`, loaded when it runs. */
export async function initAction(cmdOptions: InitCommandOptions, cmd: Command) {
  const globalOpts: GlobalOptions = cmd.optsWithGlobals();
  const context = createContext(globalOpts);

  const resolvedOptions: ResolvedInitOptions = {
    ...cmdOptions,
    cwd: globalOpts.cwd,
    verbose: globalOpts.verbose,
    quiet: globalOpts.quiet,
  };

  try {
    await runInit(resolvedOptions, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
