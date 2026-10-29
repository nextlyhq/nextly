/**
 * The app's generated component map, kept up to date while the app runs in
 * development, where the admin's server layout renders.
 *
 * The app commits two generated files: the map, which the admin page imports
 * to register each plugin component, and its strings-only path list, which
 * the layout hands to this check. In development the check compares that list
 * with what the boot's resolved plugins declare:
 *
 * - A map that names a site component relative to a config that has moved is
 *   out of date too, though its paths agree: the same spelling now resolves
 *   from another folder.
 * - A map that is out of date is written again, and the render goes on: Next
 *   sees the files change and reloads the admin with the new map, so a plugin
 *   added during `next dev` needs no command.
 * - **`NEXTLY_GENERATED_FILES_WRITE=0`** turns that rewrite off: the running
 *   app never rewrites generated files (a read-only checkout, a container, a
 *   test run). The check then warns, naming each component and the switch.
 * - A map that cannot be written is warned about the same way.
 *
 * Nothing refuses the admin. A widget whose component the map lacks draws its
 * own card's error state, and every other card and page draws as usual; that
 * the committed map agrees with the declarations is checked in CI, by
 * `nextly generate:types --check`, never at boot.
 *
 * **In production** the check does nothing at all: it reads, boots and writes
 * nothing, so a request to the admin costs no file read and no comparison.
 *
 * Server code only: it writes files and boots Nextly. Not marked with the
 * `server-only` package, which throws in plain Node and so would break every
 * test and tool that loads `nextly/runtime`: the boot it imports carries the
 * browser guard (`services/lib/permissions.ts`), and the client-bundle
 * boundary keeps it out of every client-safe entry.
 *
 * @module domains/widgets/declaration/component-map-check
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { getNextly } from "../../../init";
import { getNextlyLogger } from "../../../observability/logger";
import {
  type ComponentMapAgreement,
  checkComponentMapFiles,
} from "../../../plugins/codegen/check-component-map";
import {
  COMPONENT_IMPORT_MAP_FILENAME,
  componentUses,
  type ComponentMapEntry,
  configImportOf,
  configImportSpecifier,
  describeComponentUse,
} from "../../../plugins/codegen/component-import-map";
import { writeComponentMapFiles } from "../../../plugins/codegen/write-component-map";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { findConfigFile } from "../../../shared/lib/config-file";
import { generatedTypesFile } from "../../../shared/lib/generated-output-paths";
import { DEFAULT_TYPESCRIPT_CONFIG } from "../../../shared/types/config";

import {
  adminComponentPlugins,
  adminSiteDashboard,
} from "./component-map-store";

/** What the admin's server layout hands the check. */
export interface AdminComponentCheckInput {
  /** The app's config, as `nextly.config.ts` exports it. */
  readonly config: Parameters<typeof getNextly>[0]["config"];
  /** `registeredComponentPaths` from `plugin-admin-components.generated.ts`. */
  readonly registeredComponentPaths: readonly string[];
}

/**
 * Keeps the app's component map up to date in development, as the module
 * comment describes, and returns at once anywhere else. Never throws over the
 * map: a missing component is its card's error, not the admin's.
 */
export async function checkAdminComponents(
  input: AdminComponentCheckInput
): Promise<void> {
  // First, before any boot or read: production serves the map it was built
  // with, and only development can do anything about one that is out of date.
  if (process.env.NODE_ENV !== "development") return;
  const plugins = await bootPlugins(input);
  if (plugins === undefined) return;

  const registered = new Set(input.registeredComponentPaths);
  // The site's own widgets draw through the map as the plugins' do, as the
  // boot registered them: after every plugin's setup(), which may add one the
  // config as written does not hold.
  const siteDashboard = adminSiteDashboard();
  // Every use, not one per path: two widgets drawn with one missing component
  // are both named.
  const uses = componentUses(plugins, siteDashboard);
  const missing = uses.filter(each => !registered.has(each.path));
  /*
   * 🔴 Compared in both directions. A plugin removed from the config leaves
   * its paths in the map with nothing missing, and the map still imports
   * them: once its package is uninstalled too, the admin fails to resolve
   * that import before this check can run again to repair it.
   */
  const declared = new Set(uses.map(each => each.path));
  const obsolete = [...registered].filter(path => !declared.has(path));
  const place = mapFolder(input.config);
  const otherConfig =
    missing.length === 0 && obsolete.length === 0
      ? await configDisagreement(plugins, siteDashboard, uses, place)
      : undefined;
  if (missing.length === 0 && obsolete.length === 0 && !otherConfig) return;

  const stale = { missing, obsolete, otherConfig };
  if (generatedFilesWriteOff()) {
    warnStale(stale, place, "write-off");
    return;
  }
  await rewriteInDevelopment(plugins, siteDashboard, place, stale);
}

/**
 * Where a map that lists the right paths still imports a config-relative component from the
 * wrong folder: the config it is held to has moved, so the same spelling now resolves from
 * another place. Asked of `generate:types --check`'s own comparison, never a second one.
 *
 * Only a site component written relative to the config moves with it, so only then are the
 * map's files read; any other map is judged by its paths alone, at no cost per request. A map
 * that cannot be read is answered as out of date, and the rewrite then names the failure.
 */
async function configDisagreement(
  plugins: readonly PluginDefinition[],
  siteDashboard: unknown,
  uses: readonly ComponentMapEntry[],
  place: MapFolder
): Promise<ComponentMapAgreement["otherConfig"]> {
  if (!uses.some(each => each.fromConfig)) return undefined;
  const config = await heldConfig(place);
  try {
    const found = await checkComponentMapFiles(
      plugins,
      place.typesOutputPath,
      process.cwd(),
      config,
      siteDashboard
    );
    return found.otherConfig;
  } catch {
    return { written: undefined, expected: undefined };
  }
}

/**
 * The config file the map is held to in development, absolute, or none: the one the existing
 * map imports, while that file is still there, since `generate:types` may have been given a
 * `--config` path this process cannot know; otherwise the one found as the loader finds it.
 * The rewrite and the check above both read it, so a rewritten map agrees with the check.
 */
async function heldConfig(place: MapFolder): Promise<string | undefined> {
  const mapDir = dirname(place.typesOutputPath);
  const kept = configImportOf(
    await readFile(join(mapDir, COMPONENT_IMPORT_MAP_FILENAME), "utf-8").catch(
      () => ""
    )
  );
  return (
    (kept === undefined ? undefined : configFileOf(kept, mapDir)) ??
    findConfigFile(process.cwd())
  );
}

/**
 * The file a map's config import names, as `configImportSpecifier` wrote it from that file, or
 * none when no such file is there. The extension the specifier dropped, or wrote as its output's,
 * is tried back, and the file is taken only where it gives the same specifier again.
 */
function configFileOf(specifier: string, mapDir: string): string | undefined {
  const named = resolve(mapDir, specifier);
  const candidates = named.endsWith(".mjs")
    ? [named.replace(/\.mjs$/, ".mts"), named]
    : [`${named}.ts`, `${named}.js`];
  return candidates.find(
    file =>
      existsSync(file) && configImportSpecifier(mapDir, file) === specifier
  );
}

/**
 * Whether the running app may rewrite generated files: not when
 * `NEXTLY_GENERATED_FILES_WRITE` is `0` or `false`.
 */
function generatedFilesWriteOff(): boolean {
  const value = process.env.NEXTLY_GENERATED_FILES_WRITE?.trim().toLowerCase();
  return value === "0" || value === "false";
}

/**
 * The plugins the boot resolved, or `undefined` when the check cannot run.
 *
 * A boot that fails (a database that does not answer, a config that does not
 * load) is not a component problem: it is reported by everything that needs
 * the boot, and the admin shows it as it always has. So the check steps aside,
 * and logs why, rather than reading as a stale map.
 */
async function bootPlugins(
  input: AdminComponentCheckInput
): Promise<readonly PluginDefinition[] | undefined> {
  try {
    await getNextly({ config: input.config });
  } catch (error) {
    getNextlyLogger().warn({
      kind: "admin-component-check-skipped",
      reason: "boot-failed",
      message:
        "The admin's component map was not checked, because Nextly did not " +
        "start. It is checked again on the next admin request.",
      err: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  return adminComponentPlugins();
}

/** Where the generated files live, as the config places the types file. */
interface MapFolder {
  /** The types file's absolute path, which the map is written beside. */
  readonly typesOutputPath: string;
  /** The folder, as a developer reads it: `src/types/generated`. */
  readonly folder: string;
}

/**
 * 🔴 Resolved through `generatedTypesFile`, as `generate:types` resolves it. A
 * types file left at its built-in default follows the app's layout, losing
 * its `src/` in an app with a root `app/` folder; read raw, the default would
 * put this check's map in a folder the generator and the admin page do not
 * use, and every admin request would rewrite it there again.
 */
function mapFolder(config: AdminComponentCheckInput["config"]): MapFolder {
  const cwd = process.cwd();
  const typesOutputPath = generatedTypesFile(
    cwd,
    (config as { typescript?: { outputFile?: string } }).typescript
      ?.outputFile ?? DEFAULT_TYPESCRIPT_CONFIG.outputFile
  );
  return {
    typesOutputPath,
    folder: relative(cwd, dirname(typesOutputPath)).split(sep).join("/"),
  };
}

/** How a map is out of date: what it lacks, what it still imports, and the config it is held to. */
interface Stale {
  readonly missing: readonly ComponentMapEntry[];
  readonly obsolete: readonly string[];
  readonly otherConfig: ComponentMapAgreement["otherConfig"];
}

/** Write the map again from the config, and warn instead where it cannot be written. */
async function rewriteInDevelopment(
  plugins: readonly PluginDefinition[],
  siteDashboard: unknown,
  place: MapFolder,
  stale: Stale
): Promise<void> {
  const { missing, obsolete } = stale;
  try {
    await writeComponentMapFiles(
      [...plugins],
      place.typesOutputPath,
      process.cwd(),
      await heldConfig(place),
      siteDashboard
    );
    getNextlyLogger().info({
      kind: "admin-component-map-regenerated",
      message: `The admin's component map was out of date and has been written again in ${place.folder}/. Commit both generated files.`,
      added: [...new Set(missing.map(each => each.path))],
      removed: obsolete,
    });
  } catch (error) {
    // Only a refused write is the folder's: any other failure (a full disk, a generator that
    // threw) is named by its own message, or the warning would prescribe the wrong fix.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const refused = code === "EACCES" || code === "EPERM" || code === "EROFS";
    warnStale(
      stale,
      place,
      refused ? "unwritable" : "failed",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/** Why a map that is out of date was left as it is, which picks the warning's cause. */
type LeftStale = "write-off" | "unwritable" | "failed";

const CAUSES: Record<LeftStale, (place: MapFolder, detail: string) => string> =
  {
    "write-off": () =>
      "automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0). Run `npx nextly generate:types`, or unset NEXTLY_GENERATED_FILES_WRITE to let `next dev` update the map.",
    unwritable: place =>
      `\`${place.folder}/\` is not writable. Make the folder writable, or run \`npx nextly generate:types\`.`,
    failed: (_place, detail) =>
      `writing it failed: ${detail}. Run \`npx nextly generate:types\` to see the failure in full.`,
  };

const WARNED = new Set<string>();

/**
 * Forgets which out-of-date maps have been warned about, so the next check
 * warns again. For tests, which run many checks in one process.
 */
export function resetComponentMapWarnings(): void {
  WARNED.clear();
}

/**
 * Logs, once per process for each set, a map left out of date: what each
 * missing component means for what it draws, and the imports kept for
 * components nothing declares any more.
 */
function warnStale(
  stale: Stale,
  place: MapFolder,
  cause: LeftStale,
  /** The write's own error, for a write that failed. */
  detail = ""
): void {
  const lines = [
    ...stale.missing.map(each => `- missing: ${describeComponentUse(each)}`),
    ...stale.obsolete.map(path => `- no longer declared: ${path}`),
    ...(stale.otherConfig === undefined
      ? []
      : [
          `- held to another config: imports ${stale.otherConfig.written ?? "none"}, where the config is ${stale.otherConfig.expected ?? "not found"}`,
        ]),
  ];
  const key = `${cause}\n${lines.join("\n")}`;
  if (WARNED.has(key)) return;
  WARNED.add(key);
  getNextlyLogger().warn({
    kind: "admin-component-map-stale",
    message:
      `The admin's component map in ${place.folder}/ is out of date and was not written again: ${CAUSES[cause](place, detail)}\n` +
      lines.join("\n") +
      "\nA widget whose component is missing draws its card's error state; any other missing component draws empty. Uninstalling a package the map still imports breaks the admin's build.",
  });
}
