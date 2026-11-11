/**
 * The package `nextly plugins add` installed, read from the project the way
 * Node resolves a bare name from it: `node_modules/<name>` in the project's
 * folder or the nearest folder above it that has one. Its manifest says how it
 * is registered; its entry, the file an `import` of the name loads as Node
 * resolves it from the project, is what the config will import.
 *
 * @module cli/commands/plugins-add/installed-package
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { pluginRegistrationUnknown } from "../../errors/areas/plugins";

const execFileAsync = promisify(execFile);

/**
 * The package name in a spec as typed: `@acme/seo@^1` is `@acme/seo`, and
 * `seo@alpha` is `seo`. Anything else, such as a folder or a git address, is
 * returned as it is, and is found only if a package is installed by that name.
 */
export function packageNameOf(spec: string): string {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

/** A package's manifest, as far as this reads it. */
export type PackageManifest = Record<string, unknown>;

/** The installed package's folder and manifest, or nothing when it is not installed. */
export async function findInstalledPackage(
  cwd: string,
  name: string
): Promise<{ dir: string; manifest: PackageManifest } | undefined> {
  // Absolute first: a relative folder such as `.` is its own dirname, which
  // would end the walk before any folder above it is looked in.
  for (let at = resolve(cwd); ; at = dirname(at)) {
    const dir = join(at, "node_modules", ...name.split("/"));
    const text = await readFile(join(dir, "package.json"), "utf8").catch(
      () => undefined
    );
    if (text !== undefined) {
      const manifest: unknown = JSON.parse(text);
      if (typeof manifest === "object" && manifest !== null) {
        return { dir, manifest: manifest as PackageManifest };
      }
    }
    if (dirname(at) === at) return undefined;
  }
}

/**
 * Resolves the name in `process.argv[1]` as an `import` from the folder it
 * runs in, and prints the file it names.
 */
const RESOLVE = "process.stdout.write(import.meta.resolve(process.argv[1]))";

/** The line of a failed resolution that says why, for the person adding it. */
function reasonOf(error: unknown): string {
  const text =
    typeof error === "object" && error !== null && "stderr" in error
      ? String((error as { stderr: unknown }).stderr)
      : String(error);
  const line = text
    .split("\n")
    .map(each => each.trim())
    .find(each => /Error/.test(each) && !each.startsWith("node:"));
  return line ?? "Node could not resolve it";
}

/**
 * The file an `import` of `name` from the project at `cwd` loads, as Node
 * itself resolves it: run in the project's folder, by the same Node, with
 * the same environment, so every condition Node matches (`module-sync`
 * among them, and any the site passes with `--conditions`) counts exactly as
 * it does for the site.
 */
async function nodeEntryOf(
  cwd: string,
  name: string,
  execArgv: readonly string[]
): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      ...conditionFlagsOf(execArgv),
      "--input-type=module",
      "--eval",
      RESOLVE,
      name,
    ],
    { cwd: resolve(cwd) }
  );
  return fileURLToPath(stdout);
}

/**
 * The flags among `execArgv` that add conditions Node resolves exports by
 * (`--conditions=site`, `--conditions site`, `-C site`), in order, so the
 * resolving process matches what this one was started with. Those set in
 * `NODE_OPTIONS` reach it with the environment.
 */
function conditionFlagsOf(execArgv: readonly string[]): string[] {
  const flags: string[] = [];
  for (let at = 0; at < execArgv.length; at++) {
    const arg = execArgv[at] ?? "";
    if (arg.startsWith("--conditions=") || /^-C.+/.test(arg)) {
      flags.push(arg);
    } else if (arg === "--conditions" || arg === "-C") {
      const value = execArgv[at + 1];
      if (value !== undefined) flags.push(arg, value);
      at += 1;
    }
  }
  return flags;
}

/**
 * The package's entry, imported, as a record of its exports: the file an
 * `import` of `name` loads from the project at `cwd`.
 */
export async function importEntry(
  cwd: string,
  name: string,
  options: { execArgv?: readonly string[] } = {}
): Promise<Record<string, unknown>> {
  let entry: string;
  try {
    entry = await nodeEntryOf(cwd, name, options.execArgv ?? process.execArgv);
  } catch (error) {
    throw pluginRegistrationUnknown(
      name,
      `Node cannot load its entry from this project: ${reasonOf(error)}`
    );
  }
  const loaded: unknown = await import(pathToFileURL(entry).href);
  return { ...(loaded as Record<string, unknown>) };
}
