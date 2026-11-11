"use client";

/**
 * `@nextlyhq/plugin-seo/admin`: the SEO settings screen and the problem
 * list's, each registered with the admin under the component path the
 * plugin's page names.
 *
 * The registration is what makes the page render: a page names its component
 * by a string, and the admin resolves that string through its component
 * registry, so a component exported but not registered leaves the page empty.
 *
 * @module admin
 */
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { PROBLEMS_PAGE } from "../problems/contract";
import { SETTINGS_PAGE } from "../settings/contract";

import { SeoProblemsPage } from "./SeoProblemsPage";
import { SeoSettingsPage } from "./SeoSettingsPage";

// Registered as the module loads, which is when the component map imports it.
registerComponents({
  [SETTINGS_PAGE.component]: SeoSettingsPage,
  [PROBLEMS_PAGE.component]: SeoProblemsPage,
});

export { SeoProblemsPage } from "./SeoProblemsPage";
export { SeoSettingsPage } from "./SeoSettingsPage";
