/**
 * Whether the development server reports the changes not yet in a migration (`drift-block.ts`):
 * under `next dev` alone, never while `next build` runs, under test or in a production start.
 * Kept apart and light so a caller asks it before loading anything the report reads: a production
 * start loads none of it, and reads no migration file to work it out.
 *
 * @module init/drift-gate
 */
import { isNextBuildPhase } from "@nextlyhq/adapter-drizzle/build-phase";

/** Whether `env` is a development server's, outside `next build`. */
export function driftReportAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env.NODE_ENV === "development" && !isNextBuildPhase(env);
}
