// @vitest-environment jsdom

/**
 * What the ⋯ menu's import and exports carry beyond the variables, as an
 * author meets it: the import preview naming the file's text styles and the
 * site's own design data, storing the text styles through the host's class
 * writer, the fonts the site lacks with "Add from Google Fonts", and the
 * Figma export naming the text styles it leaves to Figma.
 */
import {
  fluidValue,
  type FontFaceDef,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { Toaster } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { EditClasses } from "./block-style-actions";
import type { CatalogueFamilyView, FontCatalogue } from "./font-catalogue-view";
import { FontChoicesContext } from "./font-family-field";
import { exportDtcgWithTheme } from "./tokens-transfer";
import {
  useVariablesTransfer,
  type VariablesStored,
} from "./variables-transfer";

const MORE = "More design actions";

const eyebrow: NamedClass = {
  id: "ts-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 0,
  role: "text",
  styles: { base: { base: { fontSize: "0.75rem" } } },
};

const SOURCE: SiteTokenSet = {
  tokens: [
    {
      name: "font.body",
      kind: "fontFamily",
      values: { light: '"Brand Sans", sans-serif' },
    },
    {
      name: "font.heading",
      kind: "fontFamily",
      values: { light: "Inter, sans-serif" },
    },
    {
      name: "shadow.card",
      label: "Card shadow",
      kind: "shadow",
      values: { light: "0 1px 2px #000000" },
    },
  ],
  siteText: { body: { fontFamily: { $token: "font.body" } } },
  fluidRange: { min: 320, max: 1440 },
};

const INTER: CatalogueFamilyView = {
  id: "inter",
  family: "Inter",
  category: "sans-serif",
  weights: [300, 400, 700],
  styles: ["normal", "italic"],
  subsets: ["latin", "latin-ext"],
  defSubset: "latin",
  variable: false,
  licence: "OFL",
};

function Host({
  tokens,
  classes = [],
  onChange = () => undefined,
  onEditClasses,
  catalogue,
  storeNow = async () => true,
  meanwhile = tokens => tokens,
}: {
  tokens: SiteTokenSet;
  classes?: readonly NamedClass[];
  onChange?: (tokens: SiteTokenSet) => void;
  onEditClasses?: EditClasses;
  catalogue?: FontCatalogue;
  /** The host's write at once, answering what of it was stored. */
  storeNow?: (tokens: SiteTokenSet) => Promise<boolean | VariablesStored>;
  /** The variables as an edit made meanwhile leaves them, read as current. */
  meanwhile?: (tokens: SiteTokenSet) => SiteTokenSet;
}): React.JSX.Element {
  const latest = React.useRef(tokens);
  const transfer = useVariablesTransfer({
    onChange: next => {
      latest.current = next;
      onChange(next);
    },
    storeTokensNow: async next => {
      latest.current = next;
      return storeNow(next);
    },
    currentTokens: () => meanwhile(latest.current),
    readOnly: false,
    currentClasses: () => classes,
    ...(onEditClasses === undefined ? {} : { onEditClasses }),
    ...(catalogue === undefined ? {} : { catalogue }),
  });
  return (
    <>
      <div data-testid="header">{transfer.menu}</div>
      <div data-testid="panel">{transfer.overlays}</div>
      <Toaster />
    </>
  );
}

/** The Host inside the Design frame's fonts, as the editor mounts it. */
function WithFonts({
  faces = [],
  ...props
}: React.ComponentProps<typeof Host> & {
  faces?: readonly FontFaceDef[];
}): React.JSX.Element {
  return (
    <FontChoicesContext.Provider value={{ faces, fromCode: [] }}>
      <Host {...props} />
    </FontChoicesContext.Provider>
  );
}

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:variables",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
});

/** The design token file the source site exports. */
const exported = (): string =>
  exportDtcgWithTheme(SOURCE, [eyebrow])[0]?.text ?? "";

async function chooseFile(name: string, contents: string): Promise<void> {
  const file = new File([contents], name, { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contents),
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Choose variable files to import"), {
      target: { files: [file] },
    });
  });
}

describe("importing a file with text styles and the site's design data", () => {
  it("names them in the preview, then stores the text styles through the class writer", async () => {
    const onChange = vi.fn();
    const stored: NamedClass[][] = [];
    const onEditClasses = vi.fn<EditClasses>(async compose => {
      const made = compose([]);
      if ("classes" in made) stored.push([...made.classes]);
      return undefined;
    });
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        onEditClasses={onEditClasses}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    expect(within(preview).getByText(/1 text style/)).toBeDefined();
    const styles = within(preview).getByRole("heading", {
      name: "Text styles",
    });
    expect(styles.parentElement?.textContent).toContain("Eyebrow");
    const also = within(preview).getByRole("heading", {
      name: "Also in the file",
    });
    expect(also.parentElement?.textContent).toContain("Site text: Body");
    expect(also.parentElement?.textContent).toContain(
      "Fluid sizes grow from 320px to 1440px wide"
    );

    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    // The variables follow once the text styles are stored.
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const tokens = onChange.mock.calls[0]?.[0] as SiteTokenSet;
    expect(tokens.siteText).toEqual(SOURCE.siteText);
    expect(tokens.fluidRange).toEqual(SOURCE.fluidRange);
    await waitFor(() => expect(onEditClasses).toHaveBeenCalledTimes(1));
    expect(stored).toEqual([[eyebrow]]);
    expect(
      await screen.findByText("Imported 3 variables and 1 text style.")
    ).toBeDefined();
  });

  it("stores the variables, then the text styles that name them, then the Site text that follows them", async () => {
    // Three writes, each a step of the history. The site refuses a text
    // style naming a variable it doesn't hold, so the variables go first;
    // it refuses to remove a text style a row still follows, so the rows go
    // last and Undo takes them back first, then the text styles, then the
    // variables.
    const onChange = vi.fn();
    let stored: (done: boolean) => void = () => undefined;
    const storeNow = vi.fn(
      (_tokens: SiteTokenSet) =>
        new Promise<boolean>(resolve => {
          stored = resolve;
        })
    );
    let finish: (refusal: string | undefined) => void = () => undefined;
    const onEditClasses = vi.fn<EditClasses>(
      () =>
        new Promise<string | undefined>(resolve => {
          finish = resolve;
        })
    );
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        onEditClasses={onEditClasses}
        storeNow={storeNow}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(storeNow).toHaveBeenCalledTimes(1));
    const variables = storeNow.mock.calls[0]?.[0];
    if (variables === undefined) throw new Error("nothing was stored");
    expect(variables.tokens.map(token => token.name)).toEqual(
      SOURCE.tokens.map(token => token.name)
    );
    expect(variables.fluidRange).toEqual(SOURCE.fluidRange);
    expect(variables.siteText).toBeUndefined();
    expect(onEditClasses).not.toHaveBeenCalled();
    await act(async () => {
      stored(true);
    });
    await waitFor(() => expect(onEditClasses).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      finish(undefined);
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect((onChange.mock.calls[0]?.[0] as SiteTokenSet).siteText).toEqual(
      SOURCE.siteText
    );
    expect(
      await screen.findByText("Imported 3 variables and 1 text style.")
    ).toBeDefined();
  });

  it("keeps a Site text edit made while the text styles were being stored", async () => {
    const onChange = vi.fn();
    let finish: (refusal: string | undefined) => void = () => undefined;
    const onEditClasses = vi.fn<EditClasses>(
      () =>
        new Promise<string | undefined>(resolve => {
          finish = resolve;
        })
    );
    // The author changes Heading 1 once the variables are stored.
    let edited = false;
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        onEditClasses={onEditClasses}
        meanwhile={tokens =>
          edited
            ? {
                ...tokens,
                siteText: { ...tokens.siteText, h1: { fontSize: "5rem" } },
              }
            : tokens
        }
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onEditClasses).toHaveBeenCalledTimes(1));
    edited = true;
    await act(async () => {
      finish(undefined);
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect((onChange.mock.calls[0]?.[0] as SiteTokenSet).siteText).toEqual({
      h1: { fontSize: "5rem" },
      ...SOURCE.siteText,
    });
  });

  it("stores this site's own fluid rows remade across the file's fluid range in the first write", async () => {
    const sizes = { small: 32, large: 48 };
    const storeNow = vi.fn(async (_tokens: SiteTokenSet) => true);
    render(
      <WithFonts
        tokens={{
          tokens: [],
          fluidRange: { min: 360, max: 1280 },
          siteText: {
            h1: {
              fontSize: fluidValue(sizes, { min: 360, max: 1280 }),
              fluid: sizes,
            },
          },
        }}
        onEditClasses={async () => undefined}
        storeNow={storeNow}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(storeNow).toHaveBeenCalledTimes(1));
    // The file changes the range to 320–1440 and doesn't state Heading 1.
    expect(storeNow.mock.calls[0]?.[0].siteText?.h1?.fontSize).toBe(
      fluidValue(sizes, { min: 320, max: 1440 })
    );
  });

  it("counts only what was stored: refused text styles, and the rows following them, are said", async () => {
    const onChange = vi.fn();
    const onEditClasses = vi.fn<EditClasses>(
      async () => "Shared styles name a variable this site doesn't define."
    );
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        onEditClasses={onEditClasses}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    expect(
      await screen.findByText(
        "The text styles weren't imported, so neither was Site text."
      )
    ).toBeDefined();
    expect(await screen.findByText("Imported 3 variables.")).toBeDefined();
    expect(screen.queryByText(/text style\./)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stores nothing more when the variables aren't stored", async () => {
    const onEditClasses = vi.fn<EditClasses>(async () => undefined);
    const onChange = vi.fn();
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        onEditClasses={onEditClasses}
        storeNow={async () => false}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    expect(
      await screen.findByText(
        "The variables weren't saved, so nothing was imported."
      )
    ).toBeDefined();
    expect(onEditClasses).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says the variables were saved in part, and why, when the host stored only some", async () => {
    const onEditClasses = vi.fn<EditClasses>(async () => undefined);
    const onChange = vi.fn();
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        onEditClasses={onEditClasses}
        storeNow={async () => ({
          stored: "part",
          why: "Card shadow: the value isn't a shadow.",
        })}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    expect(
      await screen.findByText(
        "Only some of the variables were saved, so the text styles and Site text weren't imported."
      )
    ).toBeDefined();
    expect(
      screen.getByText("Card shadow: the value isn't a shadow.")
    ).toBeDefined();
    // Neither "nothing was imported" nor a count of every variable: some
    // were stored, and not all.
    expect(screen.queryByText(/nothing was imported/)).toBeNull();
    expect(screen.queryByText(/^Imported /)).toBeNull();
    // The text styles name variables the site may not hold, so they wait.
    expect(onEditClasses).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says a file with no text styles was saved in part when the host stored only some", async () => {
    const onChange = vi.fn();
    const storeNow = vi.fn(
      async (): Promise<VariablesStored> => ({
        stored: "part",
        why: "Card shadow: the value isn't a shadow.",
      })
    );
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        storeNow={storeNow}
      />
    );
    await chooseFile(
      "variables.tokens.json",
      exportDtcgWithTheme(SOURCE, [])[0]?.text ?? ""
    );
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    expect(
      await screen.findByText("Only some of the variables were saved.")
    ).toBeDefined();
    expect(
      screen.getByText("Card shadow: the value isn't a shadow.")
    ).toBeDefined();
    // Stored through the write that answers what it stored, never the
    // edit at the author's pause, whose answer nobody reads.
    expect(storeNow).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Imported /)).toBeNull();
  });

  it("counts a file with no text styles once the host says it stored all", async () => {
    const onChange = vi.fn();
    const storeNow = vi.fn(async () => true);
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        onChange={onChange}
        storeNow={storeNow}
      />
    );
    await chooseFile(
      "variables.tokens.json",
      exportDtcgWithTheme(SOURCE, [])[0]?.text ?? ""
    );
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(within(preview).getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Imported 3 variables.")).toBeDefined();
    expect(storeNow).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("lists the fonts the site lacks, offering Google Fonts for one the catalogue has", async () => {
    const add = vi.fn<FontCatalogue["add"]>(async () => undefined);
    const catalogue: FontCatalogue = {
      load: async () => ({ families: [INTER] }),
      previewUrl: () => "",
      add,
    };
    render(<WithFonts tokens={{ tokens: [] }} catalogue={catalogue} />);
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    const fonts = within(preview)
      .getByRole("heading", { name: "Fonts this site doesn't have" })
      .closest("section") as HTMLElement;
    const rows = within(fonts).getAllByRole("listitem");
    expect(rows.map(row => row.firstChild?.textContent)).toEqual([
      "Brand Sans",
      "Inter",
    ]);
    expect(rows[0]?.textContent).toContain(
      "Upload its font file in Fonts to use it."
    );
    const button = await within(fonts).findByRole("button", {
      name: "Add from Google Fonts: Inter",
    });
    expect(button.textContent).toBe("Add from Google Fonts");
    fireEvent.click(button);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith({
      id: "inter",
      weights: [400, 700],
      styles: ["normal"],
      subsets: ["latin"],
    });
    expect((await within(fonts).findByRole("status")).textContent).toBe(
      "Added"
    );
  });

  it("adds a family in the style it has when it has no upright one", async () => {
    const add = vi.fn<FontCatalogue["add"]>(async () => undefined);
    const italicOnly: CatalogueFamilyView = {
      ...INTER,
      styles: ["italic"],
    };
    const catalogue: FontCatalogue = {
      load: async () => ({ families: [italicOnly] }),
      previewUrl: () => "",
      add,
    };
    render(<WithFonts tokens={{ tokens: [] }} catalogue={catalogue} />);
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    fireEvent.click(
      await within(preview).findByRole("button", {
        name: "Add from Google Fonts: Inter",
      })
    );
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0]?.[0].styles).toEqual(["italic"]);
  });

  it("lists no font the site has a file for", async () => {
    const face: FontFaceDef = {
      family: "Brand Sans",
      weight: "400",
      style: "normal",
      src: [{ url: "/media/brand.woff2", format: "woff2" }],
    };
    render(<WithFonts tokens={{ tokens: [] }} faces={[face]} />);
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    const fonts = within(preview)
      .getByRole("heading", { name: "Fonts this site doesn't have" })
      .closest("section") as HTMLElement;
    expect(fonts.textContent).not.toContain("Brand Sans");
    expect(fonts.textContent).toContain("Inter");
  });

  it("words the preview plainly: no class or Classes, and no DTCG", async () => {
    const catalogue: FontCatalogue = {
      load: async () => ({ families: [INTER] }),
      previewUrl: () => "",
      add: async () => undefined,
    };
    // A site whose own text style has the file's name, so the preview also
    // says why one was not imported.
    const clash: NamedClass = { ...eyebrow, id: "ts-site-eyebrow" };
    render(
      <WithFonts
        tokens={{ tokens: [] }}
        classes={[clash]}
        onEditClasses={async () => undefined}
        catalogue={catalogue}
      />
    );
    await chooseFile("variables.tokens.json", exported());
    const preview = await screen.findByRole("dialog", {
      name: "Import variables",
    });
    await within(preview).findByRole("button", {
      name: "Add from Google Fonts: Inter",
    });
    const words = preview.textContent ?? "";
    expect(words).toContain("Eyebrow");
    expect(words).not.toMatch(/\bclass(?:es)?\b/i);
    expect(words).not.toMatch(/DTCG/);
  });
});

describe("exporting for Figma", () => {
  it("lists the shadow and the text style it leaves to Figma, and why", async () => {
    render(<WithFonts tokens={SOURCE} classes={[eyebrow]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: MORE }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Export for Figma" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "What wasn't exported" })
    );
    const list = await screen.findByRole("dialog", {
      name: "What wasn't exported",
    });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map(row => row.firstChild?.textContent)).toEqual([
      "Card shadow",
      "Eyebrow",
    ]);
    for (const row of rows) {
      expect(row.textContent).toContain(
        "Figma keeps these as effect styles and text styles; the variables they use are in the file"
      );
    }
  });
});
