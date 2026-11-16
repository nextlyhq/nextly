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
import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import { ADMIN_PAGES } from "../admin-contract";

import { AccountPage } from "./AccountPage";
import { AccountsListPage } from "./AccountsListPage";

const COMPONENTS = {
  [ADMIN_PAGES.list.component]: AccountsListPage,
  [ADMIN_PAGES.account.component]: AccountPage,
};

// Registered as the module loads, which is when the component map imports it.
registerComponents(COMPONENTS);

export { AccountPage, type AccountPageProps } from "./AccountPage";
export { AccountsListPage } from "./AccountsListPage";
