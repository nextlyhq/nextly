/**
 * The `canvasPath` option: a path on this site, carried to the editor.
 *
 * @module canvas-path.test
 */
import { describe, expect, it } from "vitest";

import { canvasPathOption } from "./canvas-path";
import { pageBuilder } from "./plugin";

/** The config the plugin publishes to the browser. */
function clientConfig(
  plugin: ReturnType<typeof pageBuilder>
): Record<string, unknown> | undefined {
  return (
    plugin.contributes as
      | { admin?: { clientConfig?: Record<string, unknown> } }
      | undefined
  )?.admin?.clientConfig;
}

describe("the canvas route's path", () => {
  it("takes a path on this site", () => {
    expect(canvasPathOption("/page-builder-canvas")).toBe(
      "/page-builder-canvas"
    );
    expect(canvasPathOption(undefined)).toBeUndefined();
  });

  it.each([
    ["a full URL", "https://example.com/canvas"],
    ["a protocol-relative URL", "//example.com/canvas"],
    ["a relative path", "canvas"],
    ["a backslash, which a browser reads as a slash", "/\\example.com"],
  ])("refuses %s, which names another origin or none", (_, path) => {
    expect(() => canvasPathOption(path)).toThrow(/canvasPath/);
  });

  it("takes a {locale} placeholder, for a site whose pages sit under their language", () => {
    expect(canvasPathOption("/{locale}/page-builder-canvas")).toBe(
      "/{locale}/page-builder-canvas"
    );
  });

  it("is refused when the plugin is configured, not when the editor opens", () => {
    expect(() => pageBuilder({ canvasPath: "https://example.com/c" })).toThrow(
      /canvasPath must be a path on this site/
    );
  });

  it("travels to the editor through the client config, and only when stated", () => {
    expect(
      clientConfig(pageBuilder({ canvasPath: "/page-builder-canvas" }))
        ?.canvasPath
    ).toBe("/page-builder-canvas");
    // Absent rather than defaulted: the plugin cannot add the route, so a
    // default would load a page that is not there.
    expect(clientConfig(pageBuilder({}))?.canvasPath).toBeUndefined();
  });
});
