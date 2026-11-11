// @vitest-environment jsdom
/**
 * The SEO panel as a person uses it: the preview follows what is typed, each
 * field says what will be used and where it comes from, typing offers one way
 * back to automatic, Advanced starts closed, and a typed official address on
 * another site is used only once confirmed.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { Levels } from "../../resolver/order";
import type { SeoTabContext } from "../../tab/contract";
import { seoProblems } from "../../tab/problems";
import { SeoPanel } from "../SeoPanel";
import { panelAnswers, type SeoPanelValues } from "../values";

afterEach(cleanup);

const LEVELS: Levels = {
  page: {},
  code: {},
  template: {},
  pattern: {
    title: {
      value: "Surfer SEO vs Rext AI: Which Fits Your Workflow? | Rext AI",
      pattern: "{Title} | {Site name}",
    },
  },
  content: {
    title: {
      value: "Surfer SEO vs Rext AI: Which Fits Your Workflow?",
      field: "title",
    },
    description: {
      value: "Surfer SEO grades drafts; Rext AI writes them with sources.",
      field: "excerpt",
    },
  },
  site: { title: "Rext AI" },
  address: "/blog/surfer-seo-vs-rext-ai",
};

const CONTEXT: SeoTabContext = {
  levels: LEVELS,
  site: { name: "Rext AI", origin: "https://rext.ai", hosts: ["rext.ai"] },
  typeLabel: "Blog post",
  fieldLabels: { title: "Title", excerpt: "Excerpt" },
};

/** The panel over values it keeps, as the tab keeps them in the form. */
function Harness({
  initial = {},
  reloaded,
  onWrite,
}: {
  initial?: SeoPanelValues;
  /** Values the form is reset to from outside, as a reload does. */
  reloaded?: SeoPanelValues;
  onWrite?: (field: string, value: unknown) => void;
}): ReactNode {
  const [values, setValues] = useState<SeoPanelValues>(initial);
  const answers = useMemo(
    () => panelAnswers(CONTEXT, values, undefined),
    [values]
  );
  return (
    <>
      {reloaded === undefined ? null : (
        <button type="button" onClick={() => setValues(reloaded)}>
          Reload
        </button>
      )}
      <SeoPanel
        context={CONTEXT}
        status="ready"
        answers={answers}
        problems={answers === undefined ? [] : seoProblems(answers.answer)}
        values={values}
        chosenImage={undefined}
        writable
        onSet={(field, next) => {
          onWrite?.(field, next);
          setValues(was => ({ ...was, [field]: next }));
        }}
      />
    </>
  );
}

const titleField = () => screen.getByLabelText("Title on Google");
const searchTitle = () => screen.getByTestId("seo-search-title");

describe("the SEO panel at rest", () => {
  it("shows the preview and the two fields, with everything else closed under Advanced", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Google" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(titleField()).toBeVisible();
    expect(screen.getByLabelText("Description on Google")).toBeVisible();
    const advanced = screen.getByRole("button", { name: /Advanced/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("switch", { name: "Hide this page from search" })
    ).toBeNull();
  });

  it("shows each automatic value, its count and the level it came from", () => {
    render(<Harness />);
    expect(titleField()).toHaveValue("");
    expect(titleField()).toHaveAttribute(
      "placeholder",
      "Surfer SEO vs Rext AI: Which Fits Your Workflow? | Rext AI"
    );
    expect(screen.getByText("58 / 60")).toBeVisible();
    const titleSource = titleField().parentElement as HTMLElement;
    expect(titleSource).toHaveTextContent(
      "Automaticfrom the Blog post pattern {Title} | {Site name}"
    );
    const description = screen.getByLabelText("Description on Google");
    expect(description.parentElement).toHaveTextContent(
      "Automaticfrom the blog post's Excerpt"
    );
    expect(searchTitle()).toHaveTextContent(
      "Surfer SEO vs Rext AI: Which Fits Your Workflow? | Rext AI"
    );
    expect(
      screen.getByText("https://rext.ai › blog › surfer-seo-vs-rext-ai")
    ).toBeVisible();
  });
});

describe("typing in a field", () => {
  it("updates the preview as each key is typed, and offers one way back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(titleField(), "Surfer vs Rext");
    expect(searchTitle()).toHaveTextContent(/^Surfer vs Rext$/);
    expect(screen.getByText("14 / 60")).toBeVisible();
    expect(screen.getByText("Typed for this page")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Go back to automatic" })
    );
    expect(titleField()).toHaveValue("");
    expect(searchTitle()).toHaveTextContent(
      "Surfer SEO vs Rext AI: Which Fits Your Workflow? | Rext AI"
    );
    expect(screen.queryByText("Typed for this page")).toBeNull();
  });

  it("marks a count over what Google shows", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(titleField(), "x".repeat(61));
    expect(screen.getByText("61 / 60")).toHaveAttribute("data-over", "true");
  });

  it("shows the shared card with the same title until a different one is set", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "When shared" }));
    expect(screen.getByTestId("seo-share-title")).toHaveTextContent(
      "Surfer SEO vs Rext AI: Which Fits Your Workflow? | Rext AI"
    );
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("switch", { name: "Different title when shared" })
    );
    await user.type(screen.getByLabelText("Title when shared"), "Shared");
    expect(screen.getByTestId("seo-share-title")).toHaveTextContent(/^Shared$/);
  });
});

describe("Advanced", () => {
  it("hides the page from search with a real switch, and the preview says so", async () => {
    const user = userEvent.setup();
    const writes: [string, unknown][] = [];
    render(<Harness onWrite={(f, v) => writes.push([f, v])} />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("switch", { name: "Hide this page from search" })
    );
    expect(writes).toEqual([["noindex", true]]);
    expect(
      screen.getByText("Hidden from search: Google won't list this page")
    ).toBeVisible();
  });

  it("uses an address on another site only once the person confirms it", async () => {
    const user = userEvent.setup();
    const writes: [string, unknown][] = [];
    render(<Harness onWrite={(f, v) => writes.push([f, v])} />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByTestId("seo-official-address")).toHaveTextContent(
      "https://rext.ai/blog/surfer-seo-vs-rext-ai"
    );
    await user.click(
      screen.getByRole("button", { name: "Use another address" })
    );
    await user.type(
      screen.getByLabelText("Official address"),
      "https://medium.com/p/1"
    );
    const note = screen.getByText(/That address is on another site/)
      .parentElement as HTMLElement;
    expect(note).toHaveTextContent("medium.com");
    // Nothing stored yet: the page keeps its own address.
    expect(writes.slice(-2)).toEqual([
      ["canonical", null],
      ["canonicalElsewhere", null],
    ]);
    expect(screen.getByTestId("seo-search-result")).toHaveTextContent(
      "https://rext.ai › blog › surfer-seo-vs-rext-ai"
    );
    expect(
      screen.getByText(
        "Until you tick this, the automatic address stays in use."
      )
    ).toBeVisible();

    await user.click(within(note).getByRole("checkbox"));
    expect(writes.slice(-2)).toEqual([
      ["canonical", "https://medium.com/p/1"],
      ["canonicalElsewhere", true],
    ]);

    await user.click(
      screen.getByRole("button", { name: "Go back to automatic" })
    );
    expect(writes.slice(-2)).toEqual([
      ["canonical", null],
      ["canonicalElsewhere", null],
    ]);
  });

  it("shows the address the document holds after it is read again", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ canonical: "https://rext.ai/blog/first" }}
        reloaded={{
          canonical: "https://medium.com/p/2",
          canonicalElsewhere: true,
        }}
      />
    );
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    expect(screen.getByLabelText("Official address")).toHaveValue(
      "https://rext.ai/blog/first"
    );
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.getByLabelText("Official address")).toHaveValue(
      "https://medium.com/p/2"
    );
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("edits the shared description beside the shared title", async () => {
    const user = userEvent.setup();
    const writes: [string, unknown][] = [];
    render(<Harness onWrite={(f, v) => writes.push([f, v])} />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("switch", { name: "Different title when shared" })
    );
    await user.type(screen.getByLabelText("Description when shared"), "Card");
    expect(writes.at(-1)).toEqual(["socialDescription", "Card"]);
    await user.click(screen.getByRole("tab", { name: "When shared" }));
    expect(screen.getByTestId("seo-share-card")).toHaveTextContent("Card");
  });

  it("says why a typed address cannot be used", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("button", { name: "Use another address" })
    );
    await user.type(screen.getByLabelText("Official address"), "rext.ai/x");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the full address, starting with https://."
    );
  });
});
