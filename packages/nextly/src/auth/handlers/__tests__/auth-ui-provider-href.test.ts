import { describe, expect, it, vi } from "vitest";

import type { PluginDefinition } from "../../../plugins/plugin-context";
import { aggregateAuthUi, authUiProblems, isSameOriginPath } from "../auth-ui";

function pluginWith(
  href: string | undefined,
  component?: string
): PluginDefinition {
  return {
    name: "@test/provider",
    version: "0.0.0",
    nextly: ">=0.0.1",
    contributes: {
      auth: {
        ui: {
          providers: [
            {
              strategy: "google",
              label: "Continue with Google",
              href,
              ...(component ? { component } : {}),
            },
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

  it("keeps a provider that renders a component instead of an href", () => {
    const ui = aggregateAuthUi([
      pluginWith(undefined, "@test/provider/admin#GoogleButton"),
    ]);
    expect(ui.providers).toHaveLength(1);
    expect(ui.providers[0].href).toBeUndefined();
  });

  it("drops a provider with neither an href nor a component", () => {
    // Its button would do nothing: the page rendered an empty provider
    // area, and a gap where the button should have been.
    expect(aggregateAuthUi([pluginWith(undefined)]).providers).toHaveLength(0);
    expect(authUiProblems([pluginWith(undefined)])).toEqual([
      expect.stringContaining("neither an href nor a component"),
    ]);
  });

  it.each([["https://evil.example"], ["//evil.example"], ["/\\evil"]])(
    "drops a provider whose href is %s, reporting it at boot only",
    href => {
      // The served list is rebuilt on every `/auth/*` request and every
      // `ctx.auth` call, so a warning emitted while building it repeated on
      // each one. The problem is reported once, by the boot check.
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ui = aggregateAuthUi([pluginWith(href)]);
      expect(ui.providers).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      expect(authUiProblems([pluginWith(href)])).toEqual([
        expect.stringContaining("same-origin path"),
      ]);
    }
  );

  it("reports nothing for usable providers", () => {
    // The control: a report that named every provider would satisfy the
    // cases above.
    expect(
      authUiProblems([
        pluginWith("/sso/google/authorize"),
        pluginWith(undefined, "@test/provider/admin#GoogleButton"),
      ])
    ).toEqual([]);
  });
});
