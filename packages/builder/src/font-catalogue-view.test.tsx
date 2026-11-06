// @vitest-environment jsdom

/**
 * The Google Fonts catalogue inside the Fonts tab: browsing it, its states,
 * and the editor that adds a family to the site.
 */
import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: toasts,
}));

import {
  FontCatalogueView,
  type CatalogueAddRequest,
  type CatalogueFamilyView,
  type FontCatalogue,
} from "./font-catalogue-view";
import { siteFamilies } from "./font-library";

const INTER: CatalogueFamilyView = {
  id: "inter",
  family: "Inter",
  category: "sans-serif",
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  styles: ["normal", "italic"],
  subsets: ["latin"],
  defSubset: "latin",
  variable: true,
  licence: "OFL-1.1",
};
const LORA: CatalogueFamilyView = {
  id: "lora",
  family: "Lora",
  category: "serif",
  weights: [400, 500, 700],
  styles: ["normal", "italic"],
  subsets: ["cyrillic", "latin", "latin-ext"],
  defSubset: "latin",
  variable: false,
  licence: "OFL-1.1",
};
const MANY: CatalogueFamilyView[] = Array.from({ length: 33 }, (_, index) => ({
  ...LORA,
  id: `family-${String(index)}`,
  family: `Family ${String(index).padStart(2, "0")}`,
}));

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
  );
  toasts.success.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function catalogue(
  over: Partial<FontCatalogue> = {},
  families: CatalogueFamilyView[] = [INTER, LORA]
): FontCatalogue {
  return {
    load: async () => ({ families }),
    previewUrl: family => `https://cdn.example/${family.id}.woff2`,
    add: async () => undefined,
    ...over,
  };
}

function view(
  source: FontCatalogue,
  props: {
    onBack?: () => void;
    onSite?: FontFaceDef[];
    initialQuery?: string;
  } = {}
): ReturnType<typeof render> {
  return render(
    <FontCatalogueView
      catalogue={source}
      onBack={props.onBack ?? (() => undefined)}
      onSite={siteFamilies(props.onSite ?? [], [])}
      initialQuery={props.initialQuery}
    />
  );
}

const row = (name: RegExp) => screen.findByRole("button", { name });

async function openAdd(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(await row(name));
  return screen.findByRole("dialog");
}

describe("the catalogue's states", () => {
  it("says it is loading, with placeholder rows rather than a spinner", () => {
    const { container } = view(
      catalogue({ load: () => new Promise(() => undefined) })
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Loading Google Fonts…"
    );
    expect(container.querySelectorAll(".nx-fonts__skeleton")).toHaveLength(6);
  });

  it("says when it could not be reached, that the site's fonts still work, and tries again", async () => {
    let calls = 0;
    view(
      catalogue({
        load: async () => {
          calls += 1;
          if (calls === 1) throw new Error("offline");
          return { families: [LORA] };
        },
      })
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Google Fonts could not be reached. The fonts already on this site still work."
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await row(/^Lora/)).toBeTruthy();
  });

  it("goes back to the site's fonts from its back button and from Escape", async () => {
    const onBack = vi.fn();
    view(catalogue(), { onBack });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to this site’s fonts" })
    );
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(
      screen.getByRole("searchbox", { name: "Search Google Fonts" }),
      {
        key: "Escape",
      }
    );
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("starts in its search box, with the search it was opened for", async () => {
    view(catalogue(), { initialQuery: "lo" });
    const search = screen.getByRole("searchbox", {
      name: "Search Google Fonts",
    });
    expect(document.activeElement).toBe(search);
    expect((search as HTMLInputElement).value).toBe("lo");
    expect(await row(/^Lora/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Inter/ })).toBeNull();
  });
});

describe("browsing", () => {
  it("lists each family with its category, its styles and whether one file covers them", async () => {
    view(catalogue());
    const inter = await row(/^Inter/);
    expect(
      within(inter).getByText("Sans serif · 18 styles · Variable")
    ).toBeTruthy();
    expect(
      within(await row(/^Lora/)).getByText("Serif · 6 styles")
    ).toBeTruthy();
  });

  it("narrows from the first letter typed", async () => {
    view(catalogue());
    await row(/^Inter/);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search Google Fonts" }),
      {
        target: { value: "l" },
      }
    );
    expect(screen.queryByRole("button", { name: /^Inter/ })).toBeNull();
    expect(await row(/^Lora/)).toBeTruthy();
  });

  it("filters by category", async () => {
    view(catalogue());
    await row(/^Inter/);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Category/ }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Serif" })
    );
    expect(screen.queryByRole("button", { name: /^Inter/ })).toBeNull();
    expect(await row(/^Lora/)).toBeTruthy();
  });

  it("draws the preview text in place of each name", async () => {
    view(catalogue());
    await row(/^Inter/);
    fireEvent.change(screen.getByRole("textbox", { name: "Preview text" }), {
      target: { value: "Hamburgefonstiv" },
    });
    expect(screen.getAllByText("Hamburgefonstiv")).toHaveLength(2);
    // With the name drawn over, and when a long name is cut, it is still
    // there whole on hover.
    expect(
      within(await row(/^Inter/))
        .getByText("Hamburgefonstiv")
        .getAttribute("title")
    ).toBe("Inter");
  });

  it("shows thirty at a time", async () => {
    view(catalogue({}, MANY));
    await row(/^Family 00/);
    expect(
      screen.getAllByRole("button", { name: /^Family \d\d/ })
    ).toHaveLength(30);
    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(
      screen.getAllByRole("button", { name: /^Family \d\d/ })
    ).toHaveLength(33);
  });

  it("says when nothing matches", async () => {
    view(catalogue());
    await row(/^Inter/);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search Google Fonts" }),
      {
        target: { value: "zzz" },
      }
    );
    expect(screen.getByText("No Google Fonts match this search.")).toBeTruthy();
  });

  it("marks a family the site already has", async () => {
    view(catalogue(), {
      onSite: [
        { family: "Lora", src: [{ url: "/api/media/m/raw" }], weight: "400" },
      ],
    });
    expect(within(await row(/^Lora/)).getByText("Added")).toBeTruthy();
  });

  it("says where previews come from, and where added fonts go", () => {
    view(catalogue());
    expect(
      screen.getByText(
        "Previews load from Fontsource while you browse. Fonts you add are stored on your site."
      )
    ).toBeTruthy();
  });
});

describe("ordering", () => {
  /** The families' names, top to bottom, as the list shows them. */
  const order = (): string[] =>
    [...document.querySelectorAll<HTMLElement>("[data-catalogue-family]")].map(
      each => each.dataset.catalogueFamily ?? ""
    );

  const ABEL: CatalogueFamilyView = { ...LORA, id: "abel", family: "Abel" };
  const ranked = [
    { ...ABEL, popularity: 10 },
    { ...INTER, popularity: 900 },
    { ...LORA, popularity: 300 },
    { ...LORA, id: "zilla", family: "Zilla Slab", popularity: 300 },
  ];

  it("puts the most used families first, and names in order among equals", async () => {
    view(catalogue({}, ranked));
    await row(/^Inter/);
    expect(
      screen.getByRole("button", { name: "Sort, Popular first" })
    ).toBeTruthy();
    expect(order()).toEqual(["inter", "lora", "zilla", "abel"]);
  });

  it("orders by name when A to Z is chosen", async () => {
    view(catalogue({}, ranked));
    await row(/^Inter/);
    fireEvent.keyDown(screen.getByRole("button", { name: /^Sort/ }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "A–Z" }));
    expect(order()).toEqual(["abel", "inter", "lora", "zilla"]);
    expect(screen.getByRole("button", { name: "Sort, A–Z" })).toBeTruthy();
  });

  it("orders by name, and offers no sort, when the catalogue says nothing of popularity", async () => {
    view(catalogue({}, [LORA, INTER, ABEL]));
    await row(/^Inter/);
    expect(order()).toEqual(["abel", "inter", "lora"]);
    expect(screen.queryByRole("button", { name: /^Sort/ })).toBeNull();
  });
});

describe("adding a family", () => {
  it("starts a static family on Regular and Bold, its own script, and no italics", async () => {
    view(catalogue());
    const editor = await openAdd(/^Lora/);
    const box = (name: string) =>
      within(editor).getByRole("checkbox", { name });
    expect(box("Regular 400").getAttribute("aria-checked")).toBe("true");
    expect(box("Medium 500").getAttribute("aria-checked")).toBe("false");
    expect(box("Bold 700").getAttribute("aria-checked")).toBe("true");
    expect(box("Include italics").getAttribute("aria-checked")).toBe("false");
    expect(box("Latin").getAttribute("aria-checked")).toBe("true");
    expect(box("Latin Extended").getAttribute("aria-checked")).toBe("false");
    expect(box("Cyrillic").getAttribute("aria-checked")).toBe("false");
    expect(within(editor).getByText("Fewer styles load faster.")).toBeTruthy();
    expect(within(editor).getByText("SIL Open Font License")).toBeTruthy();
    expect(
      within(editor).getByRole("button", { name: "Add Lora · 2 styles" })
    ).toBeTruthy();
  });

  it("counts every weight with its italic, and adds nothing with no weight", async () => {
    view(catalogue());
    const editor = await openAdd(/^Lora/);
    fireEvent.click(
      within(editor).getByRole("checkbox", { name: "Include italics" })
    );
    expect(
      within(editor).getByRole("button", { name: "Add Lora · 4 styles" })
    ).toBeTruthy();
    fireEvent.click(
      within(editor).getByRole("checkbox", { name: "Regular 400" })
    );
    fireEvent.click(within(editor).getByRole("checkbox", { name: "Bold 700" }));
    const add = within(editor).getByRole("button", { name: "Add Lora" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers a variable family as one file per style, not a grid of weights", async () => {
    view(catalogue());
    const editor = await openAdd(/^Inter/);
    expect(
      within(editor).getByText("Every weight from 100 to 900, in one file.")
    ).toBeTruthy();
    expect(
      within(editor).queryByRole("checkbox", { name: "Regular 400" })
    ).toBeNull();
    expect(
      within(editor).getByRole("button", { name: "Add Inter · 1 style" })
    ).toBeTruthy();
  });

  it("names a family, its weights, styles and scripts, never an address", async () => {
    const add = vi.fn(async (_request: CatalogueAddRequest) => undefined);
    view(catalogue({ add }));
    const editor = await openAdd(/^Lora/);
    fireEvent.click(
      within(editor).getByRole("checkbox", { name: "Latin Extended" })
    );
    await act(async () => {
      fireEvent.click(
        within(editor).getByRole("button", { name: /^Add Lora/ })
      );
    });
    expect(add).toHaveBeenCalledWith({
      id: "lora",
      weights: [400, 700],
      styles: ["normal"],
      subsets: ["latin", "latin-ext"],
    });
  });

  it("says it is downloading while the site stores the files, with every control held", async () => {
    view(catalogue({ add: () => new Promise(() => undefined) }));
    const editor = await openAdd(/^Inter/);
    await act(async () => {
      fireEvent.click(
        within(editor).getByRole("button", { name: /^Add Inter/ })
      );
    });
    const busy = within(editor).getByRole("button", { name: /Adding Inter/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        within(editor).getByRole("checkbox", {
          name: "Include italics",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      within(editor).getByText("Downloading Inter to your site…")
    ).toBeTruthy();
  });

  it("says why an add was refused, and gives the button back", async () => {
    view(
      catalogue({
        add: async () =>
          "Google Fonts didn’t answer in time. Nothing was added; try again.",
      })
    );
    const editor = await openAdd(/^Inter/);
    await act(async () => {
      fireEvent.click(
        within(editor).getByRole("button", { name: /^Add Inter/ })
      );
    });
    expect(within(editor).getByRole("alert").textContent).toContain(
      "didn’t answer in time"
    );
    expect(
      within(editor).getByRole("button", { name: "Add Inter · 1 style" })
    ).toBeTruthy();
  });

  it("closes once added, and says the font is on the site", async () => {
    view(catalogue());
    const editor = await openAdd(/^Inter/);
    await act(async () => {
      fireEvent.click(
        within(editor).getByRole("button", { name: /^Add Inter/ })
      );
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toasts.success).toHaveBeenCalledWith("Inter is now on this site.");
  });

  it("holds the styles a family already has, and counts only the new ones", async () => {
    view(catalogue(), {
      onSite: [
        {
          family: "Lora",
          src: [{ url: "/api/media/m/raw" }],
          weight: "400",
          style: "normal",
          source: { kind: "google", id: "lora", subset: "latin" },
        },
      ],
    });
    const editor = await openAdd(/^Lora/);
    const regular = within(editor).getByRole("checkbox", {
      name: "Regular 400",
    });
    expect(regular.getAttribute("aria-checked")).toBe("true");
    expect((regular as HTMLButtonElement).disabled).toBe(true);
    expect(
      within(editor).getByRole("button", { name: "Add 1 more style" })
    ).toBeTruthy();
    fireEvent.click(within(editor).getByRole("checkbox", { name: "Bold 700" }));
    expect(
      within(editor).getByRole("button", { name: "Already on this site" })
    ).toBeTruthy();
  });

  it("does not take an uploaded cut, which names no script, for a catalogue file", async () => {
    view(catalogue(), {
      onSite: [
        {
          family: "Lora",
          src: [{ url: "/api/media/upload/raw" }],
          weight: "400",
          style: "normal",
          source: { kind: "upload" },
        },
      ],
    });
    const editor = await openAdd(/^Lora/);
    // The server adds the catalogue's Latin 400 beside the upload, so the
    // editor offers it rather than holding it.
    const regular = within(editor).getByRole("checkbox", {
      name: "Regular 400",
    });
    expect((regular as HTMLButtonElement).disabled).toBe(false);
    expect(
      within(editor).getByRole("button", { name: "Add 2 more styles" })
    ).toBeTruthy();
  });

  it("adds a cut the site has in one script in another", async () => {
    const add = vi.fn(async (_request: CatalogueAddRequest) => undefined);
    const latin = (weight: string): FontFaceDef => ({
      family: "Lora",
      src: [{ url: `/api/media/${weight}/raw` }],
      weight,
      style: "normal",
      source: { kind: "google", id: "lora", subset: "latin" },
    });
    view(catalogue({ add }), { onSite: [latin("400"), latin("700")] });
    const editor = await openAdd(/^Lora/);
    expect(
      within(editor).getByRole("button", { name: "Already on this site" })
    ).toBeTruthy();
    fireEvent.click(within(editor).getByRole("checkbox", { name: "Cyrillic" }));
    const more = within(editor).getByRole("button", {
      name: "Add 2 more styles",
    });
    await act(async () => {
      fireEvent.click(more);
    });
    expect(add).toHaveBeenCalledWith({
      id: "lora",
      weights: [400, 700],
      styles: ["normal"],
      subsets: ["cyrillic", "latin"],
    });
  });

  it("does not take an uploaded static cut for the variable file", async () => {
    view(catalogue(), {
      onSite: [
        {
          family: "Inter",
          src: [{ url: "/api/media/inter-400/raw" }],
          weight: "400",
          style: "normal",
          source: { kind: "upload" },
        },
      ],
    });
    const editor = await openAdd(/^Inter/);
    // The variable file covers 100 to 900, which the site doesn't have.
    expect(
      within(editor).getByRole("button", { name: "Add 1 more style" })
    ).toBeTruthy();
  });

  it("adds a family that comes only in italic", async () => {
    const add = vi.fn(async (_request: CatalogueAddRequest) => undefined);
    const molle: CatalogueFamilyView = {
      ...LORA,
      id: "molle",
      family: "Molle",
      category: "handwriting",
      weights: [400],
      styles: ["italic"],
      subsets: ["latin"],
    };
    const previewUrl = vi.fn(
      (family: CatalogueFamilyView) => `https://cdn.example/${family.id}.woff2`
    );
    view(catalogue({ add, previewUrl }, [molle]));
    const editor = await openAdd(/^Molle/);
    // Previewed from the file it has, not a regular it lacks.
    expect(previewUrl).toHaveBeenCalledWith(molle, 400, "italic");
    expect(previewUrl).not.toHaveBeenCalledWith(molle, 400, "normal");
    // Nothing to choose: its one style is the only one it has.
    expect(
      within(editor).queryByRole("checkbox", { name: "Include italics" })
    ).toBeNull();
    await act(async () => {
      fireEvent.click(
        within(editor).getByRole("button", { name: "Add Molle \u00b7 1 style" })
      );
    });
    expect(add).toHaveBeenCalledWith({
      id: "molle",
      weights: [400],
      styles: ["italic"],
      subsets: ["latin"],
    });
  });
});
