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
import { findWorkspaceRoot } from "../utils/workspace";

/**
 * Approves the install scripts of the native packages Nextly installs, BEFORE
 * installing them, for the package managers that run a dependency's script
 * only once the project has approved it. npm and Yarn run them by default.
 *
 * Bun runs one only when the package is in `trustedDependencies` in
 * `package.json`. create-next-app writes that list with its own packages only,
 * so the SQLite driver got no compiled binding and the app answered 500. With
 * no list Bun trusts its own default list, which covers these packages, and a
 * list written here would replace that default for every other package, so an
 * absent list stays absent.
 *
 * pnpm 10 and later approve in their own settings, and with `strictDepBuilds`
 * (on by default) refuse the whole install while one is unreviewed, which
 * stopped the generator with no config or routes written. Each version reads
 * a different place (pnpm.io/settings/build, read 2026-10-16), and only the
 * one the app's pnpm reads is written:
 *
 * - 12.11 and later: `permissions`, when the file already has that section;
 *   its `build` outranks `allowBuilds`, and pnpm's own approval writes there;
 * - 10.26 and later: the `allowBuilds` map in `pnpm-workspace.yaml`;
 * - 10.6 to 10.25: the `onlyBuiltDependencies` list in that file (removed in
 *   pnpm 11, so never written for it);
 * - 10.0 to 10.5: `pnpm.onlyBuiltDependencies` in `package.json`;
 * - 9 and earlier run build scripts by default, and need nothing.
 *
 * With the version unknown, every form a pnpm from 10.6 reads is written.
 *
 * The settings belong to the WORKSPACE: in a monorepo they are at its root,
 * found by walking up as pnpm and Bun do, and a file written into the app's
 * own folder would make it a workspace of its own.
 *
 * Only Nextly's own packages are touched, and any key the app wrote for one of
 * them is its decision: true or false, bare or version-scoped (`esbuild@0.28.1`).
 * A bare key added beside a scoped one would widen what the app trusts to
 * every version. pnpm's own "set this to true or false" placeholder, which it
 * writes after refusing an install, is not a decision, and is replaced. The
 * workspace file is edited as a YAML document rather than rewritten, so the
 * app's other settings and its comments survive.
 *
 * Returns one line per change, and per decision it kept that the app should
 * know about, for the caller to show.
 */
export async function approveNativeBuilds(
  cwd: string,
  packageManager: PackageManager,
  pnpmVersion: string | undefined
): Promise<string[]> {
  if (packageManager === "bun") return approveForBun(cwd);
  if (packageManager !== "pnpm") return [];
  return approveForPnpm(cwd, parseVersion(pnpmVersion));
}

interface Version {
  major: number;
  minor: number;
}

function parseVersion(raw: string | undefined): Version | undefined {
  const match = raw?.match(/^(\d+)\.(\d+)/);
  return match
    ? { major: Number(match[1]), minor: Number(match[2]) }
    : undefined;
}

const atLeast = (version: Version, major: number, minor: number): boolean =>
  version.major > major || (version.major === major && version.minor >= minor);

const WORKSPACE_FILE = "pnpm-workspace.yaml";

async function approveForBun(cwd: string): Promise<string[]> {
  const root = (await findWorkspaceRoot(cwd))?.dir ?? cwd;
  return approveInPackageJson(root, ["trustedDependencies"], {
    onlyIfListed: true,
    why: WHY.bun,
  });
}

async function approveForPnpm(
  cwd: string,
  version: Version | undefined
): Promise<string[]> {
  if (version && !atLeast(version, 10, 0)) return [];
  // pnpm reads the nearest workspace file, so one in the app's own folder
  // makes the app its own root; otherwise the workspace that lists it is.
  const root = (await fs.pathExists(path.join(cwd, WORKSPACE_FILE)))
    ? cwd
    : ((await findWorkspaceRoot(cwd))?.dir ?? cwd);
  if (version && !atLeast(version, 10, 6)) {
    return approveInPackageJson(root, ["pnpm", "onlyBuiltDependencies"], {
      why: WHY.pnpm,
    });
  }
  return approveInWorkspaceFile(root, formsFor(version));
}

/** Which of the workspace file's approval forms the app's pnpm reads. */
interface Forms {
  permissions: boolean;
  allowBuilds: boolean;
  onlyBuilt: boolean;
}

function formsFor(version: Version | undefined): Forms {
  if (!version)
    return { permissions: true, allowBuilds: true, onlyBuilt: true };
  return {
    permissions: atLeast(version, 12, 11),
    allowBuilds: atLeast(version, 10, 26),
    onlyBuilt: !atLeast(version, 10, 26),
  };
}

async function approveInWorkspaceFile(
  root: string,
  forms: Forms
): Promise<string[]> {
  const file = path.join(root, WORKSPACE_FILE);
  const doc = parseDocument(
    (await fs.pathExists(file)) ? await fs.readFile(file, "utf8") : ""
  );

  const approved: string[] = [];
  const kept: string[] = [];
  for (const dep of NEXTLY_NATIVE_BUILD_DEPENDENCIES) {
    const decision = appDecision(doc, dep, forms);
    if (decision === undefined) {
      approve(doc, dep, forms);
      approved.push(dep);
    } else if (decision) {
      kept.push(decision);
    }
  }

  if (approved.length > 0) await fs.writeFile(file, doc.toString());
  return describe(approved, kept, WORKSPACE_FILE, WHY.pnpm);
}

/**
 * The app's own decision on `dep`, in a place its pnpm reads: undefined when
 * it has none, "" when it approved, or a line to show when it denied it or
 * scoped it to versions.
 */
function appDecision(
  doc: Document,
  dep: string,
  forms: Forms
): string | undefined {
  const fromMaps = [
    forms.permissions && decisionIn(doc, "permissions", dep, buildOf),
    forms.allowBuilds && decisionIn(doc, "allowBuilds", dep, booleanOf),
  ].find(found => typeof found === "string");
  if (typeof fromMaps === "string") return fromMaps;
  if (!forms.onlyBuilt) return undefined;
  if (listNames(doc, "onlyBuiltDependencies", dep)) return "";
  const denied =
    listNames(doc, "neverBuiltDependencies", dep) ||
    listNames(doc, "ignoredBuiltDependencies", dep);
  return denied
    ? `Left ${dep} unbuilt, as the project's pnpm settings say.`
    : undefined;
}

/** A key of `section` naming `dep`, bare or version-scoped, with a decision. */
function decisionIn(
  doc: Document,
  section: string,
  dep: string,
  decisionOf: (value: unknown) => boolean | undefined
): string | undefined {
  const map = doc.get(section, true);
  if (!isMap(map)) return undefined;
  for (const pair of map.items) {
    const key = String(isScalar(pair.key) ? pair.key.value : pair.key);
    if (key !== dep && !key.startsWith(`${dep}@`)) continue;
    const decided = decisionOf(pair.value);
    if (decided === undefined) continue;
    if (key !== dep) {
      // Its other versions stay unapproved: a bare key here would widen what
      // the project chose to trust, and no exact version is known before the
      // install resolves one.
      return (
        `Kept the project's own ${key} decision in ${section}. Other versions of ${dep} ` +
        "stay unapproved: if the install stops with ERR_PNPM_IGNORED_BUILDS, approve the " +
        "version it names."
      );
    }
    return decided
      ? ""
      : `Left ${dep} denied in ${section}, as the project set it.`;
  }
  return undefined;
}

const booleanOf = (value: unknown): boolean | undefined => {
  const raw = isScalar(value) ? value.value : value;
  return typeof raw === "boolean" ? raw : undefined;
};

const buildOf = (value: unknown): boolean | undefined =>
  isMap(value) ? booleanOf(value.get("build", true)) : undefined;

function listNames(doc: Document, section: string, dep: string): boolean {
  const seq = doc.get(section, true);
  if (!isSeq(seq)) return false;
  return seq.items.some(item => {
    const name = String(isScalar(item) ? item.value : item);
    return name === dep || name.startsWith(`${dep}@`);
  });
}

/** Records `dep` as approved in each form the app's pnpm reads. */
function approve(doc: Document, dep: string, forms: Forms): void {
  const permissions = doc.get("permissions", true);
  if (forms.permissions && isMap(permissions)) {
    const entry = permissions.get(dep, true);
    if (isMap(entry)) {
      entry.set("build", true);
    } else {
      const created = new YAMLMap();
      created.set("build", true);
      permissions.set(dep, created);
    }
  } else if (forms.allowBuilds) {
    sectionMap(doc, "allowBuilds").set(dep, true);
  }
  if (forms.onlyBuilt && !listNames(doc, "onlyBuiltDependencies", dep)) {
    sectionSeq(doc, "onlyBuiltDependencies").add(dep);
  }
}

function sectionMap(doc: Document, section: string): YAMLMap {
  const existing = doc.get(section, true);
  if (isMap(existing)) return existing;
  const created = new YAMLMap();
  doc.set(section, created);
  return created;
}

function sectionSeq(doc: Document, section: string): YAMLSeq {
  const existing = doc.get(section, true);
  if (isSeq(existing)) return existing;
  const created = new YAMLSeq();
  doc.set(section, created);
  return created;
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
  root: string,
  listPath: readonly [string, ...string[]],
  { onlyIfListed = false, why }: { onlyIfListed?: boolean; why: string }
): Promise<string[]> {
  const file = path.join(root, "package.json");
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
 * them. The app's own entries are kept exactly as they are, whatever they hold,
 * and a version-scoped entry for one of Nextly's packages counts as listing it.
 */
function appendMissing(
  pkg: JsonObject,
  listPath: readonly [string, ...string[]]
): string[] {
  const parent = objectAt(pkg, listPath.slice(0, -1));
  const listKey = listPath[listPath.length - 1];
  const current = parent[listKey];
  const listed: unknown[] = Array.isArray(current) ? current : [];
  const names = listed.map(String);
  const missing = NEXTLY_NATIVE_BUILD_DEPENDENCIES.filter(
    dep => !names.some(name => name === dep || name.startsWith(`${dep}@`))
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
  kept: readonly string[],
  where: string,
  why: string
): string[] {
  const notes: string[] = [];
  if (approved.length > 0) {
    notes.push(
      `Approved the build scripts of ${listInWords(approved)} in ${where}: ${why}`
    );
  }
  return [...notes, ...kept.map(line => line.replace(/\.$/, ` (${where}).`))];
}

/** "a", "a and b", "a, b and c". */
function listInWords(items: readonly string[]): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
