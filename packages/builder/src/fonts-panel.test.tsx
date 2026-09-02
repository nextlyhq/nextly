// @vitest-environment jsdom

/**
 * The fonts panel, driven as an author meets it.
 *
 * `font-library.test` asserts the rules; what is only true HERE is the wiring:
 * that a read still in flight is not drawn as a site with no fonts, that the
 * specimen carries the family it names so the substitution is VISIBLE rather
 * than described, and that the jump to the tokens studio appears only when the
 * host offers one.
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

import { FontsPanel } from "./fonts-panel";
import type { FontFaceUpload } from "./fonts-panel";

afterEach(cleanup);

const face = (family: string): FontFaceDef => ({
  family,
  src: [{ url: "/fonts/f.woff2", format: "woff2" }],
});

const tokens: SiteTokenSet = {
  tokens: [
    {
      name: "brand.body",
      kind: "fontFamily",
      values: { light: "Brand, serif" },
    },
    { name: "brand.ui", kind: "fontFamily", values: { light: "system-ui" } },
  ],
};

describe("a fonts read that has not come back", () => {
  it("is drawn as loading, NOT as a site with no fonts", () => {
    // The third state. A site that self-hosts nothing legitimately has no
    // faces, and an author must not read "no font files" for a pending read.
    render(<FontsPanel faces={undefined} tokens={tokens} />);
    expect(screen.getByText("Loading fonts…")).toBeTruthy();
    expect(screen.queryByText(/loads no font files/)).toBeNull();
  });

  it("says a FAILED read failed, which is a different sentence", () => {
    render(<FontsPanel faces={undefined} tokens={tokens} absence="failed" />);
    expect(
      screen.getByText("This site's fonts could not be read.")
    ).toBeTruthy();
  });
});

describe("the panel over a site that has been read", () => {
  it("draws each specimen in the family it names", () => {
    // The prior-art finding: a list of typeface names set in the interface's
    // own font asks an author to choose a typeface from its name. Asserted on
    // the rendered style rather than on a prop, because the style IS the
    // affordance.
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    const specimens = screen.getAllByText(
      "Almost before we knew it, we had left the ground"
    );
    const families = specimens.map(el => el.style.fontFamily);
    expect(families).toContain('"Brand"');
    // The TOKEN specimen carries the whole stack, not just its first family.
    expect(families).toContain("Brand, serif");
  });

  it("reports the token whose first choice the site does not provide", () => {
    render(<FontsPanel faces={[]} tokens={tokens} />);
    expect(
      screen.getByText(
        /1 ask first for a typeface this site provides no file for/
      )
    ).toBeTruthy();
    expect(
      screen.getByText(/Brand is the typeface this token asks for first/)
    ).toBeTruthy();
  });

  it("stops reporting it once the site loads that face", () => {
    // The must-move half: same tokens, one face added. Without it the report
    // could be a constant.
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.queryByText(/ask first for a typeface/)).toBeNull();
    expect(
      screen.getByText(
        /none asking first for a typeface this site provides no file for/
      )
    ).toBeTruthy();
  });

  it("offers the jump to Tokens only when the host supplied one", () => {
    const onOpenTokens = vi.fn();
    const { rerender } = render(
      <FontsPanel faces={[]} tokens={tokens} onOpenTokens={onOpenTokens} />
    );
    expect(screen.getByRole("button", { name: "Edit in Tokens" })).toBeTruthy();

    rerender(<FontsPanel faces={[]} tokens={tokens} />);
    expect(screen.queryByRole("button", { name: "Edit in Tokens" })).toBeNull();
  });

  it("demonstrates each face with its OWN weight and style", () => {
    // Family alone selects the browser's normal upright face, so a site loading
    // regular and italic of one family would draw two identical specimens —
    // the list would then demonstrate the opposite of what it claims.
    const italic: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-i.woff2", format: "woff2" }],
      style: "italic",
      weight: "700",
    };
    render(
      <FontsPanel faces={[face("Brand"), italic]} tokens={{ tokens: [] }} />
    );
    const specimens = screen.getAllByText(
      "Almost before we knew it, we had left the ground"
    );
    expect(specimens.some(el => el.style.fontStyle === "italic")).toBe(true);
    expect(specimens.some(el => el.style.fontWeight === "700")).toBe(true);
  });

  it("keys subset faces apart rather than colliding them", () => {
    // Subsetting by `unicodeRange` is how a large script ships, and those faces
    // share family, weight and style by design. A key on those three alone
    // collides, and React cannot reconcile the rows.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const latin: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-latin.woff2", format: "woff2" }],
      unicodeRange: "U+0000-00FF",
    };
    const greek: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-greek.woff2", format: "woff2" }],
      unicodeRange: "U+0370-03FF",
    };
    render(<FontsPanel faces={[latin, greek]} tokens={{ tokens: [] }} />);
    const duplicateKey = warn.mock.calls.some(call =>
      String(call[0]).includes("same key")
    );
    warn.mockRestore();
    expect(duplicateKey).toBe(false);
  });

  it("draws a subset face with glyphs that face can actually render", () => {
    // A face limited to the Greek range covers none of the Latin sentence, so
    // the browser would draw the row from another subset or a fallback — the
    // row would claim to demonstrate a file whose glyphs are nowhere on screen.
    const greek: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-greek.woff2", format: "woff2" }],
      unicodeRange: "U+0370-03FF",
    };
    render(<FontsPanel faces={[greek]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/Αλμοστ/)).toBeTruthy();
    expect(
      screen.queryByText("Almost before we knew it, we had left the ground")
    ).toBeNull();
  });

  it("keeps the Latin specimen for a face declaring no range", () => {
    render(<FontsPanel faces={[face("Brand")]} tokens={{ tokens: [] }} />);
    expect(
      screen.getByText("Almost before we knew it, we had left the ground")
    ).toBeTruthy();
  });

  it("expands a WILDCARD range rather than reading its leading digits", () => {
    // `U+4??` is `U+0400-04FF`. Read as a plain hex run it captures `4` alone,
    // which lands three orders of magnitude below the block it names and hands
    // a Cyrillic face the Latin sentence it cannot draw.
    const cyrillic: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-cyrillic.woff2", format: "woff2" }],
      unicodeRange: "U+4??",
    };
    render(<FontsPanel faces={[cyrillic]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/Почти/)).toBeTruthy();
    expect(
      screen.queryByText("Almost before we knew it, we had left the ground")
    ).toBeNull();
  });

  it("refuses a sentence the range only PARTLY covers", () => {
    // A range opening in the Cyrillic block does not mean it reaches across it.
    // Two codepoints cannot draw a sentence, so the row falls back to glyphs
    // taken from the range itself rather than demonstrating a fallback font.
    const sliver: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-sliver.woff2", format: "woff2" }],
      unicodeRange: "U+0400-0401",
    };
    render(<FontsPanel faces={[sliver]} tokens={{ tokens: [] }} />);
    expect(screen.queryByText(/Почти/)).toBeNull();
    expect(
      screen.queryByText("Almost before we knew it, we had left the ground")
    ).toBeNull();
    expect(screen.getByText("\u0400\u0401")).toBeTruthy();
  });

  it("reads a comma-separated range as the union of its intervals", () => {
    /*
     * Split so that NEITHER interval covers the sentence alone: the Cyrillic
     * specimen opens with a capital, which lives in the first, and every other
     * letter lives in the second. A test whose first interval already covered
     * the whole sentence would pass while the parser silently discarded the
     * rest, which is the reading it exists to rule out.
     */
    const split: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-cyrillic.woff2", format: "woff2" }],
      unicodeRange: "U+0410-042F, U+0430-044F",
    };
    render(<FontsPanel faces={[split]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/Почти/)).toBeTruthy();
  });

  it("samples glyphs that DRAW, not the C1 controls", () => {
    /*
     * `U+0080-00FF` covers no canned sentence, so the sampler starts at
     * U+0080 — and the thirty-two invisible C1 controls fill the whole budget
     * before reaching a single accented letter, leaving a specimen that
     * renders as nothing.
     */
    const latin1: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-latin1.woff2", format: "woff2" }],
      unicodeRange: "U+0080-00FF",
    };
    render(<FontsPanel faces={[latin1]} tokens={{ tokens: [] }} />);
    // Accented letters the face can actually demonstrate, rather than the
    // symbols the front of the interval opens with.
    expect(screen.getByText(/Æ/)).toBeTruthy();
    expect(screen.getByText(/Ð/)).toBeTruthy();
  });

  it("draws NOTHING for a face subset entirely to control characters", () => {
    /*
     * Separate from the case above, because striding alone already reaches the
     * letters in a wide interval — so that test cannot tell whether controls
     * are skipped. Here the whole interval is the C1 block: every codepoint is
     * non-printing, and the honest specimen is an empty one rather than a
     * string of invisible characters that merely LOOKS empty.
     */
    const controlsOnly: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand-c1.woff2", format: "woff2" }],
      unicodeRange: "U+0080-009F",
    };
    const { container } = render(
      <FontsPanel faces={[controlsOnly]} tokens={{ tokens: [] }} />
    );
    const specimens = Array.from(
      container.querySelectorAll(".nx-fonts__specimen")
    );
    // The control: a selector matching nothing would satisfy the loop below
    // without ever reading a specimen.
    expect(specimens.length).toBeGreaterThan(0);
    for (const specimen of specimens) {
      expect(specimen.textContent).toBe("");
    }
  });

  it("refuses a range reaching past the end of Unicode", () => {
    // `validateFontFace` accepts `U+110000-110010` — it checks the characters,
    // not the numbers — and `String.fromCodePoint` throws above U+10FFFF, which
    // took the whole panel down rather than the one row.
    const impossible: FontFaceDef = {
      family: "Brand",
      src: [{ url: "/fonts/brand.woff2", format: "woff2" }],
      unicodeRange: "U+110000-110010",
    };
    render(<FontsPanel faces={[impossible]} tokens={{ tokens: [] }} />);
    // It renders at all, and falls back to the sentence rather than sampling a
    // codepoint that does not exist.
    expect(
      screen.getByText("Almost before we knew it, we had left the ground")
    ).toBeTruthy();
  });

  it("says a site with no faces has none, rather than staying silent", () => {
    render(<FontsPanel faces={[]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/loads no font files of its own/)).toBeTruthy();
    expect(screen.getByText(/no typeface tokens yet/)).toBeTruthy();
  });
});

describe("adding a font file", () => {
  const woff2 = (name: string): File =>
    new File([new Uint8Array([0x77, 0x4f, 0x46, 0x32])], name, {
      type: "font/woff2",
    });

  /** Choose a file the way a picker does, since jsdom has no picker. */
  async function chooseFile(file: File): Promise<void> {
    const input = screen.getByLabelText("Font file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], writable: false });
    await act(async () => {
      fireEvent.change(input);
    });
  }

  it("offers NO control when the host cannot store a file", () => {
    /*
     * Absent rather than disabled. A host with no media pipeline cannot store
     * anything, and a greyed-out button is a promise that something is coming.
     */
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.queryByLabelText("Font file")).toBeNull();
    expect(screen.queryByRole("button", { name: /add font file/i })).toBeNull();
  });

  it("hands the host the file and the descriptors the author stated", async () => {
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(
      <FontsPanel
        faces={[face("Brand")]}
        onAddFace={onAddFace}
        tokens={tokens}
      />
    );

    await chooseFile(woff2("Inter-BoldItalic.woff2"));
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "700" },
    });
    fireEvent.change(screen.getByLabelText("Style"), {
      target: { value: "italic" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(onAddFace).toHaveBeenCalledTimes(1);
    const request = onAddFace.mock.calls[0]?.[0];
    expect(request?.file.name).toBe("Inter-BoldItalic.woff2");
    // The family is prefilled from the stem; the weight and style are NOT
    // inferred from it, because a wrong one loads and silently matches nothing.
    expect(request?.family).toBe("Inter");
    expect(request?.weight).toBe("700");
    expect(request?.style).toBe("italic");
  });

  it("does not overwrite a family the author already typed", async () => {
    /*
     * The prefill is a convenience, and a convenience that discards typing is
     * not one. Re-picking a file is the ordinary way to correct a mistake.
     */
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    fireEvent.change(screen.getByLabelText("Family"), {
      target: { value: "Founders Grotesk" },
    });
    await chooseFile(woff2("Inter-Regular.woff2"));

    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Founders Grotesk"
    );
  });

  it("shows the host's refusal and KEEPS what the author entered", async () => {
    /*
     * A refusal an author can act on has to leave the thing being refused on
     * screen. Clearing the form would make the fix a re-entry.
     */
    const onAddFace = vi.fn(
      async (_request: FontFaceUpload) => "That file is not a font."
    );
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /add font file/i }));
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "That file is not a font."
    );
    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      "Inter"
    );
  });

  it("clears the file and family once the host stored one", async () => {
    // The control for the case above: without it, "keeps the fields" is also
    // satisfied by a form that never clears them.
    const onAddFace = vi.fn(async (_request: FontFaceUpload) => undefined);
    render(<FontsPanel faces={[]} onAddFace={onAddFace} tokens={tokens} />);

    await chooseFile(woff2("Inter-Regular.woff2"));
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: /add font file/i }));
    });

    expect((screen.getByLabelText("Family") as HTMLInputElement).value).toBe(
      ""
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the faces this site loads", () => {
  it("groups the cuts of one family under its name", () => {
    /*
     * Adding a typeface means adding its regular, its bold and its italic, and
     * a flat list repeats the name down the panel while saying nothing about
     * which weights the family covers.
     */
    const brand = (weight: string, style?: string): FontFaceDef => ({
      family: "Brand",
      src: [{ url: `/fonts/${weight}${style ?? ""}.woff2`, format: "woff2" }],
      weight,
      ...(style !== undefined && { style }),
    });

    render(
      <FontsPanel
        faces={[brand("400"), brand("700"), brand("400", "italic")]}
        tokens={tokens}
      />
    );

    /*
     * Scoped to the faces section. The tokens section below names the same
     * family — that is the join this panel exists for — so an unscoped query
     * matches text this case is not about and would report two headings for a
     * grouping that produced one.
     */
    const listed = within(
      screen.getByRole("region", { name: "Font files this site loads" })
    );
    expect(listed.getAllByText("Brand")).toHaveLength(1);
    expect(listed.getByText("400")).toBeTruthy();
    expect(listed.getByText("700")).toBeTruthy();
    expect(listed.getByText("400 Italic")).toBeTruthy();
  });

  it("calls a face declaring neither weight nor style the Regular", () => {
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.getByText("Regular")).toBeTruthy();
  });
});
