import path from "path";

import { execa } from "execa";
import fs from "fs-extra";

import { EXACT_VERSION } from "../lib/exact-version";
import type { PackageManager } from "../types";
import { packageManagerFromUserAgent } from "../utils/detect-pm-from-user-agent";
import { findWorkspaceRoot } from "../utils/workspace";

/**
 * Records `packageManager` in the project's package.json before its first
 * install: the pnpm or Yarn version that launched this CLI, so Corepack runs
 * the version the person chose rather than its own default. Returns the
 * value written, or null when nothing was.
 *
 * With `selected` (an explicit `--package-manager`), the manager named there
 * and the exact version it reports in the project are recorded instead of
 * the launcher's: that is the binary the install runs next, so the pin names
 * what installed the project even when another manager launched the scaffold.
 *
 * Nothing is written when:
 * - the project already chooses one, by `packageManager` or by
 *   `devEngines.packageManager`, which Corepack obeys when `packageManager`
 *   is absent;
 * - the user agent (or the selected manager) is npm or Bun, or gives no
 *   exact version;
 * - the manager that will install is not the one the user agent names, as for
 *   a pnpm app reached through `npx`;
 * - the project is a member of a workspace: Corepack reads the closest
 *   package.json, so a member's field would override the workspace's choice,
 *   or make one for it.
 *
 * The field is inserted into the file's text rather than the file rewritten,
 * so an app's package.json changes by this one line, whatever its formatting.
 */
export async function recordLaunchingPackageManager(
  cwd: string,
  installer: PackageManager,
  options: { selected?: boolean; userAgent?: string } = {}
): Promise<string | null> {
  const file = path.join(cwd, "package.json");
  let text: string;
  let manifest: Record<string, unknown>;
  try {
    text = await fs.readFile(file, "utf-8");
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // No readable package.json: nothing to record the choice in.
    return null;
  }
  const devEngines = manifest.devEngines as Record<string, unknown> | undefined;
  if (manifest.packageManager !== undefined) return null;
  if (devEngines?.packageManager !== undefined) return null;
  if (await findWorkspaceRoot(cwd)) return null;

  // Read last, once nothing above rules the field out: the selected
  // manager's version costs a process.
  const value = options.selected
    ? await installerVersion(cwd, installer)
    : packageManagerFromUserAgent(
        options.userAgent ?? process.env.npm_config_user_agent
      );
  if (value === null || !value.startsWith(`${installer}@`)) return null;

  await fs.writeFile(file, withPackageManager(text, value), "utf-8");
  return value;
}

/**
 * `<manager>@<version>` for pnpm or Yarn as `<manager> --version` answers in
 * `cwd`, where Corepack, if it handles the manager, resolves the same binary
 * the install runs; null for npm and Bun, or when no exact version is read.
 */
async function installerVersion(
  cwd: string,
  installer: PackageManager
): Promise<string | null> {
  if (installer !== "pnpm" && installer !== "yarn") return null;
  try {
    const { stdout } = await execa(installer, ["--version"], {
      cwd,
      stdin: "ignore",
    });
    const version = String(stdout).trim();
    return EXACT_VERSION.test(version) ? `${installer}@${version}` : null;
  } catch {
    return null;
  }
}

/**
 * `text`, a package.json with no `packageManager`, with that field added as
 * the object's last member: one new line, in the file's own indentation and
 * line endings, and a comma after the member before it. Nothing else moves,
 * so an inline array, CRLF endings or trailing blank lines stay as written.
 */
function withPackageManager(text: string, value: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
  const close = text.lastIndexOf("}");
  const before = text.slice(0, close).replace(/\s*$/, "");
  const comma = before.endsWith("{") ? "" : ",";
  return (
    `${before}${comma}${eol}${indent}"packageManager": ${JSON.stringify(value)}` +
    `${eol}${text.slice(close)}`
  );
}
