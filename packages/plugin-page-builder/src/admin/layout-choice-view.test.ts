/**
 * Every state the page's Layout picker can be in, in the words it says.
 */
import { describe, expect, it } from "vitest";

import type {
  LayoutChoice,
  LayoutChoicesResponse,
} from "../layout-choices-contract";

import {
  layoutPickerView,
  layoutValue,
  NO_HEADER_FOOTER_VALUE,
  SITE_DEFAULT_VALUE,
  storedFor,
  type LayoutChoicesState,
} from "./layout-choice-view";

const main: LayoutChoice = {
  id: "main",
  title: "Main",
  published: true,
  draftChangesNotLive: false,
  regions: [{ area: "header", componentId: "h" }],
  isEmpty: false,
};
const landing: LayoutChoice = {
  id: "landing",
  title: "Landing",
  published: true,
  draftChangesNotLive: true,
  regions: [{ area: "footer", componentId: "f" }],
  isEmpty: false,
};
// Unpublished, so it lists no regions, but its own areas name a header.
const unfinished: LayoutChoice = {
  id: "unfinished",
  title: "Unfinished",
  published: false,
  draftChangesNotLive: false,
  regions: [],
  isEmpty: false,
};
// Published with no header and no footer: what the site was seeded with.
const seed: LayoutChoice = {
  id: "seed",
  title: "Site layout",
  published: true,
  draftChangesNotLive: false,
  regions: [],
  isEmpty: true,
};
// Never published, and its own areas name nothing either.
const blank: LayoutChoice = {
  id: "blank",
  title: "Blank",
  published: false,
  draftChangesNotLive: false,
  regions: [],
  isEmpty: true,
};

function ready(
  overrides: Partial<LayoutChoicesResponse["meta"]> = {},
  items: readonly LayoutChoice[] = [main, unfinished, landing]
): LayoutChoicesState {
  return {
    kind: "ready",
    choices: {
      items,
      meta: {
        defaultLayout: "main",
        layoutsCollection: "layouts",
        canUpdateLayouts: true,
        more: false,
        matched: [],
        defaultUnreadable: false,
        regionComponents: {},
        regionDefinitions: {},
        ...overrides,
      },
    },
  };
}

const page = (layout: unknown = null, noHeaderFooter = false) => ({
  layout,
  noHeaderFooter,
});

describe("the page's Layout picker", () => {
  it("offers the site default by name, the other published sets, unpublished ones marked, then none", () => {
    expect(layoutPickerView(page(), ready()).options).toEqual([
      {
        value: SITE_DEFAULT_VALUE,
        label: "Site default (Main)",
        note: "Follows the site if the default changes",
      },
      // Main is the default, so it is offered once, as the site default.
      { value: layoutValue("landing"), label: "Landing" },
      {
        value: layoutValue("unfinished"),
        label: "Unfinished (not published: the site default shows until it is)",
      },
      { value: NO_HEADER_FOOTER_VALUE, label: "No header or footer" },
    ]);
  });

  it("offers no set that holds no header and no footer, published or not", () => {
    // Choosing one would be the same as "No header or footer", under a name
    // that hides it, and a page that chose it would stay blank when the
    // site default changes.
    const values = layoutPickerView(
      page(),
      ready({}, [main, seed, unfinished, blank, landing])
    ).options.map(option => option.value);
    expect(values).not.toContain(layoutValue("seed"));
    expect(values).not.toContain(layoutValue("blank"));
    expect(values).toEqual([
      SITE_DEFAULT_VALUE,
      layoutValue("landing"),
      layoutValue("unfinished"),
      NO_HEADER_FOOTER_VALUE,
    ]);
  });

  it("keeps an empty set the page already names, shown and selected", () => {
    for (const named of [seed, blank]) {
      const view = layoutPickerView(
        page(named.id),
        ready({}, [main, seed, blank, landing])
      );
      expect(view.value).toBe(layoutValue(named.id));
      expect(view.options.map(option => option.value)).toContain(
        layoutValue(named.id)
      );
      // Only the page's own: the other empty set is still not offered.
      const other = named === seed ? blank : seed;
      expect(view.options.map(option => option.value)).not.toContain(
        layoutValue(other.id)
      );
    }
  });

  it("keeps the default set the page names directly, shown and selected by its own name", () => {
    const view = layoutPickerView(page("main"), ready());
    expect(view.value).toBe(layoutValue("main"));
    expect(view.options).toContainEqual({
      value: layoutValue("main"),
      label: "Main",
    });
    // And the site default is still offered beside it.
    expect(view.options[0]?.value).toBe(SITE_DEFAULT_VALUE);
  });

  it("does not list an unpublished default set by its own name either", () => {
    const view = layoutPickerView(
      page(),
      ready({ defaultLayout: "unfinished" })
    );
    expect(view.options[0]?.label).toBe("Site default (none set)");
    expect(view.options.map(option => option.value)).not.toContain(
      layoutValue("unfinished")
    );
  });

  it("names the default in effect for a page naming nothing", () => {
    const view = layoutPickerView(page(), ready());
    expect(view.value).toBe(SITE_DEFAULT_VALUE);
    expect(view.why).toBe(
      "Follows the site default, Main, because this page doesn't choose its own header & footer set."
    );
    expect(view.effective?.id).toBe("main");
  });

  it("names the page's own Layout when it names a published one", () => {
    const view = layoutPickerView(page("landing"), ready());
    expect(view.value).toBe(layoutValue("landing"));
    expect(view.why).toBe("Landing");
    expect(view.effective?.regions).toEqual(landing.regions);
  });

  it("says the default shows for a page naming an unpublished Layout", () => {
    const view = layoutPickerView(page({ id: "unfinished" }), ready());
    expect(view.value).toBe(layoutValue("unfinished"));
    expect(view.why).toBe(
      "Unfinished (not published, so the site default shows)"
    );
    expect(view.effective?.id).toBe("main");
  });

  it("names a Layout the answer does not hold as one they can't view or that was deleted", () => {
    // Hidden from this author by a row rule, or gone: the answer cannot tell
    // which, and the picker says both rather than guessing.
    const view = layoutPickerView(page("unknown"), ready());
    expect(view.value).toBe(layoutValue("unknown"));
    expect(view.options.find(o => o.value === view.value)?.label).toBe(
      "A header & footer set you can't view, or one that was deleted"
    );
    expect(view.options[0]).toMatchObject({ label: "Site default (Main)" });
    expect(view.why).toBe(
      "You can't see this header & footer set. It may have been deleted, or you may not have access to it. Choose another header & footer set to change it."
    );
    // Nothing of it is drawn.
    expect(view.effective).toBeNull();
  });

  it("says the default shows for an unpublished Layout, even when the default is one the author cannot read", () => {
    const view = layoutPickerView(
      page({ id: "unfinished" }),
      ready({ defaultLayout: null, defaultUnreadable: true })
    );
    expect(view.why).toBe(
      "Unfinished (not published, so the site default shows)"
    );
  });

  it("says a default is set without naming one the author cannot read", () => {
    const view = layoutPickerView(
      page(),
      ready({ defaultLayout: null, defaultUnreadable: true })
    );
    expect(view.options[0]?.label).toBe(
      "Site default (a header & footer set you can't view, or one that was deleted)"
    );
    expect(view.why).toBe(
      "Follows the site default: a header & footer set you can't view, or one that was deleted."
    );
    expect(view.effective).toBeNull();
  });

  it("draws a page inside its own Layout when the route added it past the list's bound", () => {
    // The route lists Layouts by title up to a bound, then the page's own
    // Layout when the bound cut it: the last row here, out of title order.
    const past: LayoutChoice = { ...landing, id: "zz", title: "Zebra" };
    const view = layoutPickerView(
      page("zz"),
      ready({}, [main, unfinished, landing, past])
    );
    expect(view.value).toBe("layout:zz");
    expect(view.why).toBe("Zebra");
    expect(view.effective?.id).toBe("zz");
  });

  it("draws nothing for a page with no header or footer, whatever it names", () => {
    const view = layoutPickerView(page("landing", true), ready());
    expect(view.value).toBe(NO_HEADER_FOOTER_VALUE);
    expect(view.why).toBe("No header or footer");
    expect(view.effective).toBeNull();
  });

  it("says no header or footer shows for an unpublished Layout when the site has no usable default", () => {
    // No default set, or one that is not published: the page falls back to
    // nothing, so neither the option nor the line may promise a default.
    for (const meta of [
      { defaultLayout: null },
      { defaultLayout: "unfinished" },
    ]) {
      const view = layoutPickerView(page({ id: "unfinished" }), ready(meta));
      expect(
        view.options.find(o => o.value === layoutValue("unfinished"))?.label
      ).toBe(
        "Unfinished (not published: no header or footer shows until it is)"
      );
      expect(view.why).toBe(
        "Unfinished (not published, so no header or footer shows)"
      );
      expect(view.effective).toBeNull();
    }
  });

  it("says the site default shows for an unpublished option when one is usable", () => {
    const view = layoutPickerView(page(), ready());
    expect(
      view.options.find(o => o.value === layoutValue("unfinished"))?.label
    ).toBe("Unfinished (not published: the site default shows until it is)");
  });

  it("says when the site has no published default", () => {
    const view = layoutPickerView(page(), ready({ defaultLayout: null }));
    expect(view.options[0]?.label).toBe("Site default (none set)");
    expect(view.why).toBe(
      "No header or footer: the site has no published default header & footer set"
    );
    expect(view.effective).toBeNull();
  });

  it("is read-only without the right to read Layouts, naming what it can", () => {
    const named = layoutPickerView(page("landing"), { kind: "forbidden" });
    expect(named.readOnly).toBe(true);
    expect(named.why).toBe("A header & footer set you can't view");
    expect(named.options.find(o => o.value === named.value)?.label).toBe(
      "A header & footer set you can't view"
    );
    expect(layoutPickerView(page(), { kind: "forbidden" }).why).toBe(
      "Site default"
    );
  });

  it("says nothing it does not know while loading", () => {
    const view = layoutPickerView(page("landing"), { kind: "pending" });
    expect(view.readOnly).toBe(false);
    expect(view.why).toBe("");
    expect(view.effective).toBeNull();
    // Not yet refused: the stored Layout is not called one the author can't view.
    expect(view.options.find(o => o.value === view.value)?.label).toBe(
      "The chosen header & footer set"
    );
  });
});

describe("what the picker writes", () => {
  it("writes both values together", () => {
    const current = page("landing", true);
    expect(storedFor(layoutValue("main"), current)).toEqual({
      layout: "main",
      noHeaderFooter: false,
    });
    expect(storedFor(SITE_DEFAULT_VALUE, current)).toEqual({
      layout: null,
      noHeaderFooter: false,
    });
    // The switch outranks the named Layout while it is on, so the name stays.
    expect(storedFor(NO_HEADER_FOOTER_VALUE, page("landing"))).toEqual({
      layout: "landing",
      noHeaderFooter: true,
    });
  });
});

describe("a Layout behind Remove Layout's fence", () => {
  const removing: LayoutChoice = { ...landing, removal: "removing" };
  const takenDown: LayoutChoice = {
    ...unfinished,
    removal: "unpublished",
  };

  it("is offered no longer, by its name and a short reason, with the whole reason as its description", () => {
    const view = layoutPickerView(
      page(),
      ready({}, [main, removing, takenDown])
    );
    expect(view.options).toContainEqual({
      value: layoutValue("landing"),
      label: "Landing",
      note: "Being removed",
      description:
        "This header & footer set is being removed, so pages can't choose it. Choose another header & footer set.",
      disabled: true,
    });
    expect(view.options).toContainEqual({
      value: layoutValue("unfinished"),
      label: "Unfinished",
      note: "Unpublished. Publish it again to choose it.",
      description:
        "This header & footer set was unpublished with Remove header & footer set, so pages can't choose it until it is published again. Choose another header & footer set.",
      disabled: true,
    });
  });

  it("stays the page's own choice when the page already names it", () => {
    const view = layoutPickerView(page("landing"), ready({}, [main, removing]));
    expect(
      view.options.find(option => option.value === layoutValue("landing"))
        ?.disabled
    ).toBe(false);
  });
});
