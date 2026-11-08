/**
 * Which contributed admin components name a module with no file behind it.
 *
 * The generated map imports every component a plugin's
 * `contributes.admin.contributions` names, statically. A contribution naming a
 * module that is not there (a fixture that relies on its place's fallback, a
 * component not written yet, a workspace plugin not built yet) would make that
 * import fail and stop the app compiling, where the contribution left out of
 * the map only draws its place's fallback. So the generator, the CI check and
 * the development check all leave such a contribution out, from the one
 * answer here, and `generate:types` warns about each one by name.
 *
 * Only LOCAL modules are judged: a relative path from the map's own folder,
 * where the map imports it as written, and a `compilerOptions.paths` alias of
 * the app's `tsconfig.json`. One is left out only when no runtime file is
 * behind it (a declaration file alone does not count, since it loads
 * nothing). A package is never judged: telling whether its entry exists needs
 * the app bundler's own resolver, with its conditions, entry fields and
 * pattern rules, and a guess there either drops a valid component or keeps a
 * broken one, so a package is left to the build. Anything this cannot judge,
 * such as an alias only the bundler declares, stays in the map as before.
 *
 * @module plugins/codegen/unbacked-contributions
 */

import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
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
 * Whether `specifier` reaches a runtime file from `place`.
 *
 * `absent` only for a local module proven to have none: a relative or
 * absolute path, read from the map's folder, or a `paths` alias every target
 * of which has none. A bare specifier no alias matches is `unknown`, installed
 * or not, and so is an alias whose name is also an installed package, which
 * TypeScript would fall back to: packages are left to the build to judge.
 */
export function modulePresence(
  specifier: string,
  place: ModuleResolutionPlace
): ModulePresence {
  if (specifier.startsWith(".") || isAbsolute(specifier)) {
    return runtimeFileFor(resolve(place.mapDir, specifier))
      ? "present"
      : "absent";
  }
  const targets = aliasTargets(specifier, place.cwd);
  // No alias matches (a package, or a bundler-only alias), or the app's
  // aliases cannot be read: not this module's to judge.
  if (targets === undefined || targets.length === 0) return "unknown";
  if (targets.some(runtimeFileFor)) return "present";
  return isInstalledPackage(specifier, place.cwd) ? "unknown" : "absent";
}

/** The extensions of a file that loads at run time, as the map's import does. */
const RUNTIME_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs"];

/** A declaration file: types only, nothing that loads. */
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

/**
 * Whether a runtime file is there for a module path: as written, with a
 * runtime extension, or as a folder's index. A declaration file (`.d.ts`,
 * `.d.mts`, `.d.cts`) alone does not count, since the map's import of it
 * would load nothing.
 */
function runtimeFileFor(base: string): boolean {
  if (!DECLARATION_FILE.test(base) && isFile(base)) return true;
  return RUNTIME_EXTENSIONS.some(
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
 * `undefined` when it does not match.
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
 * to, from the most specific matching pattern, as TypeScript picks one. An
 * empty list when no pattern matches; `undefined` when what the app's
 * `paths` are cannot be read (no readable `tsconfig.json`, or an `extends`
 * this cannot resolve), so nothing about an alias is proven.
 */
function aliasTargets(specifier: string, cwd: string): string[] | undefined {
  const config = readPathsConfig(join(cwd, "tsconfig.json"));
  if (config === undefined) return undefined;
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

/** A tsconfig's effective `paths`, with the folder their targets resolve against. */
interface PathsConfig {
  readonly paths: Record<string, string[]>;
  readonly base: string;
}

/** The `paths` one tsconfig declares, with the folder of that file. */
interface DeclaredPaths {
  readonly paths: Record<string, string[]>;
  readonly dir: string;
}

/** One tsconfig file of an `extends` chain, as read. */
interface ConfigFile {
  readonly options: Record<string, unknown>;
  readonly dir: string;
}

/**
 * The `paths` the app's tsconfig resolves to through its `extends` chain, as
 * TypeScript reads them: the nearest file declaring `paths` gives them, and
 * the nearest declaring `baseUrl` gives the folder they resolve against,
 * else the folder of the file that declares the `paths`. No `paths` anywhere
 * is an empty map. `undefined` when a file of the chain cannot be read or an
 * `extends` cannot be resolved before both are settled.
 */
function readPathsConfig(file: string): PathsConfig | undefined {
  const settled = settledAcross(configChain(file));
  if (settled === undefined) return undefined;
  const { paths, base } = settled;
  if (paths === undefined) return { paths: {}, base: dirname(file) };
  return { paths: paths.paths, base: base ?? paths.dir };
}

/**
 * The nearest `paths` and `baseUrl` of a chain, read until both are found.
 * `undefined` when a file that cannot be read comes first, since it could
 * declare either.
 */
function settledAcross(
  chain: readonly (ConfigFile | undefined)[]
): { paths: DeclaredPaths | undefined; base: string | undefined } | undefined {
  let paths: DeclaredPaths | undefined;
  let base: string | undefined;
  for (const config of chain) {
    if (config === undefined) return undefined;
    paths ??= declaredPaths(config);
    base ??= declaredBaseUrl(config);
    if (paths !== undefined && base !== undefined) break;
  }
  return { paths, base };
}

/**
 * The files of a tsconfig's `extends` chain, nearest first: the file, then
 * each it extends, the later of an `extends` array before the earlier, as
 * TypeScript gives them precedence. `undefined` stands for a file that cannot
 * be read or an `extends` that cannot be resolved, and ends the chain.
 */
function configChain(file: string): (ConfigFile | undefined)[] {
  const chain: (ConfigFile | undefined)[] = [];
  const visit = (path: string | undefined, depth: number): boolean => {
    // A cycle of `extends` stops here rather than recursing for ever.
    const parsed =
      path === undefined || depth > 8 ? undefined : readJsonc(path);
    if (path === undefined || parsed === undefined) {
      chain.push(undefined);
      return false;
    }
    const dir = dirname(path);
    const options = isRecord(parsed.compilerOptions)
      ? parsed.compilerOptions
      : {};
    chain.push({ options, dir });
    return extendsOf(parsed)
      .reverse()
      .every(spec => visit(resolveExtends(spec, dir), depth + 1));
  };
  visit(file, 0);
  return chain;
}

/** The `extends` of a parsed tsconfig, as a list: one string, an array, or none. */
function extendsOf(parsed: Record<string, unknown>): string[] {
  const extended = parsed.extends;
  if (typeof extended === "string") return [extended];
  return Array.isArray(extended)
    ? extended.filter((each): each is string => typeof each === "string")
    : [];
}

/**
 * The file an `extends` names, resolved as TypeScript does: a relative or
 * absolute path from the config's folder, with `.json` added where it has no
 * extension; a package spec through Node's resolver from that folder, as
 * written, with `.json`, or as the package's `tsconfig.json`. `undefined`
 * when none of those is a file.
 */
function resolveExtends(spec: string, dir: string): string | undefined {
  if (spec.startsWith(".") || isAbsolute(spec)) {
    const target = resolve(dir, spec);
    return [target, `${target}.json`].find(isFile);
  }
  const require = createRequire(join(dir, "package.json"));
  for (const candidate of [spec, `${spec}.json`, `${spec}/tsconfig.json`]) {
    try {
      return require.resolve(candidate);
    } catch {
      // Not this spelling; the next is tried.
    }
  }
  return undefined;
}

/** The `paths` one tsconfig declares itself, with its folder, or `undefined` for none. */
function declaredPaths(config: ConfigFile): DeclaredPaths | undefined {
  if (!isRecord(config.options.paths)) return undefined;
  const paths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(config.options.paths)) {
    if (!Array.isArray(targets)) continue;
    paths[pattern] = targets.filter(
      (target): target is string => typeof target === "string"
    );
  }
  return { paths, dir: config.dir };
}

/** The `baseUrl` one tsconfig declares, resolved from its own folder, or `undefined`. */
function declaredBaseUrl(config: ConfigFile): string | undefined {
  const baseUrl = config.options.baseUrl;
  return typeof baseUrl === "string" ? resolve(config.dir, baseUrl) : undefined;
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
 * The package a bare specifier names (`@scope/name` or `name`), or
 * `undefined` for one that names no package.
 */
function packageNameOf(specifier: string): string | undefined {
  const parts = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  if (parts.length < nameLength || parts.some(part => part === "")) {
    return undefined;
  }
  return parts.slice(0, nameLength).join("/");
}

/**
 * Whether a bare specifier names a package installed in a `node_modules` on
 * the way up from `cwd`. Only asked of an alias whose targets are missing:
 * TypeScript then falls back to the package, which is left to the build.
 */
function isInstalledPackage(specifier: string, cwd: string): boolean {
  const name = packageNameOf(specifier);
  return name !== undefined && findPackageDir(name, cwd) !== undefined;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
