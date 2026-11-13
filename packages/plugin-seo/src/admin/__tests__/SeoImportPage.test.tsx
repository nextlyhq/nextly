// @vitest-environment jsdom

/**
 * Import as a person uses it: this site's field group first, matched field
 * by field with an example of each, values a page's own code overrides
 * skipped as never served unless included, the dry run's counts and each
 * page's result, then the import applied, or refused with nothing written;
 * and a file from another tool, read and summed up, or refused with one
 * notice. What each request sends is read from the request itself.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  navigateTo: vi.fn(),
}));

import { usePluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type {
  DryRunBody,
  ImportGroup,
  ImportReportEntry,
} from "../../import/contract";
import { SeoImportPage } from "../SeoImportPage";

const OLD: ImportGroup = {
  field: "seo-old",
  label: "SEO (old)",
  types: [
    { slug: "posts", label: "Posts" },
    { slug: "single:home", label: "Home" },
    { slug: "single:changelog", label: "Changelog" },
  ],
  pages: 9,
  withText: 7,
  own: false,
  fields: [
    {
      name: "metaTitle",
      label: "Meta title",
      filled: 6,
      suggested: "title",
      example: "Nextly pricing",
    },
    {
      name: "metaDescription",
      label: "Meta description",
      filled: 5,
      suggested: "description",
      example: "Free and open source.",
    },
  ],
};
const OTHER: ImportGroup = {
  ...OLD,
  field: "meta-data",
  label: "Search and sharing",
  withText: 2,
};

/** A page's report entry. */
function entry(more: Partial<ImportReportEntry>): ImportReportEntry {
  return {
    type: "pages",
    id: more.label ?? "p",
    label: "Page",
    outcome: "set",
    set: [],
    same: [],
    kept: [],
    neverServed: [],
    values: {},
    ...more,
  };
}

/** The dry run the fake engine answers, with or without never-served values. */
function dryRun(include: boolean): DryRunBody {
  const changelog = include
    ? entry({
        label: "Changelog",
        set: ["title"],
        values: { title: "Old changelog" },
      })
    : entry({
        label: "Changelog",
        outcome: "skipped",
        neverServed: ["title"],
        values: { title: "Old changelog" },
        reason: "Never served",
      });
  return {
    checked: 9,
    fromFile: false,
    held: 7,
    lines: [],
    pages: include ? 2 : 1,
    versions: include ? 2 : 1,
    same: 0,
    kept: 0,
    neverServed: include ? 0 : 1,
    redirects: 0,
    left: [],
    warnings: [],
    documents: [
      entry({
        label: "Pricing",
        set: ["title", "description"],
        values: { title: "Nextly pricing", description: "Free" },
      }),
      changelog,
    ],
    plan: include ? "plan-included" : "plan",
  };
}

/** Every request the screen sent, by path, with its body. */
let sent: { path: string; body: Record<string, unknown> }[];
/** How the fake engine answers an apply. */
let applying: () => Promise<unknown>;
/** Whether the fake engine refuses a dry run. */
let refusingDryRuns = false;

beforeEach(() => {
  sent = [];
  refusingDryRuns = false;
  applying = () =>
    Promise.resolve({ message: "Imported", pages: 1, redirects: 0 });
  vi.mocked(usePluginRoute).mockImplementation(
    () =>
      ({
        data: {
          groups: [OLD, OTHER],
          ownSeo: [{ slug: "posts", label: "Posts", definedIn: "code" }],
          language: "en",
        },
        pending: false,
        error: null,
        refetch: () => {},
        fetching: false,
      }) as ReturnType<typeof usePluginRoute>
  );
  vi.mocked(writePluginRoute).mockImplementation(async request => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    sent.push({ path: request.path, body });
    if (request.path.endsWith("/apply")) return applying();
    if (refusingDryRuns) {
      throw Object.assign(new Error("The database didn't answer."), {
        status: 500,
      });
    }
    const source = body.source as {
      kind: string;
      parsed?: { records?: { values?: Record<string, unknown> }[] };
    };
    if (source.kind !== "group") {
      // Counted from the records the file sent, as the engine counts them.
      const records = source.parsed?.records ?? [];
      return {
        ...dryRun(false),
        fromFile: true,
        checked: records.length,
        held: records.filter(each => Object.keys(each.values ?? {}).length > 0)
          .length,
      };
    }
    return dryRun(body.includeNeverServed === true);
  });
});

/** Waits for the requests on their way. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

const dryRuns = () => sent.filter(each => each.path.endsWith("/dry-run"));

/**
 * The admin's table as wide screens show it: it draws its rows as cards for
 * a phone as well, so each value is found in the table alone.
 */
const table = () => screen.getByRole("table");

describe("importing this site's own field group", () => {
  it("offers the group first, with what it holds, and another group beside it", () => {
    render(<SeoImportPage />);
    expect(
      screen.getByRole("heading", { name: "Import SEO values" })
    ).toBeTruthy();
    const group = screen.getByRole("radio", { name: /SEO \(old\)/ });
    expect(group.closest("label")?.textContent).toContain(
      "A field group on Posts and 2 Singles. 7 pages have a title or description in it."
    );
    expect(
      screen.getByRole("radio", { name: /Another field group/ })
    ).toBeTruthy();
    // The first step is current, on the admin's stepper.
    expect(
      screen
        .getByRole("list", { name: "Steps" })
        .querySelector('[aria-current="step"]')?.textContent
    ).toContain("Choose the source");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("matches each field with an example, skips never-served values unless included, and imports", async () => {
    const user = userEvent.setup();
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();

    // Each field, an example of it, where it goes, and how many hold one.
    expect(screen.getByText("Field in SEO (old)")).toBeTruthy();
    expect(screen.getAllByText("Nextly pricing").length).toBeGreaterThan(0);
    expect(
      within(table()).getByRole("combobox", { name: "Where Meta title goes" })
        .textContent
    ).toBe("Title on Google");
    expect(dryRuns().at(-1)?.body).toEqual({
      source: {
        kind: "group",
        field: "seo-old",
        map: { metaTitle: "title", metaDescription: "description" },
      },
    });
    expect(
      screen.getByText(
        "1 page's values are never served, so they'll be skipped"
      )
    ).toBeTruthy();

    // A field left out is tried again at once.
    await user.click(
      within(table()).getByRole("combobox", {
        name: "Where Meta description goes",
      })
    );
    await user.click(
      await screen.findByRole("option", { name: "Don't import" })
    );
    await settle();
    expect(
      (dryRuns().at(-1)?.body.source as { map: Record<string, string> }).map
    ).toEqual({ metaTitle: "title", metaDescription: "skip" });

    // Included anyway, the dry run is asked to include them.
    fireEvent.click(screen.getByRole("checkbox", { name: "Include anyway" }));
    await settle();
    expect(dryRuns().at(-1)?.body.includeNeverServed).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    // The counts in values, and each page's result.
    const set = screen.getByText("on 2 pages").parentElement;
    expect(set?.textContent).toContain("Will set");
    expect(set?.textContent).toContain("3 values");
    const pricing = within(table())
      .getByText("Pricing")
      .closest("tr") as HTMLElement;
    expect(within(pricing).getAllByText("Will set")).toHaveLength(2);
    // Each page opens on its SEO tab in a new tab, the dry run kept here.
    const opens = within(pricing).getByRole("link", { name: /^Pricing/ });
    expect(opens.getAttribute("href")).toBe(
      "/admin/collections/pages/Pricing?tab=nextlyhq-plugin-seo.tab"
    );
    expect(opens.getAttribute("target")).toBe("_blank");

    fireEvent.click(screen.getByRole("button", { name: "Import 3 values" }));
    await settle();
    expect(sent.at(-1)).toEqual({
      path: "/import/apply",
      body: {
        source: {
          kind: "group",
          field: "seo-old",
          map: { metaTitle: "title", metaDescription: "skip" },
        },
        plan: "plan-included",
        includeNeverServed: true,
      },
    });
    expect(screen.getByText("3 values imported on 2 pages")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See the pages" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download the report" })
    ).toBeTruthy();
  });

  it("offers no earlier result to import once checking the import again fails", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    expect(
      screen.getByRole("button", { name: /^Import \d+ values?$/ })
    ).toBeTruthy();

    // Back, and checked again: this time the check fails.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await settle();
    refusingDryRuns = true;
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    expect(screen.getByText("The database didn't answer.")).toBeTruthy();
    expect(screen.queryAllByText("Will set")).toHaveLength(0);
    // Nothing to import until a check answers.
    expect(
      screen.getByRole("button", { name: /^Import \d+ values?$/ })
    ).toHaveProperty("disabled", true);
  });

  it("says nothing was imported when the import stops part-way, and tries again", async () => {
    // The server answered: it refused, and wrote nothing.
    applying = () =>
      Promise.reject(
        Object.assign(new Error("The database didn't answer."), {
          status: 500,
        })
      );
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 values" }));
    await settle();

    expect(screen.getByText("Nothing was imported")).toBeTruthy();
    expect(
      screen.getByText(/so every page was left exactly as it was/).textContent
    ).toContain("The database didn't answer");
    const before = dryRuns().length;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await settle();
    expect(dryRuns().length).toBe(before + 1);
    expect(
      screen.getByRole("button", { name: "Import 2 values" })
    ).toBeTruthy();
  });

  it("gives each language and draft of a page its own row, each value with its own result", async () => {
    vi.mocked(writePluginRoute).mockImplementation(async request => {
      sent.push({
        path: request.path,
        body: (request.body ?? {}) as Record<string, unknown>,
      });
      const versioned = (more: Partial<ImportReportEntry>): ImportReportEntry =>
        entry({
          id: "pricing",
          values: { title: "Plans", description: "Costs" },
          ...more,
        });
      return {
        ...dryRun(false),
        pages: 1,
        versions: 3,
        documents: [
          versioned({
            label: "Pricing",
            locale: "en",
            language: "English",
            version: "published",
            set: ["title", "description"],
          }),
          versioned({
            label: "Pricing (new)",
            locale: "en",
            language: "English",
            version: "draft",
            set: ["title"],
            kept: ["description"],
          }),
          versioned({
            label: "Preise",
            locale: "de",
            language: "Deutsch",
            version: "published",
            same: ["title"],
            set: ["description"],
          }),
        ],
      };
    });
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();

    expect(
      within(table()).getByRole("columnheader", { name: "Version" })
    ).toBeTruthy();
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringMatching(
        /^Pricing.*English · published.*Will set.*Will set/
      ),
      expect.stringMatching(/English · draft.*Will set.*Kept/),
      expect.stringMatching(/Deutsch · published.*Same as automatic.*Will set/),
    ]);
    // Named once on screen, and on each row for a screen reader.
    expect(within(table()).getAllByText("Pricing")).toHaveLength(1);
    expect(
      within(rows[1] as HTMLElement).getByText("Pricing (new)").className
    ).toBe("sr-only");
  });

  it("shows no version column where each page has one version", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    expect(
      within(table()).queryByRole("columnheader", { name: "Version" })
    ).toBeNull();
  });

  it("says part of the import may be in place when a Single couldn't be put back", async () => {
    applying = () =>
      Promise.reject(
        Object.assign(
          new Error(
            "The import stopped part-way, and a Single it had written could not be put back."
          ),
          { status: 500, code: "SEO_IMPORT_PARTLY_APPLIED" }
        )
      );
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 values" }));
    await settle();

    expect(screen.queryByText("Nothing was imported")).toBeNull();
    expect(screen.getByText("Part of the import may be in place")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("says how to import a type's own seo field, which the plugin can't rename in code", () => {
    render(<SeoImportPage />);
    expect(
      screen.getByText('Posts have a field of their own called "seo".')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "How to import it" }));
    const dialog = screen.getByRole("dialog", {
      name: 'Import the Posts\' own "seo" field',
    });
    // Renamed alone, the type still has no SEO: it is added to the plugin's
    // collections too, so its renamed field is offered here.
    expect(dialog.textContent).toContain(
      "It is defined in the site's code, so Nextly can't replace it from here. In the code, rename it, for example to legacySeo, add Posts to the SEO plugin's collections, and deploy."
    );
    // Nothing to confirm: the rename is the person's, in the site's code.
    expect(
      within(dialog).queryByRole("button", { name: /Replace/ })
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains the plugin's own group from an earlier version, with nothing to match", async () => {
    vi.mocked(usePluginRoute).mockImplementation(
      () =>
        ({
          data: {
            groups: [{ ...OLD, field: "seo", label: "SEO", own: true }],
            ownSeo: [],
            language: "en",
          },
          pending: false,
          error: null,
          refetch: () => {},
          fetching: false,
        }) as ReturnType<typeof usePluginRoute>
    );
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /^SEO/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    expect(screen.getByText(/become\s+automatic again/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says it couldn't confirm an import whose answer never arrived, and checks again", async () => {
    // No answer at all: the import may or may not have been written.
    applying = () => Promise.reject(new TypeError("Failed to fetch"));
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 values" }));
    await settle();
    expect(screen.getByText("The import's answer didn't arrive")).toBeTruthy();
    expect(screen.queryByText("Nothing was imported")).toBeNull();
    const before = dryRuns().length;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await settle();
    expect(dryRuns().length).toBe(before + 1);
  });

  it("offers no way back on the stepper while an import is applied", async () => {
    let finish = (_: unknown) => {};
    applying = () =>
      new Promise(resolve => {
        finish = resolve;
      });
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /SEO \(old\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 values" }));
    await settle();
    const steps = screen.getByRole("list", { name: "Steps" });
    expect(within(steps).queryAllByRole("button")).toHaveLength(0);
    finish({ message: "", pages: 1, redirects: 0 });
    await settle();
    expect(screen.getByText("2 values imported on 1 page")).toBeTruthy();
  });

  it("matches another group, chosen from the site's groups", async () => {
    const user = userEvent.setup();
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /Another field group/ }));
    await user.click(screen.getByRole("combobox", { name: "Field group" }));
    await user.click(
      await screen.findByRole("option", { name: "Search and sharing" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    expect(screen.getByText("Field in Search and sharing")).toBeTruthy();
    expect((dryRuns().at(-1)?.body.source as { field: string }).field).toBe(
      "meta-data"
    );
  });
});

describe("importing a file another tool exported", () => {
  /** Chooses `text` as the file, named `name`. */
  async function choose(name: string, text: string): Promise<void> {
    // The chooser's own filter is the browser's: the screen judges the file.
    const user = userEvent.setup({ applyAccept: false });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await user.upload(input, new File([text], name));
    await settle();
  }

  /** A WordPress export of one post holding Yoast's title. */
  const WXR = `<?xml version="1.0"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/"><channel>
<item><title><![CDATA[Pricing]]></title><link>https://old.example/pricing/</link>
<wp:post_name><![CDATA[pricing]]></wp:post_name><wp:status><![CDATA[publish]]></wp:status>
<wp:post_type><![CDATA[page]]></wp:post_type><content:encoded><![CDATA[${"A long page. ".repeat(500)}]]></content:encoded>
<wp:postmeta><wp:meta_key><![CDATA[_yoast_wpseo_title]]></wp:meta_key><wp:meta_value><![CDATA[Nextly pricing]]></wp:meta_value></wp:postmeta>
</item></channel></rss>`;

  it("reads a WordPress export and says what it holds, with a way to another file", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /WordPress/ }));
    expect(screen.getByText("Your WordPress export file")).toBeTruthy();
    expect(
      screen.getByText(/up to 50 MB. Nextly reads it once and doesn't keep it./)
    ).toBeTruthy();

    await choose("acme.WordPress.xml", WXR);
    // Read here: only what the file holds for each page is sent, never the
    // file, whose page content is most of it.
    const sentSource = dryRuns().at(-1)?.body.source as {
      kind: string;
      tool: string;
      fileName: string;
      parsed: { records: { label: string; values: unknown }[] };
    };
    expect(sentSource).toMatchObject({
      kind: "records",
      tool: "yoast",
      fileName: "acme.WordPress.xml",
    });
    expect(sentSource.parsed.records).toEqual([
      expect.objectContaining({
        label: "Pricing",
        values: { title: "Nextly pricing" },
      }),
    ]);
    expect(JSON.stringify(sentSource)).not.toContain("A long page.");
    expect(screen.getByText("acme.WordPress.xml")).toBeTruthy();
    expect(
      screen.getByText(
        "1 post or page read. 1 has Yoast or Rank Math values. Next, match them to your pages."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      false
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Choose another file" })
    );
    expect(screen.queryByText("acme.WordPress.xml")).toBeNull();
  });

  it("imports a file that only adds redirects", async () => {
    vi.mocked(writePluginRoute).mockImplementation(async request => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      sent.push({ path: request.path, body });
      if (request.path.endsWith("/apply"))
        return { message: "", pages: 0, redirects: 2 };
      return { ...dryRun(false), documents: [], held: 0, redirects: 2 };
    });
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /Rank Math CSV/ }));
    await choose("redirects.csv", "id,seo_title,redirect_to\n1,,/new");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Check the result" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 redirects" }));
    await settle();
    expect(sent.at(-1)?.path).toBe("/import/apply");
    expect(screen.getByText(/2 redirects added/)).toBeTruthy();
  });

  it("reads no file until the site's language is known", async () => {
    vi.mocked(usePluginRoute).mockImplementation(
      () =>
        ({
          data: undefined,
          pending: true,
          error: null,
          refetch: () => {},
          fetching: true,
        }) as ReturnType<typeof usePluginRoute>
    );
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /Payload/ }));
    await choose("export.json", '{"docs":[{"id":1,"meta":{"title":"T"}}]}');
    expect(dryRuns()).toHaveLength(0);
  });

  it("refuses a file that isn't the tool's export, without sending it", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /WordPress/ }));
    await choose("notes.txt", "just some notes");
    expect(screen.getByText("This isn't a WordPress export file")).toBeTruthy();
    expect(dryRuns()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Continue" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("says a file with no SEO values in it holds none", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /WordPress/ }));
    // An export of a page with no Yoast or Rank Math value in it.
    await choose(
      "empty.xml",
      WXR.replace(/<wp:postmeta>.*<\/wp:postmeta>\n/, "")
    );
    expect(
      screen.getByText("There are no SEO values in this file")
    ).toBeTruthy();
  });

  it("says, in the reader's words, why a file it refuses can't be imported", async () => {
    render(<SeoImportPage />);
    fireEvent.click(screen.getByRole("radio", { name: /Payload/ }));
    await choose("export.json", '{"docs":[]}');
    expect(screen.getByText("This file can't be imported")).toBeTruthy();
    expect(
      screen.getByText("This Payload export holds no documents.")
    ).toBeTruthy();
    expect(dryRuns()).toHaveLength(0);
  });
});
