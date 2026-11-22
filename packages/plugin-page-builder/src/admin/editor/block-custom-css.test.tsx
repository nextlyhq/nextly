// @vitest-environment jsdom

/**
 * The editor's access to a block's own custom CSS: lent only once the site
 * settings read answers that this person may change the site, never while
 * it is pending or failed; and its check is the page builder's real checker,
 * naming each refused line as the site's CSS boxes do.
 *
 * @module block-custom-css.test
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SITE_SETTINGS_ROUTE_PATH } from "../../library-contract";

import { useBlockCustomCss } from "./block-custom-css";

/** What the site settings read answers in the case running. */
let answer: { data: unknown; error: unknown } = {
  data: undefined,
  error: null,
};
const reads: { plugin: string; path: string }[] = [];

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (read: { plugin: string; path: string }) => {
    reads.push(read);
    return {
      ...answer,
      pending: answer.data === undefined && answer.error === null,
      fetching: false,
      refetch: () => {},
    };
  },
}));

afterEach(() => {
  answer = { data: undefined, error: null };
  reads.length = 0;
});

const access = () => renderHook(() => useBlockCustomCss()).result.current;

describe("the access to a block's custom CSS", () => {
  it("is asked of the site settings read", () => {
    access();
    expect(reads.map(read => read.path)).toEqual([SITE_SETTINGS_ROUTE_PATH]);
  });

  it.each([
    ["while the read is pending", { data: undefined, error: null }],
    ["when the read failed", { data: undefined, error: new Error("offline") }],
    [
      "for a person who may not change the site",
      { data: { mayManageSite: false }, error: null },
    ],
  ])("is not lent %s", (_case, read) => {
    answer = read;
    expect(access()).toBeUndefined();
  });

  it("is lent to a person who may change the site", () => {
    answer = { data: { mayManageSite: true }, error: null };
    expect(access()).toBeDefined();
  });
});

describe("its check, the page builder's own", () => {
  const check = (css: string): readonly string[] => {
    answer = { data: { mayManageSite: true }, error: null };
    const lent = access();
    if (lent === undefined) throw new Error("no access lent");
    return lent.check(css);
  };

  it("accepts a rule that starts from selector", () => {
    expect(check("selector {\n  padding: 4px;\n}")).toEqual([]);
  });

  it("names a rule without selector by its line", () => {
    const refused = check("selector { padding: 4px; }\nh2 { margin: 0; }");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(/^Line 2: /);
  });

  it("names an @import by its line", () => {
    const refused = check(
      "selector {\n  padding: 4px;\n}\n@import url(/more.css);"
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(/^Line 4: .*@import/);
  });

  it("names a url() to another site by its line", () => {
    const refused = check(
      "selector {\n  background: url(https://elsewhere.test/a.png);\n}"
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(/^Line 2: /);
  });
});
