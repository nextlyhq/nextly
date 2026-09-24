import { describe, expect, it, vi } from "vitest";

import type { PluginDefinition } from "../../../plugins/plugin-context";
import { aggregateAuthUi, isSameOriginPath } from "../auth-ui";

function pluginWith(href: string | undefined): PluginDefinition {
  return {
    name: "@test/provider",
    version: "0.0.0",
    nextly: ">=0.0.1",
    contributes: {
      auth: {
        ui: {
          providers: [
            { strategy: "google", label: "Continue with Google", href },
          ],
        },
      },
    },
  } as PluginDefinition;
}

describe("isSameOriginPath", () => {
  it.each([
    ["/admin/api/plugins/x/google/authorize"],
    ["/sso/google/authorize"],
    ["/admin"],
    ["/a?next=/admin"],
  ])("accepts the same-origin path %s", href => {
    expect(isSameOriginPath(href)).toBe(true);
  });

  it.each([
    ["https://evil.example", "absolute URL"],
    ["//evil.example", "protocol-relative"],
    ["/\\evil", "backslash authority"],
    ["javascript:alert(1)", "scheme"],
    ["admin/api", "not rooted"],
    ["", "empty"],
    ["/admin\r\nX: y", "header injection"],
  ])("refuses %s (%s)", href => {
    expect(isSameOriginPath(href)).toBe(false);
  });
});

describe("aggregateAuthUi provider hrefs", () => {
  it("keeps a provider whose href is a plugin route under the API base", () => {
    const ui = aggregateAuthUi([
      pluginWith("/admin/api/plugins/x/google/authorize"),
    ]);
    expect(ui.providers).toHaveLength(1);
    expect(ui.providers[0].href).toBe("/admin/api/plugins/x/google/authorize");
  });

  it("keeps a provider mounted at the root", () => {
    // The API base path is configurable and a plugin may mount at the root,
    // so the rule is same-origin rather than a required prefix.
    const ui = aggregateAuthUi([pluginWith("/sso/google/authorize")]);
    expect(ui.providers[0].href).toBe("/sso/google/authorize");
  });

  it("keeps a provider that declares no href at all", () => {
    const ui = aggregateAuthUi([pluginWith(undefined)]);
    expect(ui.providers).toHaveLength(1);
    expect(ui.providers[0].href).toBeUndefined();
  });

  it.each([["https://evil.example"], ["//evil.example"], ["/\\evil"]])(
    "drops a provider whose href is %s",
    href => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ui = aggregateAuthUi([pluginWith(href)]);
      expect(ui.providers).toHaveLength(0);
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    }
  );
});
