/**
 * Admin component registration (D19/D60). Importing this module registers the
 * React components referenced by `contributes.admin` string paths so the host
 * admin can resolve them. The host's generated import map imports this for you;
 * the eager + lazy registration below is the fallback.
 */
import { registerComponents, registerKnownPlugin } from "@nextlyhq/admin";

import { SettingsPage } from "./SettingsPage";

const SETTINGS_PATH = "{{pluginName}}/admin#SettingsPage";

// Eager: register on module load.
registerComponents({ [SETTINGS_PATH]: SettingsPage });

// Lazy fallback: the host can trigger registration on demand by package prefix.
registerKnownPlugin("{{pluginName}}", async () => {
  registerComponents({ [SETTINGS_PATH]: SettingsPage });
});

export { SettingsPage };
