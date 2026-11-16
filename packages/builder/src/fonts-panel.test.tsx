// @vitest-environment jsdom

/**
 * The Fonts tab of the Design panel, driven as an author meets it: the site's
 * families, each with its details beside the panel; the font variables; the
 * upload; and every state's words.
 *
 * `font-library.test` asserts the rules this draws from.
 *
 * @module fonts-panel.test
 */
import type { FontFaceDef, SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SiteFamily } from "./font-library";
import {
  FontsPanel,
  type FontFaceUpload,
  type FontsPanelProps,
} from "./fonts-panel";

afterEach(cleanup);

const file = (id: string) => [{ url: `/api/media/${id}/raw`, format: "woff2" }];
const google = {
  kind: "google" as const,
  id: "inter",
  licence: "OFL-1.1",
  category: "sans-serif",
};
const INTER: FontFaceDef[] = [
  {
    family: "Inter",
    src: file("a"),
    weight: "400",
    style: "normal",
    source: google,
  },
  {
    family: "Inter",
    src: file("b"),
    weight: "700",
    style: "normal",
    source: google,
  },
  {
    family: "Inter",
    src: file("c"),
    weight: "400",
    style: "italic",
    source: google,
  },
];
const BRAND: FontFaceDef = {
  family: "Brand",
  src: file("d"),
  weight: "100 900",
  source: { kind: "upload" },
};
const GEIST: FontFaceDef = {
  family: "Geist",
  src: [{ url: "/fonts/geist.woff2" }],
};

const TOKENS: SiteTokenSet = {
  tokens: [
    {
      name: "font.body",
      label: "Body",
      kind: "fontFamily",
      values: { light: "Inter, sans-serif" },
    },
    {
      name: "font.heading",
      label: "Heading font",
      kind: "fontFamily",
      values: { light: "Ghost, serif" },
    },
  ],
};

function panel(
  props: Partial<FontsPanelProps> = {}
): ReturnType<typeof render> {
  return render(
    <FontsPanel
      faces={[...INTER, BRAND, GEIST]}
      codeFaces={[GEIST]}
      tokens={TOKENS}
      onAddFace={async () => undefined}
      onRemoveFamily={async () => undefined}
      catalogue={{
        load: async () => ({ families: [] }),
        previewUrl: () => "https://cdn.example/f.woff2",
        add: async () => undefined,
      }}
      {...props}
    />
  );
}

const row = (name: RegExp): HTMLElement => screen.getByRole("button", { name });

async function openMenu(): Promise<void> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Add a font" }), {
    key: "Enter",
  });
  await screen.findByRole("menu");
}

describe("reading the site's fonts", () => {
  it("says the read is in flight, not that the site has no fonts", () => {
    render(
      <FontsPanel faces={undefined} tokens={undefined} absence="pending" />
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Reading this site\u2019s fonts\u2026"
    );
    expect(screen.queryByText(/No fonts on this site/)).toBeNull();
  });

  it("says a failed read failed, and what that means", () => {
    render(
      <FontsPanel faces={undefined} tokens={undefined} absence="failed" />
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "This site\u2019s fonts could not be read, so none can be shown or changed. Reload to try again."
    );
  });
});

describe("the site's fonts", () => {
  it("lists each family once, drawn in itself, with its styles", () => {
    panel();
    const inter = row(/^Inter, 3 styles/);
    expect(inter.getAttribute("aria-label")).toBe(
      "Inter, 3 styles: Regular 400, Bold 700, Italic 400, from Google Fonts"
    );
    expect(within(inter).getByText("Aa").style.fontFamily).toBe('"Inter"');
    expect(within(inter).getByText("3 styles")).toBeTruthy();
    expect(within(row(/^Brand,/)).getByText("100\u2013900")).toBeTruthy();
    // The name is cut with an ellipsis when long, so it carries itself whole.
    expect(within(inter).getByText("Inter").getAttribute("title")).toBe(
      "Inter"
    );
  });

  it("says where the fonts live, in the research's words", () => {
    panel();
    expect(
      screen.getByText(
        "Fonts are stored on your site. Visitors\u2019 browsers never contact Google."
      )
    ).toBeTruthy();
  });

  it("offers Google Fonts and an upload from the group's add", async () => {
    panel();
    await openMenu();
    expect(
      screen.getAllByRole("menuitem").map(item => item.textContent)
    ).toEqual(["From Google Fonts", "Upload a font file"]);
  });

  it("offers only the upload when the host has no catalogue", async () => {
    panel({ catalogue: undefined });
    await openMenu();
    expect(
      screen.getAllByRole("menuitem").map(item => item.textContent)
    ).toEqual(["Upload a font file"]);
  });

  it("says a site with no fonts uses the system font, and offers both ways to add one", () => {
    panel({ faces: [] });
    expect(
      screen.getByText(
        "No fonts on this site yet, so pages use the system font."
      )
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add from Google Fonts" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Upload a font file" })
    ).toBeTruthy();
  });

  it("narrows to a search, and offers the catalogue when nothing matches", () => {
    panel();
    const search = screen.getByRole("searchbox", { name: "Search fonts" });
    fireEvent.change(search, { target: { value: "bra" } });
    expect(screen.queryByRole("button", { name: /^Inter,/ })).toBeNull();
    expect(row(/^Brand,/)).toBeTruthy();
    fireEvent.change(search, { target: { value: "zz" } });
    expect(
      screen.getByText("No fonts on this site match this search.")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Search Google Fonts for \u201czz\u201d",
      })
    ).toBeTruthy();
  });

  it("opens a family's details beside the panel: its styles, each drawn in itself, and its source", async () => {
    panel();
    fireEvent.click(row(/^Inter,/));
    const details = await screen.findByRole("dialog", { name: "Inter" });
    const bold = within(details).getByText("Bold 700");
    expect(bold.style.fontWeight).toBe("700");
    expect(within(details).getByText("Italic 400").style.fontStyle).toBe(
      "italic"
    );
    expect(
      within(details).getByText(
        "From Google Fonts \u00b7 SIL Open Font License"
      )
    ).toBeTruthy();
  });

  it("says a family from the site's code is set there, and offers no Remove", async () => {
    panel();
    fireEvent.click(row(/^Geist,/));
    const details = await screen.findByRole("dialog", { name: "Geist" });
    expect(
      within(details).getByText("Set in your site\u2019s code")
    ).toBeTruthy();
    expect(
      within(details).queryByRole("button", { name: "Remove" })
    ).toBeNull();
  });

  it("removes the cuts added to a family from the site's code, and says the code's stay", async () => {
    const onRemoveFamily = vi.fn(async (_family: SiteFamily) => undefined);
    const bold: FontFaceDef = {
      family: "Geist",
      src: [{ url: "/api/media/geist-bold/raw", format: "woff2" }],
      weight: "700",
      source: { kind: "upload" },
    };
    panel({ faces: [...INTER, BRAND, GEIST, bold], onRemoveFamily });
    fireEvent.click(row(/^Geist,/));
    const details = await screen.findByRole("dialog", { name: "Geist" });
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    const confirm = within(details).getByRole("group", {
      name: "Remove Geist",
    });
    expect(confirm.textContent).toContain(
      "Remove the Geist styles you added here? Styles from your site\u2019s code stay."
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Geist" }));
    });
    expect(onRemoveFamily).toHaveBeenCalledTimes(1);
  });

  it("removes a family only once the author confirms, keeping the files", async () => {
    const onRemoveFamily = vi.fn(async (_family: SiteFamily) => undefined);
    panel({ onRemoveFamily });
    fireEvent.click(row(/^Inter,/));
    const details = await screen.findByRole("dialog", { name: "Inter" });
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    const confirm = within(details).getByRole("group", {
      name: "Remove Inter",
    });
    expect(confirm.textContent).toContain(
      "Text set in it falls back to the next font in its list. The files stay in your media library."
    );
    fireEvent.click(within(confirm).getByRole("button", { name: "Keep" }));
    expect(onRemoveFamily).not.toHaveBeenCalled();
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Inter" }));
    });
    expect(onRemoveFamily).toHaveBeenCalledTimes(1);
    expect(onRemoveFamily.mock.calls[0]?.[0]).toMatchObject({ key: "inter" });
  });

  it("shows why a removal was refused, in the details", async () => {
    panel({ onRemoveFamily: async () => "The site refused it." });
    fireEvent.click(row(/^Inter,/));
    const details = await screen.findByRole("dialog", { name: "Inter" });
    fireEvent.click(within(details).getByRole("button", { name: "Remove" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Inter" }));
    });
    expect(within(details).getByRole("alert").textContent).toBe(
      "The site refused it."
    );
  });

  it("shows a role without the grant everything and lets it change nothing", async () => {
    panel({ readOnly: true });
    expect(
      screen.getByText(
        "You can view the site\u2019s fonts but not change them."
      )
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a font" })).toBeNull();
    fireEvent.click(row(/^Inter,/));
    const details = await screen.findByRole("dialog", { name: "Inter" });
    expect(
      within(details).queryByRole("button", { name: "Remove" })
    ).toBeNull();
  });

  it("offers no add links on an empty site to a role without the grant", () => {
    panel({ faces: [], readOnly: true });
    expect(
      screen.queryByRole("button", { name: "Add from Google Fonts" })
    ).toBeNull();
  });
});

describe("the font variables", () => {
  it("names a variable as Variables does when it has no name of its own", () => {
    panel({
      onOpenTokens: vi.fn(),
      tokens: {
        tokens: [
          {
            name: "font.body",
            kind: "fontFamily",
            values: { light: "system-ui" },
          },
        ],
      },
    });
    expect(row(/^Body,/)).toBeTruthy();
    expect(screen.queryByText("font.body")).toBeNull();
  });

  it("lists each font variable by its plain name, with its first family", () => {
    panel({ onOpenTokens: vi.fn() });
    const body = row(/^Body/);
    expect(within(body).getByText("Inter")).toBeTruthy();
    expect(within(body).getByText("Aa").style.fontFamily).toContain("Inter");
  });

  it("says when a variable asks first for a family the site has no file for", () => {
    const onOpenTokens = vi.fn();
    panel({ onOpenTokens });
    expect(screen.getByText(/Ghost/, { selector: "p" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit in Variables" }));
    expect(onOpenTokens).toHaveBeenCalledTimes(1);
  });

  it("opens Variables from a variable's row", () => {
    const onOpenTokens = vi.fn();
    panel({ onOpenTokens });
    fireEvent.click(row(/^Body/));
    expect(onOpenTokens).toHaveBeenCalledTimes(1);
  });

  it("says a site has none, and where they are made", () => {
    panel({ tokens: { tokens: [] } });
    expect(
      screen.getByText("No font variables yet. Variables creates them.")
    ).toBeTruthy();
  });
});

describe("uploading a font file", () => {
  const woff2 = (name: string): File =>
    new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], name, {
      type: "font/woff2",
    });

  /**
   * The panel where the product puts it: inside the entry editor's `<form>`,
   * whose submit must never be reached from here.
   */
  async function openUpload(
    onAddFace: (request: FontFaceUpload) => Promise<string | undefined>,
    acceptFiles?: string
  ): Promise<{
    entrySubmitted: ReturnType<typeof vi.fn>;
    editor: HTMLElement;
  }> {
    const entrySubmitted = vi.fn();
    render(
      <form
        onSubmit={event => {
          event.preventDefault();
          entrySubmitted();
        }}
      >
        <FontsPanel
          faces={[]}
          tokens={TOKENS}
          onAddFace={onAddFace}
          acceptFiles={acceptFiles}
        />
      </form>
    );
    fireEvent.click(screen.getByRole("button", { name: "Upload a font file" }));
    const editor = await screen.findByRole("dialog", {
      name: "Upload a font file",
    });
    return { entrySubmitted, editor };
  }

  async function chooseFile(chosen: File): Promise<void> {
    const input = screen.getByLabelText("Font file") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [chosen],
      configurable: true,
    });
    Object.defineProperty(input, "value", {
      value: `C:\\fakepath\\${chosen.name}`,
      writable: true,
      configurable: true,
    });
    await act(async () => {
      fireEvent.change(input);
    });
  }

  const confirmRights = (): void => {
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I have the right to use this font on the web",
      })
    );
  };

  async function chooseWeight(name: string): Promise<void> {
    fireEvent.keyDown(screen.getByRole("button", { name: /^Weight/ }), {
      key: "Enter",
    });
    await screen.findByRole("menu");
    fireEvent.click(screen.getByRole("menuitemradio", { name }));
  }

  it("names the file, guesses the family, and asks for the rights before it uploads", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    await openUpload(onAddFace);
    expect(screen.getByText("No file chosen")).toBeTruthy();
    await chooseFile(woff2("Inter-Bold.woff2"));
    expect(screen.getByText("Inter-Bold.woff2 \u00b7 0 KB")).toBeTruthy();
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Inter"
    );
    const upload = screen.getByRole("button", { name: "Upload" });
    expect((upload as HTMLButtonElement).disabled).toBe(true);
    confirmRights();
    expect((upload as HTMLButtonElement).disabled).toBe(false);
  });

  it("hands the host the file and the weight and style the author chose", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    await openUpload(onAddFace);
    await chooseFile(woff2("Inter-BoldItalic.woff2"));
    await chooseWeight("Bold 700");
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    confirmRights();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
    expect(onAddFace).toHaveBeenCalledTimes(1);
    expect(onAddFace.mock.calls[0]?.[0]).toMatchObject({
      family: "Inter",
      weight: "700",
      style: "italic",
    });
  });

  it("takes a variable range, lighter weight first", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    await openUpload(onAddFace);
    await chooseFile(woff2("Inter-Variable.woff2"));
    await chooseWeight("Variable (a range)");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "900" },
    });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "100" } });
    confirmRights();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
    expect(onAddFace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose a weight, or a range with the lighter weight first."
    );
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "900" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
    expect(onAddFace.mock.calls[0]?.[0]).toMatchObject({ weight: "100 900" });
  });

  it("keeps what the author entered when the host refuses, and says why", async () => {
    await openUpload(
      async () =>
        "This file isn\u2019t a .woff2 or .woff font, so it wasn\u2019t added."
    );
    await chooseFile(woff2("Inter-Regular.woff2"));
    fireEvent.change(screen.getByLabelText("Family"), {
      target: { value: "Inter Display" },
    });
    confirmRights();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "isn\u2019t a .woff2 or .woff font"
    );
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Inter Display"
    );
  });

  it("does not overwrite a family the author typed, and refreshes a guess", async () => {
    await openUpload(async () => undefined);
    await chooseFile(woff2("Inter-Regular.woff2"));
    await chooseFile(woff2("Lora-Regular.woff2"));
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Lora"
    );
    fireEvent.change(screen.getByLabelText("Family"), {
      target: { value: "Brand" },
    });
    await chooseFile(woff2("Inter-Bold.woff2"));
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Brand"
    );
  });

  it("clears the picker and the cut once a face is stored, so the next file starts clean", async () => {
    await openUpload(async () => undefined);
    await chooseFile(woff2("Inter-Regular.woff2"));
    await chooseWeight("Bold 700");
    confirmRights();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
    expect((screen.getByLabelText("Font file") as HTMLInputElement).value).toBe(
      ""
    );
    expect(screen.getByText("No file chosen")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Weight/ }).textContent
    ).toContain("Regular 400");
    // The rights are confirmed for each file, not once per open editor.
    expect(
      screen
        .getByRole("checkbox", {
          name: "I have the right to use this font on the web",
        })
        .getAttribute("aria-checked")
    ).toBe("false");
    await chooseFile(woff2("Inter-Bold.woff2"));
    expect(
      (screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("starts the next file's variable range afresh", async () => {
    await openUpload(async () => undefined);
    await chooseFile(woff2("Inter-Variable.woff2"));
    await chooseWeight("Variable (a range)");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "700" },
    });
    confirmRights();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    });
    await chooseFile(woff2("Other-Variable.woff2"));
    await chooseWeight("Variable (a range)");
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe(
      "100"
    );
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("900");
  });

  it("offers the file types the host accepts", async () => {
    await openUpload(async () => undefined, ".woff2,font/woff2");
    expect(screen.getByLabelText("Font file").getAttribute("accept")).toBe(
      ".woff2,font/woff2"
    );
  });

  it("builds no form of its own, which HTML forbids inside the entry's", async () => {
    const { editor } = await openUpload(async () => undefined);
    expect(editor.querySelectorAll("form")).toHaveLength(0);
    expect(document.querySelectorAll("form")).toHaveLength(1);
  });

  it("uploads on Enter in the family field, without saving the entry", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    const { entrySubmitted } = await openUpload(onAddFace);
    await chooseFile(woff2("Inter-Regular.woff2"));
    confirmRights();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Family"), { key: "Enter" });
    });
    expect(onAddFace).toHaveBeenCalledTimes(1);
    expect(entrySubmitted).not.toHaveBeenCalled();
  });

  it("lets an IME keystroke through rather than taking Enter from it", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    await openUpload(onAddFace);
    await chooseFile(woff2("Inter-Regular.woff2"));
    confirmRights();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText("Family"), {
        key: "Enter",
        isComposing: true,
      });
    });
    expect(onAddFace).not.toHaveBeenCalled();
  });
});

describe("the Fonts tab's words", () => {
  it("says fonts and variables, never tokens or typefaces", () => {
    const { container } = panel();
    expect(container.textContent).not.toMatch(/token|typeface/i);
  });
});
