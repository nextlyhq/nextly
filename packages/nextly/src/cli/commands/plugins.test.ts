import { describe, expect, it, vi } from "vitest";

import type { PluginInfo } from "../../plugins/plugin-introspection";
import { renderPluginInfo, renderPluginsList } from "./plugins";

function info(overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    name: "@nextlyhq/plugin-form-builder",
    version: "2.0.0",
    nextly: "^1.0.0",
    enabled: true,
    dependsOn: [],
    optionalDependsOn: [],
    collections: ["forms", "form-submissions"],
    singles: [],
    components: [],
    permissions: ["export-submissions"],
    events: ["form-builder.submitted"],
    routeCount: 1,
    adminMenuCount: 1,
    adminPageCount: 1,
    hasSettings: true,
    renamed: {},
    ...overrides,
  };
}

describe("renderPluginsList (D48)", () => {
  it("prints a table with one row per plugin", () => {
    const logger = { header: vi.fn(), info: vi.fn(), table: vi.fn() };
    renderPluginsList(
      [info(), info({ name: "@acme/x", enabled: false })],
      logger
    );

    expect(logger.table).toHaveBeenCalledTimes(1);
    const [headers, rows] = logger.table.mock.calls[0];
    expect(headers).toEqual([
      "name",
      "version",
      "enabled",
      "collections",
      "routes",
      "permissions",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([
      "@nextlyhq/plugin-form-builder",
      "2.0.0",
      "yes",
      2,
      1,
      1,
    ]);
    // Disabled plugin shows "no".
    expect(rows[1][2]).toBe("no");
  });

  it("reports the empty case without a table", () => {
    const logger = { header: vi.fn(), info: vi.fn(), table: vi.fn() };
    renderPluginsList([], logger);
    expect(logger.table).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("No plugins registered.");
  });
});

describe("renderPluginInfo (D48)", () => {
  it("prints key/value details and itemized contributions", () => {
    const logger = {
      header: vi.fn(),
      keyValue: vi.fn(),
      item: vi.fn(),
      info: vi.fn(),
    };
    renderPluginInfo(info({ renamed: { forms: "contact-forms" } }), logger);

    expect(logger.header).toHaveBeenCalledWith("@nextlyhq/plugin-form-builder");
    const kv = Object.fromEntries(logger.keyValue.mock.calls);
    expect(kv.version).toBe("2.0.0");
    expect(kv.enabled).toBe("yes");
    expect(kv.renamed).toBe("forms→contact-forms");
    expect(kv["settings page"]).toBe("yes");
    // Permissions are itemized.
    expect(logger.item).toHaveBeenCalledWith("export-submissions", 1);
  });
});
