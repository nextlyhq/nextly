/**
 * The one place this package reaches for esbuild.
 *
 * esbuild is around 9.6 MB and exists here for exactly one job: compiling the
 * user's `nextly.config.ts` so it can be imported. Three things need that, and
 * none of them is serving a request:
 *
 *   - DEVELOPMENT, where boot-apply and the HMR listener re-read the config;
 *   - the CLI, where `nextly migrate` and its siblings load it;
 *   - PRODUCTION only when `db.runMigrationsOnBoot` is switched on, which is
 *     opt-in and off by default.
 *
 * An ordinary production install therefore downloads it and never executes a
 * line, which is what makes it an optional peer rather than a dependency.
 *
 * This THROWS where the sharp loader returns null, and the difference is the
 * caller rather than a preference: an upload has a good degraded outcome, and
 * a configuration that cannot be compiled has none. There is nothing for a
 * call site to decide, so the decision is not handed to it.
 *
 * @module cli/utils/esbuild-loader
 */

import { createRequire } from "node:module";

import { NextlyError } from "../../errors";

/**
 * The command reported to an install that is missing it.
 *
 * `--save-dev`, because nothing that serves a request needs esbuild: it is
 * build and development tooling, and a production deployment installing with
 * `--omit=dev` is the case this whole change exists to make cheaper.
 */
export const ESBUILD_INSTALL_COMMAND = "npm install --save-dev esbuild";

/**
 * The subset of esbuild this package uses.
 *
 * Declared structurally and narrowed to what the one call site reads, rather
 * than imported wholesale: the type import is erased at compile time, so a
 * consuming install can type-check without the package present. `metafile` is
 * optional because esbuild only produces it when asked, and the caller already
 * treats its absence as "no dependencies to report".
 */
export interface EsbuildBuildResult {
  metafile?: { inputs: Record<string, unknown> };
}

export interface EsbuildModule {
  build: (options: unknown) => Promise<EsbuildBuildResult>;
}

const requireFrom = createRequire(import.meta.url);

/**
 * Whether the library can be found, without executing it.
 *
 * Resolution rather than import, so asking the question does not run a third
 * party's module initialisation. Used to warn BEFORE work begins rather than
 * to decide whether to attempt it.
 */
export function isEsbuildAvailable(): boolean {
  try {
    requireFrom.resolve("esbuild");
    return true;
  } catch {
    return false;
  }
}

/** The value, if it can actually build. */
function builderOf(value: unknown): EsbuildModule | undefined {
  const candidate = value as EsbuildModule | undefined;
  return typeof candidate?.build === "function" ? candidate : undefined;
}

/**
 * Load esbuild, or explain precisely what to install and why.
 *
 * `resolver` exists so a test can model an absent or hostile module without
 * touching the filesystem. Production callers pass nothing.
 */
export async function loadEsbuild(options?: {
  resolver?: () => unknown;
}): Promise<EsbuildModule> {
  let loaded: unknown;

  try {
    loaded = await (options?.resolver ? options.resolver() : import("esbuild"));
  } catch (cause) {
    throw esbuildUnavailable(cause);
  }

  // `default` is read first for the same reason as the other loaders here: a
  // module namespace is not always a plain object, and a proxy that throws on
  // an unknown name turns a good CommonJS default into "missing" when the top
  // level is probed first.
  const esbuild =
    builderOf((loaded as { default?: unknown })?.default) ?? builderOf(loaded);

  if (!esbuild) throw esbuildUnavailable("esbuild exposed no build function");

  return esbuild;
}

/**
 * The one refusal this module reports, however it got there.
 *
 * Says what needs it as well as what to run: a reader who never asked for a
 * TypeScript config would otherwise have no idea why a bundler is involved.
 */
function esbuildUnavailable(cause: unknown): NextlyError {
  return new NextlyError({
    code: "NEXTLY_CONFIG_TOOLING_UNAVAILABLE",
    publicMessage:
      `Reading "nextly.config.ts" needs the "esbuild" package, which is not installed. ` +
      `Run "${ESBUILD_INSTALL_COMMAND}" and try again. ` +
      `It is needed for development, for the nextly CLI, and in production only when "db.runMigrationsOnBoot" is enabled.`,
    logContext: {
      reason: "esbuild-unavailable",
      cause: cause instanceof Error ? cause.message : String(cause),
    },
  });
}
