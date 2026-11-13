// @vitest-environment jsdom
/**
 * How search results may show the page, under the SEO panel's Advanced
 * section, as a person uses it: the image preview size with the site's
 * default shown as automatic, the text under the link (a shorter limit that
 * refuses 0, and none with what it costs), the page's images in image
 * search, a date to drop from search, and the controls for other search
 * engines, off and closed away. The Google preview follows the choice.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
  pattern: {},
  content: {
    title: { value: "Pricing", field: "title" },
    description: {
      value: "Start free. Pay when your site grows.",
      field: "excerpt",
    },
  },
  site: { title: "Nextly", productionAddresses: ["https://nextlyhq.com"] },
  address: "/pricing",
};

const FIELDS = [
  "metaTitle",
  "metaDescription",
  "noindex",
  "maxImagePreview",
  "maxSnippet",
  "nosnippet",
  "noimageindex",
  "unavailableAfter",
  "noarchive",
  "nocache",
];

function contextWith(
  site: Partial<Levels["site"]> = {},
  fields: readonly string[] = FIELDS
): SeoTabContext {
  return {
    levels: { ...LEVELS, site: { ...LEVELS.site, ...site } },
    site: { name: "Nextly", origin: "https://nextlyhq.com" },
    typeLabel: "Page",
    fieldLabels: { title: "Title", excerpt: "Excerpt" },
    fields: [...fields],
    mayChange: true,
  };
}

/** The panel over values it keeps, recording each write. */
function Harness({
  initial = {},
  context = contextWith(),
  writes = [],
}: {
  initial?: SeoPanelValues;
  context?: SeoTabContext;
  writes?: [string, unknown][];
}): ReactNode {
  const [values, setValues] = useState<SeoPanelValues>(initial);
  const answers = useMemo(
    () => panelAnswers(context, values, undefined),
    [values, context]
  );
  return (
    <SeoPanel
      context={context}
      status="ready"
      answers={answers}
      problems={answers === undefined ? [] : seoProblems(answers.answer)}
      values={values}
      chosenImage={undefined}
      writable
      onSet={(field, next) => {
        writes.push([field, next]);
        setValues(was => ({ ...was, [field]: next }));
      }}
    />
  );
}

async function openAdvanced(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Advanced/ }));
  return user;
}

/** The radio chosen in the segmented choice named `name`, by its label. */
function chosenIn(name: string): string | null {
  const group = screen.getByRole("radiogroup", { name });
  const checked = within(group)
    .getAllByRole("radio")
    .find(radio => radio.getAttribute("aria-checked") === "true");
  return checked?.textContent ?? null;
}

/** The radio named `name` in the segmented choice named `group`. */
function radioIn(group: string, name: string): HTMLElement {
  return within(screen.getByRole("radiogroup", { name: group })).getByRole(
    "radio",
    { name }
  );
}

/** The row a control's label heads. */
function rowOf(label: string): HTMLElement {
  return screen.getByText(label, { selector: "div" }).parentElement
    ?.parentElement as HTMLElement;
}

describe("the image preview size", () => {
  it("shows the site's default, Large, as automatic, with where it is set", async () => {
    render(<Harness />);
    await openAdvanced();
    expect(
      screen.getByText("How search results may show this page")
    ).toBeVisible();
    expect(chosenIn("Image preview size")).toBe("Large");
    const row = rowOf("Image preview size");
    expect(within(row).getByText("Automatic")).toBeVisible();
    expect(
      within(row).getByRole("link", {
        name: "Settings › Search engines and AI",
      })
    ).toHaveAttribute(
      "href",
      "/admin/plugins/nextlyhq-plugin-seo/settings?tab=crawlers"
    );
  });

  it("is the page's own once another size is chosen, and goes back to the site's default", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} />);
    const user = await openAdvanced();
    await user.click(radioIn("Image preview size", "None"));
    expect(writes).toEqual([["maxImagePreview", "none"]]);
    expect(chosenIn("Image preview size")).toBe("None");
    const row = rowOf("Image preview size");
    expect(within(row).getByText("Set for this page")).toBeVisible();
    expect(
      within(row).getByText(
        "Google shows no picture from this page in results or in Discover."
      )
    ).toBeVisible();
    await user.click(
      within(row).getByRole("button", { name: "Go back to the site's default" })
    );
    expect(writes.at(-1)).toEqual(["maxImagePreview", null]);
    expect(chosenIn("Image preview size")).toBe("Large");
  });

  it("stores nothing for the size the site's default already gives", async () => {
    const writes: [string, unknown][] = [];
    render(
      <Harness writes={writes} initial={{ maxImagePreview: "standard" }} />
    );
    const user = await openAdvanced();
    await user.click(radioIn("Image preview size", "Large"));
    expect(writes).toEqual([["maxImagePreview", null]]);
  });

  it("chooses no size while the site's default is off, and stores Large as the page's own", async () => {
    const writes: [string, unknown][] = [];
    render(
      <Harness
        writes={writes}
        context={contextWith({ largeImagePreviews: false })}
      />
    );
    const user = await openAdvanced();
    expect(chosenIn("Image preview size")).toBeNull();
    await user.click(radioIn("Image preview size", "Large"));
    expect(writes).toEqual([["maxImagePreview", "large"]]);
  });
});

describe("the text under the link", () => {
  it("is any length by default", async () => {
    render(<Harness />);
    await openAdvanced();
    expect(chosenIn("Text under the link")).toBe("Any length");
  });

  it("takes a shorter limit in characters", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} />);
    const user = await openAdvanced();
    await user.click(radioIn("Text under the link", "Shorter"));
    await user.type(screen.getByLabelText("Characters at most"), "80");
    expect(writes.at(-1)).toEqual(["maxSnippet", 80]);
    expect(
      screen.getByText(
        "Google may still show less. Any length is right for most pages."
      )
    ).toBeVisible();
  });

  it("refuses 0 and points to None, so the warning about AI Overviews is seen", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} />);
    const user = await openAdvanced();
    await user.click(radioIn("Text under the link", "Shorter"));
    await user.type(screen.getByLabelText("Characters at most"), "0");
    expect(screen.getByLabelText("Characters at most")).toHaveAttribute(
      "aria-invalid",
      "true"
    );
    expect(
      screen.getByText(
        '0 means no text at all. Choose "None" for that, so the warning about AI Overviews shows.'
      )
    ).toBeVisible();
    expect(
      writes.filter(([field]) => field === "maxSnippet")
    ).not.toContainEqual(["maxSnippet", 0]);
  });

  it("says what None costs, and the Google preview shows no text", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} initial={{ maxSnippet: 80 }} />);
    const user = await openAdvanced();
    await user.click(radioIn("Text under the link", "None"));
    expect(writes).toEqual(
      expect.arrayContaining([
        ["nosnippet", true],
        ["maxSnippet", null],
      ])
    );
    const warning = screen.getByText(
      "No text will show under this page's link in any Google result."
    ).parentElement as HTMLElement;
    expect(warning).toHaveTextContent(
      "Google also won't use the page as a direct source in AI Overviews or AI Mode. The page itself stays in search."
    );
    expect(screen.getByTestId("seo-search-description")).toHaveTextContent(
      "No text under the link"
    );
  });
});

describe("the text under the link, where the group declares only one of its fields", () => {
  const options = () =>
    within(screen.getByRole("radiogroup", { name: "Text under the link" }))
      .getAllByRole("radio")
      .map(radio => radio.textContent);

  it("offers no None where the group has no nosnippet field", async () => {
    render(
      <Harness
        context={contextWith(
          {},
          FIELDS.filter(name => name !== "nosnippet")
        )}
      />
    );
    await openAdvanced();
    expect(options()).toEqual(["Any length", "Shorter"]);
  });

  it("offers no Shorter where the group has no maxSnippet field", async () => {
    render(
      <Harness
        context={contextWith(
          {},
          FIELDS.filter(name => name !== "maxSnippet")
        )}
      />
    );
    await openAdvanced();
    expect(options()).toEqual(["Any length", "None"]);
  });
});

describe("the page's images in image search", () => {
  it("are shown by default, and turning the switch off asks Google not to index them", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} />);
    const user = await openAdvanced();
    const images = screen.getByRole("switch", {
      name: "Show this page's images in image search",
    });
    expect(images).toHaveAttribute("aria-checked", "true");
    await user.click(images);
    expect(writes).toEqual([["noimageindex", true]]);
  });
});

describe("a date to drop from search", () => {
  it("is set as a time in UTC", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} />);
    const user = await openAdvanced();
    await user.click(screen.getByRole("button", { name: "Set a date" }));
    // As a date picker sets it: the whole value at once.
    fireEvent.change(screen.getByLabelText("Drop from search after"), {
      target: { value: "2099-12-31T23:59" },
    });
    expect(writes.at(-1)).toEqual([
      "unavailableAfter",
      "2099-12-31T23:59:00.000Z",
    ]);
    expect(
      screen.getByText(
        "Times are UTC. To take the page down, unpublish it instead."
      )
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove the date" }));
    expect(writes.at(-1)).toEqual(["unavailableAfter", null]);
  });

  it("says when the date has passed, and counts it on Advanced", async () => {
    render(
      <Harness initial={{ unavailableAfter: "2020-11-01T00:00:00.000Z" }} />
    );
    const advanced = screen.getByRole("button", { name: /Advanced/ });
    expect(advanced).toHaveTextContent("1");
    await openAdvanced();
    expect(
      screen.getByText(
        "That date has passed. Google may already have dropped the page. Remove the date to bring it back."
      )
    ).toBeVisible();
  });
});

describe("controls for other search engines", () => {
  it("are closed away and both off, and each is its own switch", async () => {
    const writes: [string, unknown][] = [];
    render(<Harness writes={writes} />);
    const user = await openAdvanced();
    const other = screen.getByRole("button", {
      name: /Controls for other search engines/,
    });
    expect(other).toHaveAttribute("aria-expanded", "false");
    expect(other).toHaveTextContent("Both off. Google ignores them.");
    await user.click(other);
    expect(
      screen.getByText(
        "Asks search engines not to keep a stored copy of this page. Google doesn't use it."
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        "A similar request some search engines read. Google doesn't use it."
      )
    ).toBeVisible();
    await user.click(screen.getByRole("switch", { name: "noarchive" }));
    expect(writes).toEqual([["noarchive", true]]);
    expect(other).toHaveTextContent("noarchive on");
    expect(screen.getByRole("switch", { name: "nocache" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("say nothing about Bing or Copilot", async () => {
    render(<Harness initial={{ noarchive: true, nocache: true }} />);
    const user = await openAdvanced();
    await user.click(
      screen.getByRole("button", { name: /Controls for other search engines/ })
    );
    expect(document.body.textContent).not.toMatch(/Bing|Copilot/);
  });
});
