/**
 * Admin component registration. Importing this module registers the React
 * components referenced by `contributes.admin` string paths so the host admin
 * can resolve them. The host's generated component map imports it for you.
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { SettingsPage } from "./SettingsPage";

const SETTINGS_PATH = "{{pluginName}}/admin#SettingsPage";

registerComponents({ [SETTINGS_PATH]: SettingsPage });

export { SettingsPage };
