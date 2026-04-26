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
 * ```
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { confirm, input } from "@inquirer/prompts";
import type { Command } from "commander";
import pc from "picocolors";

import {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "../program.js";

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

const DEFAULTS: InitAnswers = {
  collectionsDir: "./src/collections",
  createExampleCollection: true,
};

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
    logger.error("Nextly is already initialized in this directory.");
    logger.info("Use --force to overwrite existing configuration.");
    process.exit(1);
  }

  let answers: InitAnswers;

  if (options.yes) {
    answers = { ...DEFAULTS };
    logger.info("Using default configuration...");
  } else {
    logger.info("Answer a few questions to set up your project.\n");

    try {
      answers = await promptUser();
    } catch (error) {
      // User cancelled (Ctrl+C)
      if (
        error instanceof Error &&
        error.message.includes("User force closed")
      ) {
        logger.warn("\nSetup cancelled.");
        process.exit(0);
      }
      throw error;
    }
  }

  logger.newline();
  logger.info("Initializing Nextly...");
  logger.newline();

  await createDirectories(cwd, answers, context);

  await createConfigFile(cwd, answers, context);

  if (answers.createExampleCollection) {
    await createExampleCollection(cwd, answers, context);
  }

  await createGitkeepFiles(cwd, context);

  logger.newline();
  logger.divider();
  logger.success("Nextly initialized successfully!");
  logger.newline();

  showNextSteps(cwd, context);
}

async function promptUser(): Promise<InitAnswers> {
  const collectionsDir = await input({
    message: "Collections directory:",
    default: DEFAULTS.collectionsDir,
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

async function createDirectories(
  cwd: string,
  answers: InitAnswers,
  context: CommandContext
): Promise<string[]> {
  const { logger } = context;

  const dirs = [
    answers.collectionsDir,
    "./src/db/schemas/collections",
    "./src/db/schemas/zod",
    "./src/db/migrations",
    "./src/types/generated",
  ];

  for (const dir of dirs) {
    const fullPath = resolve(cwd, dir);
    await mkdir(fullPath, { recursive: true });
    logger.success(`Created ${dir}/`);
  }

  return dirs;
}

async function createConfigFile(
  cwd: string,
  answers: InitAnswers,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  const content = generateConfigTemplate(answers);
  const configPath = join(cwd, "nextly.config.ts");

  await writeFile(configPath, content, "utf-8");
  logger.success("Created nextly.config.ts");
}

function generateConfigTemplate(answers: InitAnswers): string {
  const collectionsImport = answers.createExampleCollection
    ? `import Posts from "${answers.collectionsDir.replace(/^\.\//, "./")}${answers.collectionsDir.endsWith("/") ? "" : "/"}posts";\n`
    : "";

  const collectionsArray = answers.createExampleCollection
    ? "Posts,"
    : "// Import your collections here";

  return `import { defineConfig } from "@revnixhq/nextly/config";
${collectionsImport}
export default defineConfig({
  collections: [
    ${collectionsArray}
  ],
  typescript: {
    outputFile: "./src/types/generated/nextly-types.ts",
  },
  db: {
    schemasDir: "./src/db/schemas/collections",
    migrationsDir: "./src/db/migrations",
  },
});
`;
}

async function createExampleCollection(
  cwd: string,
  answers: InitAnswers,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  const content = generateExampleCollectionTemplate();
  const collectionPath = join(cwd, answers.collectionsDir, "posts.ts");

  await mkdir(join(cwd, answers.collectionsDir), { recursive: true });

  await writeFile(collectionPath, content, "utf-8");
  logger.success(`Created ${answers.collectionsDir}/posts.ts`);

  const indexContent = generateCollectionsIndexTemplate();
  const indexPath = join(cwd, answers.collectionsDir, "index.ts");
  await writeFile(indexPath, indexContent, "utf-8");
  logger.success(`Created ${answers.collectionsDir}/index.ts`);

  await createNextlyHelper(cwd, context);
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

async function createNextlyHelper(
  cwd: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  const libDir = join(cwd, "src/lib");
  await mkdir(libDir, { recursive: true });

  const content = generateNextlyHelperTemplate();
  const helperPath = join(libDir, "nextly.ts");

  await writeFile(helperPath, content, "utf-8");
  logger.success("Created src/lib/nextly.ts");
}

function generateNextlyHelperTemplate(): string {
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

import { getNextly, registerCollectionHooks, type Nextly } from "@revnixhq/nextly";
import nextlyConfig from "../../nextly.config";

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
  // Register hooks if not already done
  if (!initialized) {
    await initializeNextly();
  }

  // Get the Nextly instance with minimal storage/image processor config
  // In a real app, you'd configure these with actual implementations
  return getNextly({
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
    // Register code-first collection hooks with the global registry
    if (nextlyConfig.collections && nextlyConfig.collections.length > 0) {
      const result = registerCollectionHooks(nextlyConfig.collections);
      console.log(
        \`[Nextly] Registered \${result.totalHooks} hooks for \${result.collections.length} collections\`
      );
    }

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
} from "@revnixhq/nextly/config";

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

async function createGitkeepFiles(
  cwd: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  const gitkeepPaths = [
    "./src/types/generated/.gitkeep",
    "./src/db/migrations/.gitkeep",
  ];

  for (const gitkeepPath of gitkeepPaths) {
    const fullPath = join(cwd, gitkeepPath);
    await writeFile(fullPath, "", "utf-8");
  }

  logger.debug("Created .gitkeep files");
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
    `  ${pc.cyan("4.")} Run ${pc.yellow(`${cmd} nextly migrate:create`)} to generate migrations`
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
// Command Registration
// ============================================================================

/**
 * Register the init command with the program
 *
 * @param program - Commander program instance
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a new Nextly project")
    .option("-y, --yes", "Skip prompts and use defaults", false)
    .option("-f, --force", "Overwrite existing files", false)
    .action(async (cmdOptions: InitCommandOptions, cmd: Command) => {
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
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
