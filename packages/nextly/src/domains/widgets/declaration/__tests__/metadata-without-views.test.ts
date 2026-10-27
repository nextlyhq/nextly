/**
 * Every widget's metadata is listed without importing its view: a view names
 * its component by a path, so registering core's widgets and a plugin's reads
 * no admin module at all, and a component that fails to load costs its own
 * card, never the list the add panel and the startup checks read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The view modules something tried to load, in order. */
const imported = vi.hoisted(() => [] as string[]);

// Each module a view could be drawn from records the attempt and refuses to
// load: the plugin's own components, and the admin, which draws core's.
vi.mock("./plugin/admin", () => {
  imported.push("./plugin/admin");
  throw new Error("a widget's view module was imported");
});
vi.mock("@nextlyhq/admin", () => {
  imported.push("@nextlyhq/admin");
  throw new Error("the admin was imported");
});

import { resetWidgetRegistries } from "../../../../di/registrations/register-widgets";
import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import { definePlugin } from "../../../../plugins/plugin-context";
import { CORE_WIDGETS } from "../../core-widgets";
import { getWidget, listWidgets } from "../../registry";
import { dashboard, widgets } from "./plugin/widgets";

beforeEach(() => {
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a widget's metadata", () => {
  it("is listed for core and a plugin with no view module loaded", () => {
    // Through the reset both boot paths call, core's sources and cards included.
    try {
      resetWidgetRegistries([
        definePlugin({
          name: "@acme/shop",
          version: "1.0.0",
          nextly: "*",
          contributes: { dashboard },
        }),
      ]);
    } catch (error) {
      // Startup's own detail, so a refusal says which fault it was.
      throw new Error(
        error instanceof NextlyError ? error.logMessage : String(error)
      );
    }
    expect(imported).toEqual([]);
    const listed = new Set(listWidgets().map(widget => widget.id));
    for (const { id } of [...CORE_WIDGETS, ...widgets]) {
      expect(listed.has(id), id).toBe(true);
    }
    // What the add panel shows, read from the registry alone.
    expect(getWidget("acme/revenue")).toMatchObject({
      title: "Revenue",
      category: "Shop",
      component: "@acme/nextly-plugin-shop/admin#RevenueCard",
      size: { default: { w: 8, h: 4 } },
    });
  });

  it("would have recorded a view module had one been imported", async () => {
    // The control: without it, a mock that never ran would pass the test above
    // whatever registration imported.
    await expect(import("./plugin/admin")).rejects.toThrow();
    expect(imported).toContain("./plugin/admin");
  });
});
