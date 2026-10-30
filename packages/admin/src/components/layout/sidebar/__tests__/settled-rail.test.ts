import { describe, expect, it } from "vitest";

import {
  railAnswersIn,
  railAnswersPending,
  railEntryDecided,
  settledRailItems,
} from "../lib/settled-rail";
import { MAIN_MENU_ITEMS, type MainMenuItem } from "../sidebar-types";

const ANSWERED = { workspace: false, permissions: false, content: false };

const entry = (
  id: string,
  requiredPermission?: string | string[]
): MainMenuItem =>
  ({
    id,
    label: id,
    icon: () => null,
    href: "#",
    requiredPermission,
  }) as MainMenuItem;

const ids = (items: readonly MainMenuItem[]) => items.map(item => item.id);

const everyShown = () => true;

describe("railEntryDecided", () => {
  it("waits on the content answer for Content", () => {
    expect(
      railEntryDecided(entry("content"), { ...ANSWERED, content: true })
    ).toBe(false);
    expect(
      railEntryDecided(entry("content"), { ...ANSWERED, permissions: true })
    ).toBe(true);
  });

  it("waits on both permissions and content for Plugins", () => {
    expect(
      railEntryDecided(entry("plugins"), { ...ANSWERED, permissions: true })
    ).toBe(false);
    expect(
      railEntryDecided(entry("plugins"), { ...ANSWERED, content: true })
    ).toBe(false);
    expect(railEntryDecided(entry("plugins"), ANSWERED)).toBe(true);
  });

  it("waits on the permissions for Media, Settings and any gated entry", () => {
    const pending = { ...ANSWERED, permissions: true };
    expect(railEntryDecided(entry("media"), pending)).toBe(false);
    expect(railEntryDecided(entry("settings"), pending)).toBe(false);
    expect(railEntryDecided(entry("releases", ["read-x"]), pending)).toBe(
      false
    );
  });

  it("waits on the workspace answer for Builders", () => {
    expect(
      railEntryDecided(entry("builders"), { ...ANSWERED, workspace: true })
    ).toBe(false);
  });

  it("waits on every answer for a plugin's own entry", () => {
    for (const answer of ["workspace", "permissions", "content"] as const) {
      expect(
        railEntryDecided(entry("standalone-acme"), {
          ...ANSWERED,
          [answer]: true,
        })
      ).toBe(false);
    }
  });

  it("decides an ungated entry at once", () => {
    const pending = { workspace: true, permissions: true, content: true };
    expect(railEntryDecided(entry("dashboard"), pending)).toBe(true);
    expect(railEntryDecided(entry("translations"), pending)).toBe(true);
  });
});

describe("settledRailItems", () => {
  const rail = [
    entry("dashboard"),
    entry("content"),
    entry("media"),
    entry("translations"),
    entry("plugins"),
    entry("settings"),
  ];

  it("draws every shown entry once every answer is in", () => {
    expect(ids(settledRailItems(rail, everyShown, ANSWERED))).toEqual(
      ids(rail)
    );
  });

  it("leaves out the entries the visibility rule hides", () => {
    const hidden = new Set(["media", "plugins"]);
    expect(
      ids(settledRailItems(rail, item => !hidden.has(item.id), ANSWERED))
    ).toEqual(["dashboard", "content", "translations", "settings"]);
  });

  /*
   * The property that matters: an entry still waiting is NOT drawn, and nothing after it is
   * either, even entries already decided, since the waiting one may yet land above them. A rail
   * drawing every decided entry would draw Translations here, and push it down when Media came.
   */
  it("stops at the first entry still waiting on an answer", () => {
    expect(
      ids(
        settledRailItems(rail, everyShown, { ...ANSWERED, permissions: true })
      )
    ).toEqual(["dashboard", "content"]);
    expect(
      ids(settledRailItems(rail, everyShown, { ...ANSWERED, content: true }))
    ).toEqual(["dashboard"]);
  });

  it("does not draw a waiting entry on a guess, whatever the visibility rule says", () => {
    const shownWhileLoading = (item: MainMenuItem) => item.id !== "content";
    expect(
      ids(
        settledRailItems(rail, shownWhileLoading, {
          ...ANSWERED,
          content: true,
        })
      )
    ).toEqual(["dashboard"]);
  });

  it("draws only the first entry while a plugin's entry may still be placed after any", () => {
    expect(
      ids(settledRailItems(rail, everyShown, { ...ANSWERED, workspace: true }))
    ).toEqual(["dashboard"]);
  });

  it("holds the entries after a plugin's entry until the plugin's access is known", () => {
    const withPlugin = [
      entry("dashboard"),
      entry("standalone-acme"),
      entry("content"),
    ];
    expect(
      ids(
        settledRailItems(withPlugin, everyShown, {
          ...ANSWERED,
          permissions: true,
        })
      )
    ).toEqual(["dashboard"]);
  });

  it("draws the product's rail whole once settled, in its order", () => {
    expect(
      ids(settledRailItems(MAIN_MENU_ITEMS, everyShown, ANSWERED))
    ).toEqual(ids(MAIN_MENU_ITEMS));
  });
});

describe("railAnswersIn", () => {
  it("is true only when no answer the rail waits on is pending", () => {
    expect(
      railAnswersIn({ workspace: false, permissions: false, content: false })
    ).toBe(true);
    for (const pending of [
      { workspace: true, permissions: false, content: false },
      { workspace: false, permissions: true, content: false },
      { workspace: false, permissions: false, content: true },
    ]) {
      expect(railAnswersIn(pending)).toBe(false);
    }
  });
});

describe("railAnswersPending", () => {
  const SETTLED = {
    workspacePending: false,
    hydrated: true,
    permissionsLoading: false,
    contentAnswerPending: false,
    collectionsLoading: false,
    singlesLoading: false,
  };

  it("reports nothing pending once every query has answered", () => {
    expect(railAnswersPending(SETTLED)).toEqual({
      workspace: false,
      permissions: false,
      content: false,
    });
  });

  it("holds the permissions until hydration, and the content until all three content reads", () => {
    expect(
      railAnswersPending({ ...SETTLED, hydrated: false }).permissions
    ).toBe(true);
    expect(
      railAnswersPending({ ...SETTLED, permissionsLoading: true }).permissions
    ).toBe(true);
    for (const read of [
      "contentAnswerPending",
      "collectionsLoading",
      "singlesLoading",
    ] as const) {
      expect(railAnswersPending({ ...SETTLED, [read]: true }).content).toBe(
        true
      );
    }
    expect(
      railAnswersPending({ ...SETTLED, workspacePending: true }).workspace
    ).toBe(true);
  });
});
