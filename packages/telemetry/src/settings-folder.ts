// The person's Nextly settings folder, published as
// `@nextlyhq/telemetry/settings-folder`. It is the folder the usage-data
// consent file already lives in: `conf` with the project name "nextly" keeps
// its file there. Code that needs the folder (to keep its own settings beside
// that file) imports this entry, so the product computes the folder in one
// place and never loads the usage-data client just to learn a path.
import envPaths from "env-paths";

import { CONF_PROJECT_NAME } from "./constants.js";

/**
 * The suffix `conf` adds to its project name by default (its `projectSuffix`
 * option), which the consent store leaves unset.
 */
const CONF_PROJECT_SUFFIX = "nodejs";

/**
 * The folder Nextly keeps a person's settings in on this machine: the same
 * env-paths call `conf` makes for the consent store.
 *
 * - macOS: `~/Library/Preferences/nextly-nodejs`
 * - Linux: `$XDG_CONFIG_HOME/nextly-nodejs` (default `~/.config/nextly-nodejs`)
 * - Windows: `%APPDATA%\nextly-nodejs\Config`
 *
 * It only computes the path; it doesn't create the folder.
 *
 * @experimental
 */
export function nextlySettingsFolder(): string {
  return envPaths(CONF_PROJECT_NAME, { suffix: CONF_PROJECT_SUFFIX }).config;
}
