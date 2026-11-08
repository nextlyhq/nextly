/**
 * Which contributed admin components name a module with no file behind it.
 *
 * The generated map imports every component a plugin's
 * `contributes.admin.contributions` names, statically. A contribution naming a
 * module that is not there (a fixture that relies on its place's fallback, a
 * component not written yet, a package not installed) would make that import
 * fail and stop the app compiling, where the contribution left out of the map
 * only draws its place's fallback. So the generator, the CI check and the
 * development check all leave such a contribution out, from the one answer
 * here, and `generate:types` warns about each one by name.
 *
 * Judged as the app's TypeScript build would find the module: a relative path
 * from the map's own folder, where the map imports it as written; a
 * `compilerOptions.paths` alias of the app's `tsconfig.json`; and otherwise a
 * package in `node_modules`, held to its `exports`. Only a module proven
 * absent is left out. One this cannot judge, such as an alias a bundler alone
 * declares, stays in the map as before.
 *
 * @module plugins/codegen/unbacked-contributions
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { PluginDefinition } from "../plugin-context";

import { componentUses, type ComponentMapEntry } from "./component-import-map";

/** Whether a module specifier reaches a file, as far as this can tell. */
export type ModulePresence = "present" | "absent" | "unknown";

/** Where a specifier is resolved from. */
export interface ModuleResolutionPlace {
  /** The app's root: its `tsconfig.json` and its `node_modules` are read from here. */
  readonly cwd: string;
  /** The folder the generated map is written in, which a relative specifier is read from. */
  readonly mapDir: string;
}

/**
 * The contributed components whose module has no file behind it, in declared
 * order and once per path. Read from {@link componentUses}, so they are
 * exactly the contributions the map would otherwise import.
 */
export function unbackedContributions(
  plugins: readonly PluginDefinition[],
  typesOutputPath: string,
  cwd: string,
  siteDashboard?: unknown
): ComponentMapEntry[] {
  const place: ModuleResolutionPlace = {
    cwd,
    mapDir: dirname(resolve(cwd, typesOutputPath)),
  };
  const seen = new Set<string>();
  const unbacked: ComponentMapEntry[] = [];
  for (const each of componentUses(plugins, siteDashboard)) {
    if (each.use !== "contribution" || seen.has(each.path)) continue;
    seen.add(each.path);
    if (modulePresence(moduleOf(each.path), place) === "absent") {
      unbacked.push(each);
    }
  }
  return unbacked;
}

/** The paths of {@link unbackedContributions}, as the map's builders take them. */
export function unbackedPaths(
  entries: readonly ComponentMapEntry[]
): ReadonlySet<string> {
  return new Set(entries.map(each => each.path));
}

/** The warning `generate:types` prints for one contribution left out of the map. */
export function describeUnbackedContribution(each: ComponentMapEntry): string {
  return (
    `${each.owner} contributes the component ${each.path}, but no file is ` +
    `behind ${moduleOf(each.path)}: it is left out of the component map, and ` +
    "its place draws its fallback."
  );
}

/** The module part of a component path: everything before `#`. */
function moduleOf(path: string): string {
  const hash = path.indexOf("#");
  return hash === -1 ? path : path.slice(0, hash);
}

/**
 * Whether `specifier` reaches a file from `place`. A relative or absolute
 * path is read from the map's folder; anything else through the app's
 * `paths`, then `node_modules`.
 */
export function modulePresence(
  specifier: string,
  place: ModuleResolutionPlace
): ModulePresence {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return fileFor(resolve(place.mapDir, specifier)) ? "present" : "absent";
  }
  // A `paths` alias that reaches a file settles it. One that matches and
  // reaches none falls through to `node_modules`, as TypeScript's own
  // resolution does.
  for (const target of aliasTargets(specifier, place.cwd)) {
    if (fileFor(target)) return "present";
  }
  return packagePresence(specifier, place.cwd);
}

/** The extensions a module file may have, in the order a bundler tries them. */
const EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".d.ts",
];

/** Whether a file is there for a module path: as written, with an extension, or as a folder's index. */
function fileFor(base: string): boolean {
  if (isFile(base)) return true;
  return EXTENSIONS.some(
    ext => isFile(`${base}${ext}`) || isFile(join(base, `index${ext}`))
  );
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * What a `*` pattern (`@/*`, `./admin/*`) or an exact key captures of
 * `specifier`: the text the `*` stands for (empty for an exact key), with the
 * length of the pattern's prefix, by which the most specific match is picked.
 * `undefined` when it does not match. One reader for `paths` and `exports`.
 */
function capture(
  pattern: string,
  specifier: string
): { star: string; prefixLength: number } | undefined {
  const star = pattern.indexOf("*");
  if (star === -1) {
    return pattern === specifier
      ? { star: "", prefixLength: pattern.length }
      : undefined;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  const fits =
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix);
  return fits
    ? {
        star: specifier.slice(prefix.length, specifier.length - suffix.length),
        prefixLength: prefix.length,
      }
    : undefined;
}

/**
 * The files an alias in the app's `compilerOptions.paths` maps a specifier
 * to, from the most specific matching pattern, as TypeScript picks one. None
 * when no pattern matches or there is no readable `tsconfig.json`.
 */
function aliasTargets(specifier: string, cwd: string): string[] {
  const config = readPathsConfig(join(cwd, "tsconfig.json"), 0);
  if (config === undefined) return [];
  let best:
    | { star: string; prefixLength: number; targets: string[] }
    | undefined;
  for (const [pattern, targets] of Object.entries(config.paths)) {
    const found = capture(pattern, specifier);
    if (found === undefined) continue;
    if (best === undefined || found.prefixLength > best.prefixLength) {
      best = { ...found, targets };
    }
  }
  if (best === undefined) return [];
  const { star } = best;
  return best.targets.map(target =>
    resolve(config.base, target.replace("*", star))
  );
}

/** A tsconfig's `paths`, with the folder its targets are read from. */
interface PathsConfig {
  readonly paths: Record<string, string[]>;
  readonly base: string;
}

/**
 * The `paths` a tsconfig declares, or the ones it inherits through a relative
 * `extends`, with the folder they resolve against (`baseUrl`, else the file
 * declaring them). `undefined` when there are none or the file cannot be read.
 */
function readPathsConfig(file: string, depth: number): PathsConfig | undefined {
  // A cycle of `extends` stops here rather than recursing for ever.
  if (depth > 8) return undefined;
  const parsed = readJsonc(file);
  if (parsed === undefined) return undefined;
  const declared = declaredPaths(parsed, dirname(file));
  if (declared !== undefined) return declared;
  const parent = extendedConfig(parsed, dirname(file));
  return parent === undefined ? undefined : readPathsConfig(parent, depth + 1);
}

/** The `paths` one tsconfig declares itself, or `undefined` for none. */
function declaredPaths(
  parsed: Record<string, unknown>,
  dir: string
): PathsConfig | undefined {
  const options = isRecord(parsed.compilerOptions)
    ? parsed.compilerOptions
    : {};
  if (!isRecord(options.paths)) return undefined;
  const paths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(options.paths)) {
    if (!Array.isArray(targets)) continue;
    paths[pattern] = targets.filter(
      (target): target is string => typeof target === "string"
    );
  }
  const base =
    typeof options.baseUrl === "string" ? resolve(dir, options.baseUrl) : dir;
  return { paths, base };
}

/** The file a tsconfig's relative `extends` names, or `undefined` for none. */
function extendedConfig(
  parsed: Record<string, unknown>,
  dir: string
): string | undefined {
  const extended = parsed.extends;
  if (typeof extended !== "string" || !extended.startsWith(".")) {
    return undefined;
  }
  const target = resolve(dir, extended);
  return target.endsWith(".json") ? target : `${target}.json`;
}

/**
 * A JSON-with-comments file, as a tsconfig is written: line and block
 * comments and trailing commas are dropped before parsing, outside strings.
 * `undefined` for a missing file or one that still does not parse.
 */
function readJsonc(file: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(withoutTrailingCommas(text));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Where the string opening at `start` ends, past its closing quote; escapes are skipped. */
function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
  return i + 1;
}

/**
 * Where a comment opening at `start` ends, or `undefined` when none opens
 * there: a line comment at its line break, a block comment past its `*\/`.
 */
function endOfComment(text: string, start: number): number | undefined {
  if (text[start] !== "/") return undefined;
  if (text[start + 1] === "/") {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  if (text[start + 1] === "*") {
    const end = text.indexOf("*/", start + 2);
    return end === -1 ? text.length : end + 2;
  }
  return undefined;
}

/** The text with its comments removed, strings left as written. */
function withoutComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const end = endOfString(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    const end = endOfComment(text, i);
    if (end === undefined) {
      out += text[i];
      i += 1;
    } else {
      i = end;
    }
  }
  return out;
}

/** The text without comments, and without a comma left before a closing `}` or `]`. */
function withoutTrailingCommas(text: string): string {
  return withoutComments(text).replace(/,(\s*[}\]])/g, "$1");
}

/**
 * A bare specifier's package name and the subpath after it (`""` for the
 * package itself), or `undefined` for one that names no package.
 */
function packageParts(
  specifier: string
): { name: string; subpath: string } | undefined {
  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  if (parts.length < nameLength || parts.some(part => part === "")) {
    return undefined;
  }
  return {
    name: parts.slice(0, nameLength).join("/"),
    subpath: parts.slice(nameLength).join("/"),
  };
}

/**
 * Whether a bare specifier reaches a package file from `cwd`: the package
 * found in a `node_modules` on the way up, then its `exports` (or, without
 * them, a file at the subpath). A package found nowhere is absent.
 */
function packagePresence(specifier: string, cwd: string): ModulePresence {
  const parts = packageParts(specifier);
  if (parts === undefined) return "unknown";
  const packageDir = findPackageDir(parts.name, cwd);
  if (packageDir === undefined) return "absent";
  const manifest = readJsonc(join(packageDir, "package.json"));
  if (manifest === undefined) return "unknown";
  return presenceInPackage(packageDir, manifest, parts.subpath);
}

/** Whether one installed package reaches a file for `subpath`. */
function presenceInPackage(
  packageDir: string,
  manifest: Record<string, unknown>,
  subpath: string
): ModulePresence {
  const exported = manifest.exports;
  if (exported !== undefined && exported !== null) {
    const key = subpath === "" ? "." : `./${subpath}`;
    return exportsHold(exported, key) ? "present" : "absent";
  }
  const main = typeof manifest.main === "string" ? manifest.main : "index";
  const file = join(packageDir, subpath === "" ? main : subpath);
  return fileFor(file) ? "present" : "absent";
}

/** The folder of package `name` in the nearest `node_modules` from `cwd` up. */
function findPackageDir(name: string, cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (isFile(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Whether a package's `exports` names `key` (`.` or `./sub`), exactly or
 * through a `*` pattern, to something other than `null`. An `exports` that is
 * a string, an array or a conditions object names `.` alone.
 */
function exportsHold(exported: unknown, key: string): boolean {
  if (!isRecord(exported)) return key === ".";
  const subpaths = Object.keys(exported).filter(each => each.startsWith("."));
  // A conditions object (`{ import, types }`) rather than a subpath map.
  if (subpaths.length === 0) return key === ".";
  return subpaths.some(
    each => exported[each] !== null && capture(each, key) !== undefined
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
