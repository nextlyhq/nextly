/**
 * "Is this route under that one" is asked by the sidebar's category
 * classifier and by its active-item matcher. These cover the answers a
 * substring test gets wrong, which is why both now ask one function.
 */
import { describe, expect, it } from "vitest";

import { ROUTES } from "@admin/constants/routes";
import { isUnder } from "@admin/lib/routing";

describe("isUnder", () => {
  it("matches the route itself and its descendants", () => {
    expect(isUnder("/admin/plugins", "/admin/plugins")).toBe(true);
    expect(isUnder("/admin/plugins/acme-forms", "/admin/plugins")).toBe(true);
    expect(
      isUnder("/admin/plugins/acme-forms/settings", "/admin/plugins")
    ).toBe(true);
  });

  /**
   * The separating case. `"/admin/plugins-archive".includes("/admin/plugins")`
   * is true, so the substring test this replaced classified an unrelated
   * sibling as a plugins page — and the miss is silent, because the wrong
   * answer is a real category rather than an error.
   */
  it("rejects a sibling that merely shares the prefix", () => {
    expect(isUnder("/admin/plugins-archive", "/admin/plugins")).toBe(false);
    expect(isUnder("/admin/plugin-directory", "/admin/plugins")).toBe(false);
  });

  it("ignores a trailing slash on either side", () => {
    expect(isUnder("/admin/plugins/", "/admin/plugins")).toBe(true);
    expect(isUnder("/admin/plugins", "/admin/plugins/")).toBe(true);
  });

  it("does not match a parent from a child route", () => {
    expect(isUnder("/admin", "/admin/plugins")).toBe(false);
  });

  /**
   * The directory is deliberately not under `/admin/plugins`, so anything
   * classifying the Plugins section has to name it separately. Pinned here
   * because the consequence of forgetting is a silently wrong sidebar rather
   * than a failure.
   */
  it("confirms the directory is outside the installed-plugins subtree", () => {
    expect(isUnder(ROUTES.PLUGIN_BROWSE, ROUTES.PLUGINS)).toBe(false);
    expect(isUnder(ROUTES.PLUGIN_BROWSE, ROUTES.PLUGIN_BROWSE)).toBe(true);
  });
});
