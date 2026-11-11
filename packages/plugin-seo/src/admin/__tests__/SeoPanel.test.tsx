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
import {
  panelAnswers,
  type SeoPanelField,
  type SeoPanelValues,
} from "../values";

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
  site: { title: "Rext AI", productionAddresses: ["https://rext.ai"] },
  address: "/blog/surfer-seo-vs-rext-ai",
};

const CONTEXT: SeoTabContext = {
  levels: LEVELS,
  site: { name: "Rext AI", origin: "https://rext.ai" },
  typeLabel: "Blog post",
  fieldLabels: { title: "Title", excerpt: "Excerpt" },
  fields: [
    "metaTitle",
    "metaDescription",
    "socialTitle",
    "socialDescription",
    "ogImage",
    "canonical",
    "noindex",
    "structuredDataType",
  ],
  structuredData: {
    type: { key: "article", label: "Article" },
    chosen: "type",
    automatic: { key: "article", label: "Article" },
    offered: [
      { key: "article", label: "Article" },
      { key: "webPage", label: "Web page" },
    ],
    problems: [
      {
        message: "Missing: author.",
        fix: "content",
        field: { name: "author", label: "Author" },
      },
    ],
    details: ["Author", "Date published", "Image"],
  },
};

/** The panel over values it keeps, as the tab keeps them in the form. */
function Harness({
  initial = {},
  reloaded,
  onWrite,
  context = CONTEXT,
  documentKey,
  errors,
  onMakeShareImage,
  onGoToField,
}: {
  /** Makes a share image; the harness sets the id it answers as the page's. */
  onMakeShareImage?: () => Promise<string | undefined>;
  onGoToField?: (field: string) => void;
  context?: SeoTabContext;
  documentKey?: string;
  errors?: Partial<Record<SeoPanelField, string>>;
  initial?: SeoPanelValues;
  /** Values the form is reset to from outside, as a reload does. */
  reloaded?: SeoPanelValues;
  onWrite?: (field: string, value: unknown) => void;
}): ReactNode {
  const [values, setValues] = useState<SeoPanelValues>(initial);
  const answers = useMemo(
    () => panelAnswers(context, values, undefined),
    [values, context]
  );
  return (
    <>
      {reloaded === undefined ? null : (
        <button type="button" onClick={() => setValues(reloaded)}>
          Reload
        </button>
      )}
      <SeoPanel
        context={context}
        status="ready"
        answers={answers}
        problems={
          answers === undefined
            ? []
            : seoProblems(answers.answer, {
                structuredData: context.structuredData,
                shareImage: context.shareImage,
              })
        }
        values={values}
        chosenImage={undefined}
        writable
        {...(documentKey === undefined ? {} : { documentKey })}
        {...(errors === undefined ? {} : { errors })}
        onMakeShareImage={
          onMakeShareImage &&
          (async () => {
            const id = await onMakeShareImage();
            if (id !== undefined) setValues(was => ({ ...was, ogImage: id }));
            return id;
          })
        }
        onGoToField={onGoToField}
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

  it("reads a stored address elsewhere as confirmed, where the group keeps no mark", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ canonical: "https://medium.com/p/2" }} />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
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

  it("offers the structured data type, automatic first, and says what is missing", async () => {
    const user = userEvent.setup();
    const writes: [string, unknown][] = [];
    render(<Harness onWrite={(f, v) => writes.push([f, v])} />);
    const advanced = screen.getByRole("button", { name: /Advanced/ });
    // Its problem is counted on Advanced, where it is fixed.
    expect(advanced).toHaveTextContent("structured data1");
    await user.click(advanced);
    const type = screen.getByRole("combobox", { name: "Structured data type" });
    expect(type).toHaveValue("");
    expect(
      within(type)
        .getAllByRole("option")
        .map(option => option.textContent)
    ).toEqual(["Article · automatic", "Article", "Web page"]);
    expect(screen.getByText("Missing: author.")).toBeVisible();
    await user.selectOptions(type, "webPage");
    expect(writes.at(-1)).toEqual(["structuredDataType", "webPage"]);
  });

  it("offers no control for a field the group does not declare", () => {
    const { structuredData: _none, ...rest } = CONTEXT;
    render(
      <Harness
        context={{ ...rest, fields: ["metaTitle", "metaDescription"] }}
      />
    );
    expect(screen.queryByRole("button", { name: /Advanced/ })).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Hide this page from search" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Use another address" })
    ).toBeNull();
    expect(screen.queryByText("Share image")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Structured data type" })
    ).toBeNull();
  });

  it("lets go of an unfinished address when another document or language is shown", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness documentKey="posts:1:en" />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("button", { name: "Use another address" })
    );
    await user.type(
      screen.getByLabelText("Official address"),
      "https://medium.com/p/1"
    );
    rerender(<Harness documentKey="posts:1:es" />);
    expect(screen.queryByLabelText("Official address")).toBeNull();
  });

  it("opens Advanced on a value refused at save, and says why beside it", () => {
    render(<Harness errors={{ canonical: "Enter a valid address." }} />);
    expect(screen.getByRole("button", { name: /Advanced/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid address."
    );
  });

  it("opens the content at the field structured data lacks", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    render(<Harness onGoToField={field => opened.push(field)} />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("button", { name: "Add an author on the Content tab" })
    );
    expect(opened).toEqual(["author"]);
  });

  it("says what keeps the share image from showing, and makes one of the right size", async () => {
    const user = userEvent.setup();
    const imaged: SeoTabContext = {
      ...CONTEXT,
      levels: {
        ...LEVELS,
        content: {
          ...LEVELS.content,
          image: {
            value: { url: "/media/cover.webp", width: 800, height: 600 },
            field: "coverImage",
          },
        },
      },
      fieldLabels: { ...CONTEXT.fieldLabels, coverImage: "Cover image" },
      shareImage: {
        problems: [
          { message: "800 × 600, LinkedIn will crop it", fix: "make" },
        ],
      },
    };
    let made = 0;
    render(
      <Harness
        context={imaged}
        onMakeShareImage={() => {
          made += 1;
          return Promise.resolve(undefined);
        }}
      />
    );
    const advanced = screen.getByRole("button", { name: /Advanced/ });
    // The share image's problem and structured data's are both in Advanced.
    expect(advanced).toHaveTextContent("structured data2");
    await user.click(advanced);
    expect(
      screen.getByText("1 thing to fix: 800 × 600, LinkedIn will crop it.")
    ).toBeVisible();
    expect(screen.getByText("800 × 600")).toBeVisible();
    expect(
      screen.getAllByText(/from the blog post's/).map(line => line.textContent)
    ).toContain("from the blog post's Cover image");
    await user.click(
      screen.getByRole("button", { name: "Make a share image" })
    );
    expect(made).toBe(1);
  });

  it("says a share image was made only while it is the page's image", async () => {
    const user = userEvent.setup();
    const imaged: SeoTabContext = {
      ...CONTEXT,
      levels: {
        ...LEVELS,
        content: {
          ...LEVELS.content,
          image: {
            value: { url: "/media/cover.webp", width: 800, height: 600 },
            field: "coverImage",
          },
        },
      },
      shareImage: {
        problems: [
          { message: "800 × 600, LinkedIn will crop it", fix: "make" },
        ],
      },
    };
    render(
      <Harness
        context={imaged}
        reloaded={{ ogImage: "chosen-2" }}
        onMakeShareImage={() => Promise.resolve("made-1")}
      />
    );
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("button", { name: "Make a share image" })
    );
    expect(await screen.findByText(/Made a 1200 × 630 copy/)).toBeVisible();
    expect(screen.getByText("Made for this page")).toBeVisible();

    // Another image chosen: it was not made here, and its problems show.
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(screen.queryByText(/Made a 1200 × 630 copy/)).toBeNull();
    expect(screen.getByText("Chosen for this page")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Make a share image" })
    ).toBeVisible();
  });

  it("says a page hidden with its whole type stays hidden, and locks its switch", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        context={{ ...CONTEXT, levels: { ...LEVELS, typeHidden: true } }}
      />
    );
    expect(
      screen.getByText("Every blog post page is hidden from search.")
    ).toBeVisible();
    expect(
      screen.getByText("Hidden from search: Google won't list this page")
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    const hide = screen.getByRole("switch", {
      name: "Hide this page from search",
    });
    expect(hide).toBeChecked();
    expect(hide).toBeDisabled();
    expect(
      screen.getByText(/On for every blog post page, so this switch/)
    ).toBeVisible();
  });

  it("judges a typed address against the site's production addresses", async () => {
    const user = userEvent.setup();
    const writes: [string, unknown][] = [];
    render(<Harness onWrite={(f, v) => writes.push([f, v])} />);
    await user.click(screen.getByRole("button", { name: /Advanced/ }));
    await user.click(
      screen.getByRole("button", { name: "Use another address" })
    );
    // On the production address: stored at once, nothing to confirm.
    await user.type(
      screen.getByLabelText("Official address"),
      "https://rext.ai/blog/first"
    );
    expect(screen.queryByText(/That address is on another site/)).toBeNull();
    expect(writes.slice(-2)).toEqual([
      ["canonical", "https://rext.ai/blog/first"],
      ["canonicalElsewhere", null],
    ]);
    // The same host without https is another origin, so it is asked about.
    await user.clear(screen.getByLabelText("Official address"));
    await user.type(
      screen.getByLabelText("Official address"),
      "http://rext.ai/blog/first"
    );
    expect(screen.getByText(/That address is on another site/)).toBeVisible();
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
