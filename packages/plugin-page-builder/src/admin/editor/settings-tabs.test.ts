// @vitest-environment jsdom
/**
 * Which Page settings tab shows a field a save refused, and how the field is
 * found and focused there.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  FIELDS_TAB,
  focusFieldIn,
  GENERAL_TAB,
  tabForField,
} from "./settings-tabs";

// What a field is scrolled into view with, which jsdom lacks.
Element.prototype.scrollIntoView ??= () => {};

const PAGE = {
  contentTab: FIELDS_TAB,
  placeTabs: ["nextlyhq-plugin-seo.page-builder-tab", "acme-reviews.tab"],
};

describe("the tab that shows a refused field", () => {
  it("puts the title and the slug on General", () => {
    expect(tabForField({ kind: "page" }, PAGE)).toBe(GENERAL_TAB);
  });

  it("puts the page's content on its content tab, or nowhere without one", () => {
    expect(tabForField({ kind: "content" }, PAGE)).toBe(FIELDS_TAB);
    expect(
      tabForField({ kind: "content" }, { ...PAGE, contentTab: GENERAL_TAB })
    ).toBe(GENERAL_TAB);
    expect(
      tabForField({ kind: "content" }, { ...PAGE, contentTab: null })
    ).toBeNull();
  });

  it("puts a field a plugin's entry tab takes on the same plugin's tab here", () => {
    expect(
      tabForField({ kind: "tab", id: "nextlyhq-plugin-seo.tab" }, PAGE)
    ).toBe("nextlyhq-plugin-seo.page-builder-tab");
    // A plugin that adds no tab here: the field is not shown in the dialog.
    expect(tabForField({ kind: "tab", id: "acme-other.tab" }, PAGE)).toBeNull();
  });

  it("answers nowhere for a field the entry page draws nowhere", () => {
    expect(tabForField(null, PAGE)).toBeNull();
  });
});

describe("focusing the field on its tab", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses the control inside the form's wrapper for the path", () => {
    document.body.innerHTML = `
      <div id="tab">
        <div data-field="seo.title"><label>Meta title<input id="meta"></label></div>
      </div>`;
    const tab = document.getElementById("tab")!;
    expect(focusFieldIn(tab, "seo.title")).toBe(true);
    expect(document.activeElement?.id).toBe("meta");
  });

  it("falls back to the input named by the path, and says when nothing took it", () => {
    document.body.innerHTML = `<div id="tab"><input name="summary" id="s"></div>`;
    const tab = document.getElementById("tab")!;
    expect(focusFieldIn(tab, "summary")).toBe(true);
    expect(document.activeElement?.id).toBe("s");
    expect(focusFieldIn(tab, "missing")).toBe(false);
  });
});
