/**
 * Node ESM resolve hook for running theme-lab's own TypeScript sources
 * directly with `node --experimental-strip-types`, without a bundler.
 *
 * The theme-lab modules import each other the way every bundler (Next.js,
 * Vite/vitest, tsc with "moduleResolution": "bundler") already resolves --
 * extensionless, e.g. `import { MONO } from "./mono"`. Plain Node ESM
 * requires an explicit extension on relative specifiers and throws
 * ERR_MODULE_NOT_FOUND otherwise. Rather than rewrite every import in the
 * theme-lab source tree to satisfy a script that runs once in CI/local dev,
 * this hook retries a failed resolution with `.ts`, `.tsx`, and `/index.ts`
 * appended, mirroring what the bundlers already do.
 */
const RETRY_SUFFIXES = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;

    for (const suffix of RETRY_SUFFIXES) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        // Try the next suffix; the original error is rethrown below if none work.
      }
    }

    throw error;
  }
}
