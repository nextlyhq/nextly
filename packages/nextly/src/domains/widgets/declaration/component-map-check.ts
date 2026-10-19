/**
 * Whether the app's generated component map holds every component the admin
 * needs, checked where the admin's server layout renders, before any admin
 * page is served.
 *
 * The app commits two generated files: the map, which the admin page imports
 * to register each plugin component, and its strings-only path list, which
 * the layout hands to this check. The check compares that list with what the
 * boot's resolved plugins declare.
 *
 * - **In development** a map that is out of date is written again, and the
 *   render goes on: Next sees the files change and reloads the admin with the
 *   new map, so a plugin added during `next dev` needs no command. Only a map
 *   that cannot be written stops the admin.
 * - **`NEXTLY_GENERATED_FILES_WRITE=0`** turns that rewrite off: the running
 *   app never rewrites generated files (a read-only checkout, a container, CI,
 *   a test run). Development then refuses as production does, naming the
 *   switch.
 * - **In production** the admin is refused while a dashboard widget's
 *   component is missing, naming each one and the fix. Only the admin: the
 *   check runs in its layout, so the public site keeps serving. Any other
 *   missing component (a page, a view, a field-type editor) is logged, since
 *   those draw empty today and refusing them is the plugin platform's call.
 *
 * Server code only: it writes files and boots Nextly. Not marked with the
 * `server-only` package, which throws in plain Node and so would break every
 * test and tool that loads `nextly/runtime`: the boot it imports carries the
 * browser guard (`services/lib/permissions.ts`), and the client-bundle
 * boundary keeps it out of every client-safe entry.
 *
 * @module domains/widgets/declaration/component-map-check
 */

import { dirname, relative, sep } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import { getNextly } from "../../../init";
import { getNextlyLogger } from "../../../observability/logger";
import {
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
  componentUses,
  type ComponentMapEntry,
} from "../../../plugins/codegen/component-import-map";
import { writeComponentMapFiles } from "../../../plugins/codegen/write-component-map";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { generatedTypesFile } from "../../../shared/lib/generated-output-paths";
import { DEFAULT_TYPESCRIPT_CONFIG } from "../../../shared/types/config";

import { adminComponentPlugins } from "./component-map-store";

/** What the admin's server layout hands the check. */
export interface AdminComponentCheckInput {
  /** The app's config, as `nextly.config.ts` exports it. */
  readonly config: Parameters<typeof getNextly>[0]["config"];
  /** `registeredComponentPaths` from `plugin-admin-components.generated.ts`. */
  readonly registeredComponentPaths: readonly string[];
}

/**
 * Checks the app's component map, as the module comment describes: rewrites
 * it in development, refuses the admin in production over a missing widget
 * component, and steps aside, saying so, when there is nothing to check
 * against yet.
 */
export async function checkAdminComponents(
  input: AdminComponentCheckInput
): Promise<void> {
  // `next build` evaluates server components without serving anyone; the
  // check is about what a request would get, so it waits for one.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const plugins = await bootPlugins(input);
  if (plugins === undefined) return;

  const registered = new Set(input.registeredComponentPaths);
  // Every use, not one per path: two widgets drawn with one missing component
  // are both named and counted.
  const uses = componentUses(plugins);
  const missing = uses.filter(each => !registered.has(each.path));
  /*
   * 🔴 Compared in both directions. A plugin removed from the config leaves
   * its paths in the map with nothing missing, and the map still imports
   * them: once its package is uninstalled too, the admin fails to resolve
   * that import before this check can run again to repair it. Only
   * development rewrites, so only development acts on these; elsewhere an
   * import of an installed package nothing draws is harmless.
   */
  const declared = new Set(uses.map(each => each.path));
  const obsolete = [...registered].filter(path => !declared.has(path));

  const development = process.env.NODE_ENV === "development";
  if (development && !generatedFilesWriteOff()) {
    if (missing.length === 0 && obsolete.length === 0) return;
    await rewriteInDevelopment(
      plugins,
      mapFolder(input.config),
      missing,
      obsolete
    );
    return;
  }
  if (missing.length === 0) return;
  refuseOverWidgets(
    missing,
    mapFolder(input.config),
    development ? "write-off" : registered.size === 0 ? "no-map" : "stale"
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

/**
 * In development, write the map again from the config. A write that fails
 * stops the admin only when a widget is affected, as in production; a map
 * that only kept a removed plugin's imports is warned about.
 */
async function rewriteInDevelopment(
  plugins: readonly PluginDefinition[],
  place: MapFolder,
  missing: readonly ComponentMapEntry[],
  obsolete: readonly string[]
): Promise<void> {
  try {
    await writeComponentMapFiles(
      [...plugins],
      place.typesOutputPath,
      process.cwd()
    );
    getNextlyLogger().info({
      kind: "admin-component-map-regenerated",
      message: `The admin's component map was out of date and has been written again in ${place.folder}/. Commit both generated files.`,
      added: [...new Set(missing.map(each => each.path))],
      removed: obsolete,
    });
  } catch (error) {
    const widgets = missing.filter(each => each.use === "widget");
    if (widgets.length > 0) {
      throw refusal(unwritableMessage(widgets, place), error);
    }
    if (missing.length > 0) warnMissing(missing, place);
    if (obsolete.length > 0) warnObsolete(obsolete, place);
  }
}

/**
 * Logs, once per process for each set, imports the map keeps for components
 * nothing declares any more, when they could not be removed.
 */
function warnObsolete(obsolete: readonly string[], place: MapFolder): void {
  const key = `obsolete\n${obsolete.join("\n")}`;
  if (WARNED.has(key)) return;
  WARNED.add(key);
  getNextlyLogger().warn({
    kind: "admin-component-map-obsolete",
    message:
      `The component map in ${place.folder}/ still imports ${obsolete.length} component(s) no plugin declares, and could not be written again:\n` +
      obsolete.map(path => `- ${path}`).join("\n") +
      "\nUninstalling their package breaks the admin's build until `npx nextly generate:types` runs.",
  });
}

/** Why a map that is not rewritten is refused, which picks its wording. */
type RefusalKind = "no-map" | "stale" | "write-off";

/**
 * Refuse over a missing widget, and log every other gap: production, and
 * development with automatic regeneration turned off.
 */
function refuseOverWidgets(
  missing: readonly ComponentMapEntry[],
  place: MapFolder,
  kind: RefusalKind
): void {
  const widgets = missing.filter(each => each.use === "widget");
  const others = missing.filter(each => each.use !== "widget");
  if (others.length > 0) warnMissing(others, place);
  if (widgets.length === 0) return;
  throw refusal(REFUSAL_MESSAGES[kind](widgets, place));
}

const WARNED = new Set<string>();

/**
 * Forgets which incomplete maps have been warned about, so the next check
 * warns again. For tests, which run many checks in one process.
 */
export function resetComponentMapWarnings(): void {
  WARNED.clear();
}

/** Logs, once per process for each set, components that will draw empty. */
function warnMissing(
  missing: readonly ComponentMapEntry[],
  place: MapFolder
): void {
  const key = missing.map(each => each.path).join("\n");
  if (WARNED.has(key)) return;
  WARNED.add(key);
  getNextlyLogger().warn({
    kind: "admin-component-map-incomplete",
    message:
      `${missing.length} admin component(s) are missing from the component map in ${place.folder}/ and will draw empty:\n` +
      missing
        .map(each => `- ${each.owner}, ${each.use}: ${each.path}`)
        .join("\n") +
      "\nRun `npx nextly generate:types`, or start `next dev` once, then commit both generated files.",
  });
}

const fileNames = (place: MapFolder) =>
  `\`${place.folder}/${COMPONENT_IMPORT_MAP_FILENAME}\` and \`${place.folder}/${COMPONENT_PATHS_FILENAME}\``;

const listed = (widgets: readonly ComponentMapEntry[]) =>
  widgets
    .map(
      each =>
        `- ${each.owner}, widget "${each.widget ?? "?"}": \`${each.path}\``
    )
    .join("\n");

const counted = (widgets: readonly ComponentMapEntry[]) =>
  widgets.length === 1
    ? "1 dashboard widget draws with a component"
    : `${widgets.length} dashboard widgets draw with components`;

const PRODUCTION_FIX =
  "Run `npx nextly generate:types`, or start `next dev` once. Then commit both files and redeploy.";

function noMapMessage(
  widgets: readonly ComponentMapEntry[],
  place: MapFolder
): string {
  return (
    `The admin cannot be served: ${counted(widgets)} that this build does not include, because the app has no component map.\n\n` +
    `${listed(widgets)}\n\n` +
    `Nextly includes widget components through two generated files: ${fileNames(place)}. ${PRODUCTION_FIX}`
  );
}

function staleMessage(
  widgets: readonly ComponentMapEntry[],
  place: MapFolder
): string {
  return (
    `The admin cannot be served: ${counted(widgets)} that this build's component map does not include.\n\n` +
    `${listed(widgets)}\n\n` +
    `The map (${fileNames(place)}) was generated before ${widgets.length === 1 ? "this widget was" : "these widgets were"} added or changed. ${PRODUCTION_FIX}`
  );
}

function writeOffMessage(
  widgets: readonly ComponentMapEntry[],
  place: MapFolder
): string {
  return (
    `The admin cannot be served: ${counted(widgets)} that the component map (${fileNames(place)}) does not include, and automatic regeneration is off (NEXTLY_GENERATED_FILES_WRITE=0).\n\n` +
    `${listed(widgets)}\n\n` +
    "Run `npx nextly generate:types`, or unset NEXTLY_GENERATED_FILES_WRITE to let `next dev` update the map."
  );
}

const REFUSAL_MESSAGES: Record<
  RefusalKind,
  (widgets: readonly ComponentMapEntry[], place: MapFolder) => string
> = {
  "no-map": noMapMessage,
  stale: staleMessage,
  "write-off": writeOffMessage,
};

function unwritableMessage(
  widgets: readonly ComponentMapEntry[],
  place: MapFolder
): string {
  return (
    `The admin cannot be served: Nextly could not update the component map, because \`${place.folder}/\` is not writable. ${counted(widgets)} the map does not include:\n\n` +
    `${listed(widgets)}\n\n` +
    "Make the folder writable, or run `npx nextly generate:types`."
  );
}

/** What the browser is told: what happened, and where the detail is. */
export const ADMIN_COMPONENT_MAP_PUBLIC_MESSAGE =
  "The admin is not available: a dashboard widget's component is missing from the app's component map. The server log names the widget and the fix.";

/**
 * The refusal: a stable code, a public message that points to the log, and
 * the detail logged as the error is raised.
 *
 * Logged here, not left to whoever catches it: the error surfaces as a server
 * component's error, which Next prints by its message (the public one) and
 * hides from the browser in production, so the detail would otherwise reach
 * no one.
 */
function refusal(logMessage: string, cause?: unknown): NextlyError {
  const code = "NEXTLY_ADMIN_COMPONENT_MAP_STALE";
  getNextlyLogger().error({
    kind: "admin-component-map-stale",
    code,
    message: logMessage,
  });
  return new NextlyError({
    code,
    publicMessage: ADMIN_COMPONENT_MAP_PUBLIC_MESSAGE,
    logMessage,
    ...(cause instanceof Error ? { cause } : {}),
  });
}
