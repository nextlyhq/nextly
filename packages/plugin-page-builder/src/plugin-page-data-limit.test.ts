/**
 * The site's page data limit, `pageBuilder({ maxQueries })`, set once: the
 * editor is sent it in the admin's client config, which its page data meter
 * counts against, and the instance offers it to the page routes, which render
 * under it where they set no `maxQueries` of their own.
 *
 * @module plugin-page-data-limit.test
 */
import { SITE_PAGE_DATA_LIMIT_SERVICE } from "@nextlyhq/blocks-react";
import { describe, expect, it } from "vitest";

import { pageBuilder } from "./plugin";

/** What the editor in the browser is sent. */
function clientConfigOf(
  plugin: ReturnType<typeof pageBuilder>
): Record<string, unknown> {
  return (plugin.contributes?.admin?.clientConfig ?? {}) as Record<
    string,
    unknown
  >;
}

/** What the instance offers the routes under the limit's service name. */
function offeredTo(plugin: ReturnType<typeof pageBuilder>): unknown {
  const make = plugin.contributes?.services?.[
    SITE_PAGE_DATA_LIMIT_SERVICE.service
  ] as ((ctx: never) => unknown) | undefined;
  return make?.({} as never);
}

describe("the site's page data limit", () => {
  it("is sent to the editor and offered to the routes", () => {
    const plugin = pageBuilder({ maxQueries: 20 });
    expect(clientConfigOf(plugin).maxQueries).toBe(20);
    expect(offeredTo(plugin)).toEqual({ maxQueries: 20 });
  });

  it("is sent as null where the site sets no limit, as JSON carries it", () => {
    const plugin = pageBuilder({ maxQueries: Infinity });
    expect(clientConfigOf(plugin).maxQueries).toBeNull();
    expect(offeredTo(plugin)).toEqual({ maxQueries: Infinity });
  });

  it("is neither sent nor offered where unset, so both take the default", () => {
    const plugin = pageBuilder();
    expect(clientConfigOf(plugin)).not.toHaveProperty("maxQueries");
    expect(offeredTo(plugin)).toBeUndefined();
  });

  it.each([-1, 2.5, Number.NaN])("refuses %s at boot", limit => {
    expect(() => pageBuilder({ maxQueries: limit })).toThrow(
      /`maxQueries` is how many reads a page may make/
    );
  });
});
