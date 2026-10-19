/**
 * Stands in for `nextly`, `nextly/config`, `nextly/runtime` and
 * `nextly/database/seeders` when a test runs template code that imports them
 * (vitest.config.ts aliases all four here). create-nextly-app never installs Nextly: it only writes imports
 * of it into the projects it scaffolds, so the templates' imports have nothing
 * to resolve to beside this suite.
 *
 * It records what the template asked for, in order, so a test can assert what
 * a start-up hook did rather than what its source says.
 */

/** Each call the template made, in order: `boot`, then any `seed`. */
export const recorded: string[] = [];

/** The config each createRegister call received, in order. */
export const bootConfigs: unknown[] = [];

/** The options each seedSuperAdmin call received. */
export const seedOptions: Array<{ email: string; password: string }> = [];

/** The services getService handed out, by name. */
export const services = { adapter: { stub: "adapter" } };

/** Clears the record between cases. */
export function resetRecord(): void {
  recorded.length = 0;
  seedOptions.length = 0;
  bootConfigs.length = 0;
}

export function defineConfig<T>(config: T): T {
  return config;
}

export function createRegister(config: unknown): () => Promise<void> {
  return async () => {
    bootConfigs.push(config);
    recorded.push("boot");
  };
}

export function registerNextCacheRevalidator(): void {
  recorded.push("revalidator");
}

export function getService(name: string): unknown {
  return name === "adapter" ? services.adapter : undefined;
}

export async function seedSuperAdmin(
  adapter: unknown,
  options: { email: string; password: string }
): Promise<{ success: boolean }> {
  recorded.push(adapter === services.adapter ? "seed" : "seed:wrong-adapter");
  seedOptions.push({ email: options.email, password: options.password });
  return { success: true };
}

/**
 * `NextlyError.validation` in the shape the real one carries (`code` and
 * `publicData.errors`), which is what the admin reads to show a writer the
 * field to fix, so a test can assert the refusal a template hook raises.
 */
export class NextlyError extends Error {
  constructor(
    readonly code: string,
    readonly publicData: {
      errors: Array<{ path: string; code: string; message: string }>;
    }
  ) {
    super("Validation failed.");
  }

  static validation(opts: {
    errors: Array<{ path: string; code: string; message: string }>;
  }): NextlyError {
    return new NextlyError("VALIDATION_ERROR", { errors: opts.errors });
  }
}

/**
 * Collection and field builders, passed through unchanged, so a test can load
 * a template's collection and read the config it declares, access rules
 * included, rather than its source text.
 */
export function defineCollection<T>(config: T): T {
  return config;
}

function field(type: string) {
  return <T extends object>(options: T) => ({ type, ...options });
}

export const text = field("text");
export const textarea = field("textarea");
export const richText = field("richText");
export const date = field("date");
export const checkbox = field("checkbox");
export const number = field("number");
export const upload = field("upload");
export const relationship = field("relationship");
export const group = field("group");
