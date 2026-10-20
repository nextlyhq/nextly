import path from "path";

import fs from "fs-extra";

import type { PackageManager } from "../types";
import { packageManagerFromUserAgent } from "../utils/detect-pm-from-user-agent";
import { findWorkspaceRoot } from "../utils/workspace";

/**
 * Records `packageManager` in the project's package.json before its first
 * install: the pnpm or Yarn version that launched this CLI, so Corepack runs
 * the version the person chose rather than its own default. Returns the
 * value written, or null when nothing was.
 *
 * Nothing is written when:
 * - the project already chooses one, by `packageManager` or by
 *   `devEngines.packageManager`, which Corepack obeys when `packageManager`
 *   is absent;
 * - the user agent names npm or Bun, or no exact version;
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
  userAgent: string | undefined = process.env.npm_config_user_agent
): Promise<string | null> {
  const value = packageManagerFromUserAgent(userAgent);
  if (value === null || !value.startsWith(`${installer}@`)) return null;

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

  await fs.writeFile(file, withPackageManager(text, value), "utf-8");
  return value;
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
