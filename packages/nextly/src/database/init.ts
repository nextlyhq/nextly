// Database initialization for external Next.js apps consuming the nextly package.
// Uses the new adapter system (@revnixhq/adapter-drizzle).

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { createAdapterFromEnv } from "./factory";
import { seedAll, type SeederResult } from "./seeders/index";

export interface InitDatabaseOptions {
  /**
   * Custom database adapter. If not provided, creates one from env variables.
   */
  adapter?: DrizzleAdapter;

  /**
   * Whether to run seeders after connecting. Default: false
   */
  runSeeders?: boolean;

  /**
   * Silent mode for seeders (no console output). Default: false
   */
  silentSeeders?: boolean;

  /**
   * Callback function called after successful initialization
   */
  onSuccess?: (result: { seeder?: SeederResult }) => void | Promise<void>;

  /**
   * Callback function called if initialization fails
   */
  onError?: (error: Error) => void | Promise<void>;
}

export interface InitDatabaseResult {
  success: boolean;
  adapter: DrizzleAdapter;
  seederResult?: SeederResult;
  error?: string;
}

/**
 * Initialize the database by connecting and optionally running seeders.
 * This is the main entry point for external Next.js apps consuming this package.
 *
 * Migrations are now handled by drizzle-kit (via pushSchema during dev boot
 * or drizzle-kit generate/migrate for production). This function focuses on
 * connecting and seeding.
 *
 * @example
 * ```typescript
 * import { initDatabase } from '@revnixhq/nextly';
 *
 * const { adapter, success, error } = await initDatabase({
 *   runSeeders: true,
 *   onSuccess: () => console.log('Database initialized!'),
 *   onError: (error) => console.error('Failed:', error)
 * });
 * ```
 */
export async function initDatabase(
  options: InitDatabaseOptions = {}
): Promise<InitDatabaseResult> {
  const {
    adapter: providedAdapter,
    runSeeders: shouldRunSeeders = false,
    silentSeeders = false,
    onSuccess,
    onError,
  } = options;

  try {
    // Create or use provided adapter
    const adapter = providedAdapter || (await createAdapterFromEnv());

    // Connect to database
    if (!adapter.isConnected()) {
      await adapter.connect();
    }

    let seederResult: SeederResult | undefined;

    // Run seeders if enabled
    if (shouldRunSeeders) {
      seederResult = await seedAll(adapter, {
        silent: silentSeeders,
        skipSuperAdmin: true,
      });

      if (!seederResult.success) {
        const error = new Error(
          `Seeding failed: ${seederResult.errors} error(s). ${seederResult.errorMessages?.join("; ") || ""}`
        );
        await onError?.(error);
        return {
          success: false,
          adapter,
          seederResult,
          error: error.message,
        };
      }
    }

    await onSuccess?.({ seeder: seederResult });

    return {
      success: true,
      adapter,
      seederResult,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const err = error instanceof Error ? error : new Error(errorMessage);
    await onError?.(err);

    // Try to return an adapter for debugging, fall back gracefully
    let adapter: DrizzleAdapter | undefined;
    try {
      adapter = providedAdapter || (await createAdapterFromEnv());
    } catch {
      // Can't create adapter - return without it
    }

    return {
      success: false,
      adapter: adapter!,
      error: errorMessage,
    };
  }
}

/**
 * Quick initialization for simple use cases.
 * Throws an error if initialization fails.
 */
export async function quickInitDatabase(
  options: Omit<InitDatabaseOptions, "onError"> = {}
): Promise<DrizzleAdapter> {
  const result = await initDatabase(options);

  if (!result.success) {
    throw new Error(
      `Database initialization failed: ${result.error || "Unknown error"}`
    );
  }

  return result.adapter;
}
