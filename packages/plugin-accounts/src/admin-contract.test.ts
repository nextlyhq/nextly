import { pluginAdminSlug } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  ADMIN_PAGES,
  ADMIN_SLUG,
  adminPageHref,
  PLUGIN_NAME,
} from "./admin-contract";
import { accounts } from "./plugin";

describe("what the server and the admin screens agree on", () => {
  it("names the admin slug core derives from the plugin's name", () => {
    expect(ADMIN_SLUG).toBe(pluginAdminSlug(PLUGIN_NAME));
  });

  it("links to the pages the plugin contributes, an account's by its id", () => {
    expect(adminPageHref("list")).toBe(
      "/admin/plugins/nextlyhq-plugin-accounts/accounts"
    );
    expect(adminPageHref("account", "a b/c")).toBe(
      "/admin/plugins/nextlyhq-plugin-accounts/account?id=a%20b%2Fc"
    );
  });

  it("contributes both pages and the menu entry behind read-accounts, with components from its admin entry", () => {
    const admin = accounts({ origin: "https://shop.example.com" }).contributes
      ?.admin;

    expect(admin?.pages).toEqual([
      { ...ADMIN_PAGES.list, requiredPermission: "read-accounts" },
      { ...ADMIN_PAGES.account, requiredPermission: "read-accounts" },
    ]);
    expect(
      admin?.pages?.every(page =>
        page.component.startsWith(`${PLUGIN_NAME}/admin#`)
      )
    ).toBe(true);
    expect(admin?.menu).toEqual([
      expect.objectContaining({
        to: adminPageHref("list"),
        requiredPermission: "read-accounts",
      }),
    ]);
  });
});
