"use client";

/**
 * `@nextlyhq/plugin-accounts/admin`: the staff screens, registered with the
 * admin under the component paths the plugin's pages name.
 *
 * The registration is what makes the pages render: a page names its
 * component by a string, and the admin resolves that string through its
 * component registry, so a component exported but not registered leaves the
 * page empty with nothing to say why.
 *
 * @module admin
 */
import {
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/plugin-sdk/admin";

import { ADMIN_PAGES, PLUGIN_NAME } from "../admin-contract";

import { AccountPage } from "./AccountPage";
import { AccountsListPage } from "./AccountsListPage";

const COMPONENTS = {
  [ADMIN_PAGES.list.component]: AccountsListPage,
  [ADMIN_PAGES.account.component]: AccountPage,
};

registerComponents(COMPONENTS);

// The admin can also ask for the components by the plugin's name, when it
// meets one of its pages before this module was imported.
registerKnownPlugin(PLUGIN_NAME, () => {
  registerComponents(COMPONENTS);
  return Promise.resolve();
});

export { AccountPage, type AccountPageProps } from "./AccountPage";
export { AccountsListPage } from "./AccountsListPage";
