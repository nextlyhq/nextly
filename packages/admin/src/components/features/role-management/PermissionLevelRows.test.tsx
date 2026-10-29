/**
 * PermissionLevelRows — the roles screen's rows and plugin groups together.
 *
 * Two plugins may share a sidebar label. Each group must still say which
 * plugin it is, or an administrator cannot tell which one they are granting.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { PluginGroup } from "@admin/lib/permissions/level-rows";

import { PermissionLevelRows } from "./PermissionLevelRows";

function group(plugin: string, slug: string): PluginGroup {
  return {
    plugin,
    rows: [
      {
        slug,
        kind: "collection",
        label: "Report",
        plural: "Reports",
        plugin,
        declaredRules: [],
        permissions: [
          {
            id: `${slug}-read`,
            name: `read ${slug}`,
            resource: slug,
            action: "read",
          },
        ],
      },
    ],
    permissions: [],
  };
}

describe("PermissionLevelRows", () => {
  it("names two plugins that share a label by their packages as well", () => {
    render(
      <PermissionLevelRows
        rows={[]}
        groups={[
          group("@acme/reports", "acme-reports"),
          group("@beta/reports", "beta-reports"),
        ]}
        pluginNames={
          new Map([
            ["@acme/reports", "Reports"],
            ["@beta/reports", "Reports"],
          ])
        }
        value={[]}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", {
        name: /^Reports \(@acme\/reports\), Reports/,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^Reports \(@beta\/reports\), Reports/,
      })
    ).toBeInTheDocument();
  });

  it("names a plugin whose label no other shares by its label alone", () => {
    render(
      <PermissionLevelRows
        rows={[]}
        groups={[group("@acme/reports", "acme-reports")]}
        pluginNames={new Map([["@acme/reports", "Reports"]])}
        value={[]}
        onChange={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /^Reports, Reports, No access$/ })
    ).toBeInTheDocument();
  });
});
