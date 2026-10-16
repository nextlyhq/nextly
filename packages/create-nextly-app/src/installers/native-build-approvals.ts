import path from "path";

import fs from "fs-extra";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  YAMLMap,
  YAMLSeq,
  type Document,
} from "yaml";

import type { PackageManager } from "../types";
import { NEXTLY_NATIVE_BUILD_DEPENDENCIES } from "../utils/template";

/**
 * Approves the install scripts of the native packages Nextly installs, BEFORE
 * installing them, for the package managers that run a dependency's script
 * only once the project has approved it. npm and Yarn run them by default.
 *
 * Bun runs one only when the package is in `trustedDependencies` in
 * `package.json`. create-next-app writes that list with its own packages only,
 * so the SQLite driver got no compiled binding and the app answered 500.
 *
 * pnpm 10 and later approve in their own files, and pnpm 11 and later refuse
 * the whole install while one is unapproved, which stopped the generator with
 * no config or routes written. pnpm's place depends on its version:
 *
 * - pnpm 11 and later: the `allowBuilds` map in `pnpm-workspace.yaml`;
 * - pnpm 10.6 and later: the `onlyBuiltDependencies` list in the same file;
 * - pnpm 10.0 to 10.5: `pnpm.onlyBuiltDependencies` in `package.json`, since
 *   those versions read neither key from the workspace file;
 * - pnpm 9 and earlier run build scripts by default, and need nothing.
 *
 * From 10.6 both keys are written, as a fresh scaffold writes them, so an app
 * that later moves between pnpm 10 and 11 keeps working.
 *
 * Only Nextly's own packages are touched. A value the app already set, true or
 * false, is its decision and stays; pnpm's own "set this to true or false"
 * placeholder, which it writes after refusing an install, is not a decision,
 * and is replaced for Nextly's packages only. The workspace file is edited as
 * a YAML document rather than rewritten, so the app's other settings and its
 * comments survive.
 *
 * Returns one line per change, and per choice it kept, for the caller to show.
 */
export async function approveNativeBuilds(
  cwd: string,
  packageManager: PackageManager,
  pnpmVersion: string | undefined
): Promise<string[]> {
  if (packageManager === "bun") {
    // Only an app that keeps its own list needs Nextly's packages in it: with
    // none, Bun's default list already trusts them, and a list written here
    // would replace that default for every other package.
    return approveInPackageJson(cwd, ["trustedDependencies"], {
      onlyIfListed: true,
      why: WHY.bun,
    });
  }
  if (packageManager !== "pnpm") return [];

  const version = parseVersion(pnpmVersion);
  if (version && version.major < 10) return [];

  if (version && version.major === 10 && version.minor < 6) {
    return approveInPackageJson(cwd, ["pnpm", "onlyBuiltDependencies"], {
      why: WHY.pnpm,
    });
  }

  return approveInWorkspaceFile(cwd);
}

function parseVersion(
  raw: string | undefined
): { major: number; minor: number } | undefined {
  const match = raw?.match(/^(\d+)\.(\d+)/);
  return match
    ? { major: Number(match[1]), minor: Number(match[2]) }
    : undefined;
}

const WORKSPACE_FILE = "pnpm-workspace.yaml";

async function approveInWorkspaceFile(cwd: string): Promise<string[]> {
  const file = path.join(cwd, WORKSPACE_FILE);
  const source = (await fs.pathExists(file))
    ? await fs.readFile(file, "utf8")
    : "";
  const doc = parseDocument(source);

  const { approved, keptFalse } = approveInAllowBuilds(doc);
  const listed = listInOnlyBuilt(
    doc,
    NEXTLY_NATIVE_BUILD_DEPENDENCIES.filter(dep => !keptFalse.includes(dep))
  );

  if (approved.length > 0 || listed) {
    await fs.writeFile(file, doc.toString());
  }
  return describe(approved, keptFalse, WORKSPACE_FILE, WHY.pnpm);
}

/** Sets each of Nextly's packages to true unless the app already chose. */
function approveInAllowBuilds(doc: Document): {
  approved: string[];
  keptFalse: string[];
} {
  const approved: string[] = [];
  const keptFalse: string[] = [];
  const existing = doc.get("allowBuilds", true);
  const map = isMap(existing) ? existing : new YAMLMap();
  if (map !== existing) doc.set("allowBuilds", map);
  for (const dep of NEXTLY_NATIVE_BUILD_DEPENDENCIES) {
    const current = map.get(dep, true);
    const value = isScalar(current) ? current.value : current;
    if (value === false) {
      keptFalse.push(dep);
    } else if (value !== true) {
      map.set(dep, true);
      approved.push(dep);
    }
  }
  return { approved, keptFalse };
}

/** Adds the missing ones to `onlyBuiltDependencies`; true when it changed. */
function listInOnlyBuilt(doc: Document, deps: readonly string[]): boolean {
  const existing = doc.get("onlyBuiltDependencies", true);
  const seq = isSeq(existing) ? existing : new YAMLSeq();
  if (seq !== existing) doc.set("onlyBuiltDependencies", seq);
  const present = new Set(
    seq.items.map((item: unknown) => (isScalar(item) ? item.value : item))
  );
  const missing = deps.filter(dep => !present.has(dep));
  for (const dep of missing) seq.add(dep);
  return missing.length > 0;
}

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function hasListAt(pkg: JsonObject, listPath: readonly string[]): boolean {
  let node: unknown = pkg;
  for (const key of listPath) {
    if (!isJsonObject(node)) return false;
    node = node[key];
  }
  return Array.isArray(node);
}

/**
 * Appends Nextly's missing packages to the string list at `listPath` in
 * package.json (`trustedDependencies` for Bun, `pnpm.onlyBuiltDependencies`
 * for pnpm 10.0 to 10.5), creating it, and any object above it, when absent,
 * unless `onlyIfListed` says an absent list must stay absent.
 */
async function approveInPackageJson(
  cwd: string,
  listPath: readonly [string, ...string[]],
  { onlyIfListed = false, why }: { onlyIfListed?: boolean; why: string }
): Promise<string[]> {
  const file = path.join(cwd, "package.json");
  const source = await fs.readFile(file, "utf8");
  const pkg: unknown = JSON.parse(source);
  if (!isJsonObject(pkg) || (onlyIfListed && !hasListAt(pkg, listPath))) {
    return [];
  }

  const missing = appendMissing(pkg, listPath);
  if (missing.length === 0) return [];

  // Keep the file's own indentation, so the diff is only the added names.
  const indent = source.match(/^[ \t]+(?=")/m)?.[0] ?? "  ";
  await fs.writeFile(file, JSON.stringify(pkg, null, indent) + "\n");
  return describe(missing, [], "package.json", why);
}

/**
 * Adds Nextly's packages the list at `listPath` lacks, in place, and returns
 * them. The app's own entries are kept exactly as they are, whatever they hold.
 */
function appendMissing(
  pkg: JsonObject,
  listPath: readonly [string, ...string[]]
): string[] {
  const parent = objectAt(pkg, listPath.slice(0, -1));
  const listKey = listPath[listPath.length - 1];
  const current = parent[listKey];
  const listed: unknown[] = Array.isArray(current) ? current : [];
  const missing = NEXTLY_NATIVE_BUILD_DEPENDENCIES.filter(
    dep => !listed.includes(dep)
  );
  if (missing.length > 0) parent[listKey] = [...listed, ...missing];
  return missing;
}

/** The object at `keys` under `pkg`, creating each one that is absent. */
function objectAt(pkg: JsonObject, keys: readonly string[]): JsonObject {
  let parent = pkg;
  for (const key of keys) {
    const next = parent[key];
    const child: JsonObject = isJsonObject(next) ? next : {};
    parent[key] = child;
    parent = child;
  }
  return parent;
}

/** Why each manager needs the approval, said after what was approved. */
const WHY = {
  pnpm: "pnpm runs a package's build script only once it is approved.",
  bun: "Bun runs a package's install script only when the app's list trusts it.",
} as const;

function describe(
  approved: readonly string[],
  keptFalse: readonly string[],
  where: string,
  why: string
): string[] {
  const notes: string[] = [];
  if (approved.length > 0) {
    notes.push(
      `Approved the build scripts of ${listInWords(approved)} in ${where}: ${why}`
    );
  }
  for (const dep of keptFalse) {
    notes.push(`Left ${dep}: false in ${where}, as the project set it.`);
  }
  return notes;
}

/** "a", "a and b", "a, b and c". */
function listInWords(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
