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
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FontsPanel } from "./fonts-panel";

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
    expect(screen.getByText(/1 of 2 ask first for a typeface/)).toBeTruthy();
    expect(
      screen.getByText(/Brand is the typeface this token asks for first/)
    ).toBeTruthy();
  });

  it("stops reporting it once the site loads that face", () => {
    // The must-move half: same tokens, one face added. Without it the report
    // could be a constant.
    render(<FontsPanel faces={[face("Brand")]} tokens={tokens} />);
    expect(screen.queryByText(/ask first for a typeface/)).toBeNull();
    expect(screen.getByText(/each asking first for a family/)).toBeTruthy();
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

  it("says a site with no faces has none, rather than staying silent", () => {
    render(<FontsPanel faces={[]} tokens={{ tokens: [] }} />);
    expect(screen.getByText(/loads no font files of its own/)).toBeTruthy();
    expect(screen.getByText(/no typeface tokens yet/)).toBeTruthy();
  });
});
