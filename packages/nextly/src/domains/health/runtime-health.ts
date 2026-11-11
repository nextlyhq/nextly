/**
 * What System health's Details adds: the runtime the site runs on (Node,
 * Next.js and React, each by its version alone) and each plugin by its name
 * and version.
 *
 * Next.js and React are read as the app imports them, from its own root
 * (`installedPackageVersion`, as the start-up check reads them); one the app
 * does not have, or that cannot be read, is left out rather than guessed.
 *
 * @module domains/health/runtime-health
 */

import { installedPackageVersion } from "../../shared/lib/installed-package-version";

/** The runtime line of Details. */
export interface RuntimeHealth {
  node: string;
  next?: string;
  react?: string;
}

/** One plugin, as Details lists it. */
export interface PluginHealth {
  name: string;
  version: string;
}

/** The runtime, read from the app at `appRoot`. */
export function readRuntimeHealth(appRoot: string): RuntimeHealth {
  const read = (name: string): string | undefined => {
    try {
      return installedPackageVersion(appRoot, name) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const next = read("next");
  const react = read("react");
  return {
    node: process.versions.node,
    ...(next === undefined ? {} : { next }),
    ...(react === undefined ? {} : { react }),
  };
}

/** Each plugin by its name and version, in the order the site lists them. */
export function pluginsHealth(
  plugins: readonly { name: string; version: string }[] | undefined
): PluginHealth[] {
  return (plugins ?? []).map(plugin => ({
    name: plugin.name,
    version: plugin.version,
  }));
}
