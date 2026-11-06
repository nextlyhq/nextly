/**
 * Where `generate:widget` writes: the site or plugin it runs in, and the path
 * of every file it writes there.
 *
 * A plugin package says what it is in its manifest (the `nextly-plugin`
 * keyword the plugin scaffold writes), and a site has a `nextly.config.*`
 * where `findConfigFile` looks. A plugin is checked first: its `dev/` folder
 * holds a config of its own, which is a host for trying it, not a site.
 *
 * @module cli/commands/generate-widget/target
 */
import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { findConfigFile } from "../../../shared/lib/config-file";

import { componentBasename, type WidgetPlan } from "./files";
import type { WidgetTarget } from "./id";

export type TargetChoice = "site" | "plugin" | undefined;

export type TargetAnswer =
  | { ok: true; target: WidgetTarget }
  | { ok: false; reason: string };

/** The package a manifest names, when it calls itself a Nextly plugin. */
async function pluginPackage(root: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(root, "package.json"), "utf8");
  } catch {
    return undefined;
  }
  const manifest = JSON.parse(text) as { name?: unknown; keywords?: unknown };
  const keywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
  return keywords.includes("nextly-plugin") && typeof manifest.name === "string"
    ? manifest.name
    : undefined;
}

/** Whether `path` is inside the folder `root`, both already resolved through their links. */
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * The site whose config the root CLI's `--config` names: that file, relative to
 * `cwd`, rather than the ones `findConfigFile` looks for. It has to be inside
 * `cwd`, the project whose manifest and package manager the command uses, once
 * every link on the way is followed: a config of another project would get its
 * widget files and its edit while this one got the dependencies.
 */
async function siteAt(
  cwd: string,
  configPath: string,
  choice: TargetChoice
): Promise<TargetAnswer> {
  if (choice === "plugin") {
    return {
      ok: false,
      reason: "--config names a site's config, so it cannot go with --plugin",
    };
  }
  const path = resolve(cwd, configPath);
  const real = await realpath(path).catch(() => undefined);
  if (real === undefined) {
    return { ok: false, reason: `no config at ${path}, which --config names` };
  }
  if (!isInside(await realpath(cwd), real)) {
    return {
      ok: false,
      reason: `--config names ${real}, which is outside this project (${cwd}); run it from the root of the project that config belongs to`,
    };
  }
  return { ok: true, target: { kind: "site", root: cwd, configPath: path } };
}

/**
 * The target in `cwd`: the site `configPath` (the root CLI's `--config`) names,
 * else what `choice` names, or what is found there when it names nothing.
 */
export async function findTarget(
  cwd: string,
  choice: TargetChoice,
  configPath?: string
): Promise<TargetAnswer> {
  if (configPath !== undefined) return siteAt(cwd, configPath, choice);
  const packageName = choice === "site" ? undefined : await pluginPackage(cwd);
  if (packageName !== undefined) {
    return { ok: true, target: { kind: "plugin", root: cwd, packageName } };
  }
  if (choice === "plugin") {
    return {
      ok: false,
      reason:
        'no plugin here: --plugin needs a package.json whose "keywords" include "nextly-plugin", as the plugin scaffold writes',
    };
  }
  const found = findConfigFile(cwd);
  if (found !== undefined) {
    return { ok: true, target: { kind: "site", root: cwd, configPath: found } };
  }
  return {
    ok: false,
    reason:
      "found neither a site (a nextly.config.ts here, in src/ or in config/) nor a plugin (a package.json with the nextly-plugin keyword); run it from your app's or plugin's root",
  };
}

/** The folder a target's widget files go in. */
function widgetDir(target: WidgetTarget): string {
  return target.kind === "site"
    ? join(dirname(target.configPath), "src", "dashboard")
    : join(target.root, "src", "widgets");
}

/**
 * Every file `plan` writes, by its absolute path. A component is named
 * `<name>-card`, never the bare name: a plugin's `src/admin` holds modules of
 * its own (`index.ts` among them), and an extensionless import of a name one
 * of them shares would resolve to that module rather than the card.
 */
export function planPaths(plan: WidgetPlan): {
  declaration: string;
  test: string;
  component?: string;
} {
  const dir = widgetDir(plan.target);
  const componentDir =
    plan.target.kind === "site" ? dir : join(plan.target.root, "src", "admin");
  return {
    declaration: join(dir, `${plan.name}.widget.ts`),
    test: join(dir, `${plan.name}.widget.test.ts`),
    ...(plan.view === "component"
      ? { component: join(componentDir, `${componentBasename(plan.name)}.tsx`) }
      : {}),
  };
}
