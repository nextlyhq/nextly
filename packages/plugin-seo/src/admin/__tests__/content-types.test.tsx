// @vitest-environment jsdom

/**
 * The Content types tab as a person uses it: rows start closed and one opens
 * at a time; each type's switch turns its SEO off or on with a note that says
 * what Save will do, and deletes nothing; without the right to change the
 * settings the switches only show their state; types the site's code gives
 * no SEO sit greyed at the end with the reason; past ten types a search and
 * an on/off filter appear.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type JSX } from "react";
import { describe, expect, it } from "vitest";

import type { SeoContentType, SwitchedOffType } from "../../settings/contract";
import { ContentTypesTab } from "../content-types";
import { draftOf, type SettingsDraft } from "../settings-draft";

function seoType(
  key: string,
  label: string,
  extra: Partial<SeoContentType> = {}
): SeoContentType {
  return {
    key,
    label,
    kind: "collection",
    source: "code",
    fields: [],
    mappableFields: [],
    count: 6,
    public: true,
    example: { title: "A", values: {}, address: `/${key}/a` },
    ...extra,
  };
}

const posts = seoType("posts", "Posts");
const authors = seoType("authors", "Authors");
const products = seoType("products", "Products", { source: "builder" });
const home = seoType("single:home", "Home page", { kind: "single" });

const leftOut: SwitchedOffType = {
  key: "docs-old",
  label: "Docs (old)",
  kind: "collection",
  source: "code",
  reason: "left-out",
  count: 40,
  public: true,
  seo: false,
};
const ownSeo: SwitchedOffType = {
  ...leftOut,
  key: "landing",
  label: "Landing pages",
  reason: "own-seo",
  count: 5,
};

/** The draft the tab last reported, for what a save would send. */
let latest: SettingsDraft;

function Tab({
  types,
  switchedOff = [],
  saved = [],
  canChange = true,
}: {
  types: SeoContentType[];
  switchedOff?: SwitchedOffType[];
  saved?: string[];
  canChange?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(() =>
    draftOf({ id: "s1", typesWithSeoOff: saved })
  );
  latest = draft;
  return (
    <ContentTypesTab
      draft={draft}
      change={next => setDraft(current => next(current))}
      types={types}
      switchedOff={switchedOff}
      savedOff={saved}
      canChange={canChange}
    />
  );
}

const row = (label: string) => screen.getByRole("group", { name: label });

describe("the Content types tab", () => {
  it("starts with every row closed and opens one at a time", () => {
    render(<Tab types={[posts, authors]} />);
    expect(screen.queryByText("Title pattern")).toBeNull();

    fireEvent.click(
      within(row("Posts")).getByRole("button", { name: /Posts/ })
    );
    expect(within(row("Posts")).getByText("Title pattern")).toBeTruthy();

    fireEvent.click(
      within(row("Authors")).getByRole("button", { name: /Authors/ })
    );
    expect(within(row("Authors")).getByText("Title pattern")).toBeTruthy();
    expect(within(row("Posts")).queryByText("Title pattern")).toBeNull();
  });

  it("says where each type was made, and lists Singles in their own group", () => {
    render(<Tab types={[posts, products, home]} />);
    expect(within(row("Posts")).getByText("In code")).toBeTruthy();
    expect(within(row("Products")).getByText("Schema Builder")).toBeTruthy();
    const singles = screen.getByRole("region", { name: "Singles" });
    expect(within(singles).getByText("Home page")).toBeTruthy();
  });

  it("switches a type off with a note that nothing is deleted, and back on with nothing to save", () => {
    render(<Tab types={[posts, authors]} />);
    fireEvent.click(screen.getByRole("switch", { name: "SEO for Authors" }));

    expect(latest.typesWithSeoOff).toEqual(["authors"]);
    const note = within(row("Authors")).getByRole("note");
    expect(note.textContent).toContain("SEO is off for Authors once you save");
    expect(note.textContent).toContain("are kept");
    expect(note.textContent).toContain("Hide the whole group from search");

    fireEvent.click(screen.getByRole("switch", { name: "SEO for Authors" }));
    expect(latest.typesWithSeoOff).toEqual([]);
    expect(within(row("Authors")).queryByRole("note")).toBeNull();
  });

  it("says the values are kept without counting entries a type doesn't have", () => {
    render(<Tab types={[seoType("faq", "FAQ items", { count: 0 })]} />);
    fireEvent.click(screen.getByRole("switch", { name: "SEO for FAQ items" }));
    const note = within(row("FAQ items")).getByRole("note").textContent ?? "";
    expect(note).not.toContain("no entries");
    expect(note).toContain("The values saved are kept");
  });

  it("says a type saved as off keeps its values, and that switching it on uses them again", () => {
    render(<Tab types={[posts, authors]} saved={["authors"]} />);
    expect(
      within(row("Authors")).getByText(/SEO off · their SEO values are kept/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "SEO for Authors" }));
    expect(within(row("Authors")).getByRole("status").textContent).toContain(
      "SEO is back on for Authors once you save"
    );
  });

  it("shows the switches without letting them change for someone who may not change the settings", () => {
    render(
      <Tab types={[posts, authors]} saved={["authors"]} canChange={false} />
    );
    const off = screen.getByRole("switch", { name: "SEO for Authors" });
    expect(off.getAttribute("aria-checked")).toBe("false");
    expect(off.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(
        /Only people who can change the site's SEO settings can switch SEO/
      )
    ).toBeTruthy();
  });

  it("puts the types the site's code gives no SEO last, greyed, with the reason in place of the switch", () => {
    render(<Tab types={[posts]} switchedOff={[ownSeo, leftOut]} />);
    const collections = screen.getByRole("region", { name: "Collections" });
    const names = within(collections)
      .getAllByRole("group")
      .map(group => group.getAttribute("aria-label"));
    expect(names).toEqual(["Posts", "Landing pages", "Docs (old)"]);

    expect(
      within(row("Docs (old)")).getByText("Left out in the site's code")
    ).toBeTruthy();
    expect(
      within(row("Docs (old)")).queryByRole("switch", { name: /SEO for/ })
    ).toBeNull();
    expect(
      within(row("Landing pages")).getByRole("link", {
        name: "Import its values",
      })
    ).toBeTruthy();
    expect(
      within(row("Landing pages")).getByText(/Has its own field named seo/)
    ).toBeTruthy();
  });

  it("offers a search and an on/off filter past ten types", () => {
    const many = Array.from({ length: 11 }, (_, at) =>
      seoType(`type${at}`, `Type ${String(at).padStart(2, "0")}`)
    );
    render(<Tab types={many} saved={["type3"]} />);
    const search = screen.getByRole("searchbox", { name: "Find a type" });

    fireEvent.change(search, { target: { value: "type 1" } });
    expect(
      screen
        .getAllByRole("switch", { name: /SEO for/ })
        .map(each => each.getAttribute("aria-label"))
    ).toEqual(["SEO for Type 10"]);

    fireEvent.change(search, { target: { value: "prodcts" } });
    expect(screen.getByText(/No type matches "prodcts"/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(screen.getAllByRole("switch", { name: /SEO for/ })).toHaveLength(11);

    fireEvent.click(screen.getByRole("radio", { name: /SEO off/ }));
    expect(
      screen
        .getAllByRole("switch", { name: /SEO for/ })
        .map(each => each.getAttribute("aria-label"))
    ).toEqual(["SEO for Type 03"]);
  });

  it("counts as off only the types with SEO switched off, never one the site's code leaves out", () => {
    const many = Array.from({ length: 9 }, (_, at) =>
      seoType(`type${at}`, `Type ${at}`)
    );
    render(
      <Tab types={many} switchedOff={[leftOut, ownSeo]} saved={["type3"]} />
    );
    // Eleven rows, so the filter shows: one type is off, eight are on, and
    // the two locked rows are neither.
    expect(screen.getByRole("radio", { name: "SEO off 1" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "SEO on 8" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "All 11" })).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "SEO off 1" }));
    expect(screen.queryByRole("group", { name: "Docs (old)" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Landing pages" })).toBeNull();
    expect(screen.getByRole("group", { name: "Type 3" })).toBeTruthy();
  });

  it("keeps a row moved under a filter in view, with its note, until it is saved", () => {
    const many = Array.from({ length: 11 }, (_, at) =>
      seoType(`type${at}`, `Type ${at}`)
    );
    render(<Tab types={many} />);
    fireEvent.click(screen.getByRole("radio", { name: /^SEO on/ }));
    fireEvent.click(screen.getByRole("switch", { name: "SEO for Type 4" }));
    expect(within(row("Type 4")).getByRole("note")).toBeTruthy();
  });

  it("offers no search for a few types", () => {
    render(<Tab types={[posts, authors]} />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("says how a type gets SEO where the site has none yet", () => {
    render(<Tab types={[]} />);
    expect(screen.getByText("No content types yet")).toBeTruthy();
  });
});
