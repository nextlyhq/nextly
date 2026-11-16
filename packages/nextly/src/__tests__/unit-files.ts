/**
 * The file names this package's unit suite runs, shared so another reader of
 * "is this file a test" asks the same question the suite does.
 *
 * Kept apart from `vitest.config.ts` so a test can import it without loading
 * Vite and the config's plugins.
 */
export const UNIT_FILE = /\.(?:test|spec)\.ts$/;
