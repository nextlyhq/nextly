"use client";

/**
 * `@nextlyhq/plugin-seo/admin`: the SEO settings screen, registered with the
 * admin under the component path the plugin's page names.
 *
 * The registration is what makes the page render: a page names its component
 * by a string, and the admin resolves that string through its component
 * registry, so a component exported but not registered leaves the page empty.
 *
 * @module admin
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { SETTINGS_PAGE } from "../settings/contract";

import { SeoSettingsPage } from "./SeoSettingsPage";

// Registered as the module loads, which is when the component map imports it.
registerComponents({ [SETTINGS_PAGE.component]: SeoSettingsPage });

export { SeoSettingsPage } from "./SeoSettingsPage";
