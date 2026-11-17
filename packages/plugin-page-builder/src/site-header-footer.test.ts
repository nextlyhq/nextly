/**
 * The `siteHeaderFooter` option: who draws the site's header and footer,
 * checked where it is given.
 *
 * @module site-header-footer.test
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";
import { siteHeaderFooterOption } from "./site-header-footer";

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

describe("who draws the site's header and footer", () => {
  it("is the page builder when the site says nothing", () => {
    expect(siteHeaderFooterOption(undefined)).toBe("page-builder");
  });

  it("is either value the site names", () => {
    expect(siteHeaderFooterOption("page-builder")).toBe("page-builder");
    expect(siteHeaderFooterOption("code")).toBe("code");
  });

  it("refuses any other value at boot, naming the option and both values", () => {
    expect(() => siteHeaderFooterOption("cdoe")).toThrow(
      '[page-builder] siteHeaderFooter must be "page-builder" or "code" (got "cdoe")'
    );
    // A config written in JavaScript can pass anything.
    expect(() => siteHeaderFooterOption(true)).toThrow(/siteHeaderFooter/);
    expect(() => siteHeaderFooterOption("")).toThrow(/siteHeaderFooter/);
  });

  it("is refused when the plugin is configured, not when the editor opens", () => {
    expect(() =>
      pageBuilder({
        // A typo in a config written in JavaScript, which no type stops.
        siteHeaderFooter: "cdoe" as unknown as "code",
      })
    ).toThrow(/siteHeaderFooter must be "page-builder" or "code"/);
  });

  it("travels to the editor through the client config, and only when stated", () => {
    expect(
      clientConfig(pageBuilder({ siteHeaderFooter: "code" }))?.siteHeaderFooter
    ).toBe("code");
    expect(
      clientConfig(pageBuilder({ siteHeaderFooter: "page-builder" }))
        ?.siteHeaderFooter
    ).toBe("page-builder");
    // Absent when the site says nothing: the editor reads that as the default.
    expect(clientConfig(pageBuilder({}))?.siteHeaderFooter).toBeUndefined();
  });
});
