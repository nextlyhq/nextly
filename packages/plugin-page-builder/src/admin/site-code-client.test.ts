/**
 * The site CSS calls the CSS box makes: the read it opens with, and the save,
 * which names the hash of the CSS it was made from.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  readPluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => sdk);

const { readSiteCss, saveSiteCss } = await import("./site-code-client");
const { PAGE_BUILDER_PLUGIN_NAME } = await import("../library-contract");
const { SITE_CSS_ROUTE_PATH } = await import("../site-css-contract");

beforeEach(() => {
  sdk.readPluginRoute.mockReset();
  sdk.writePluginRoute.mockReset();
});

describe("the site CSS calls", () => {
  it("reads the CSS with its hash and who changed it last", async () => {
    const read = {
      css: "a{}",
      sha256: "f".repeat(64),
      changedAt: "2026-11-18T06:00:00.000Z",
      changedBy: "Ada",
    };
    sdk.readPluginRoute.mockResolvedValue(read);
    expect(await readSiteCss()).toEqual(read);
    expect(sdk.readPluginRoute).toHaveBeenCalledWith({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_CSS_ROUTE_PATH,
    });
  });

  it("refuses a read the site did not answer", async () => {
    sdk.readPluginRoute.mockResolvedValue(undefined);
    await expect(readSiteCss()).rejects.toThrow("The site did not answer.");
  });

  it("refuses an answer that isn't the site's CSS, rather than drawing it", async () => {
    sdk.readPluginRoute.mockResolvedValue({ items: [] });
    await expect(readSiteCss()).rejects.toThrow("The site did not answer.");
    sdk.readPluginRoute.mockResolvedValue({ css: 1, sha256: "f".repeat(64) });
    await expect(readSiteCss()).rejects.toThrow("The site did not answer.");
  });

  it("saves the CSS naming the hash it was read at", async () => {
    sdk.writePluginRoute.mockResolvedValue({
      message: "saved",
      item: { sha256: "a".repeat(64) },
    });
    expect(await saveSiteCss("a{}", "f".repeat(64))).toEqual({
      sha256: "a".repeat(64),
    });
    expect(sdk.writePluginRoute).toHaveBeenCalledWith({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SITE_CSS_ROUTE_PATH,
      body: { css: "a{}", sha256: "f".repeat(64) },
    });
  });
});
