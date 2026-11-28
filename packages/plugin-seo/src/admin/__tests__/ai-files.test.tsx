// @vitest-environment jsdom

/**
 * The AI files rows as a person uses them: the sections llms.txt lists,
 * from the preview's groups, renamed, moved, listed under Optional or left
 * out; the site's own sections of links, checked as they are typed; what
 * llms-full.txt holds; and what a save of the choices sends.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiFilesPreviewBody } from "../../settings/ai-files";
import { AiFilesRows, orderedGroups, withGroup, withMoved } from "../ai-files";
import { changesOf, draftOf, type SettingsDraft } from "../settings-draft";

const asked = vi.hoisted(() => ({ bodies: [] as unknown[] }));

const PREVIEW: AiFilesPreviewBody = {
  groups: [
    { key: "posts", defaultHeading: "Blog posts", pages: 2 },
    { key: "code:docs", defaultHeading: "Docs", pages: 5 },
    { key: "single:home", defaultHeading: "Pages", pages: 1 },
  ],
  preview: "# Acme\n\n## Blog posts",
  lines: 3,
};

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  writePluginRoute: async ({ body }: { body: unknown }) => {
    asked.bodies.push(body);
    return PREVIEW;
  },
}));

beforeEach(() => {
  asked.bodies = [];
});
afterEach(() => {
  vi.clearAllMocks();
});

/** The draft the rows last reported. */
let latest: SettingsDraft;

function Rows({
  stored = {},
}: {
  stored?: Record<string, unknown>;
}): JSX.Element {
  const [draft, setDraft] = useState(() => draftOf({ id: "s1", ...stored }));
  latest = draft;
  return (
    <>
      <AiFilesRows
        draft={draft}
        change={next => setDraft(current => next(current))}
        host="acme.example"
      />
      {/* What the settings page's Cancel does: the draft made again from
          what is stored, the rows left mounted. */}
      <button
        type="button"
        onClick={() => setDraft(draftOf({ id: "s1", ...stored }))}
      >
        Cancel the draft
      </button>
    </>
  );
}

const sections = () =>
  screen.findByRole("list", { name: "Sections of llms.txt" });

describe("the AI files rows", () => {
  it("lists the preview's sections, and renames, moves, lists under Optional and leaves one out", async () => {
    render(<Rows />);
    const list = await sections();
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    fireEvent.change(within(list).getByLabelText("Heading for Docs"), {
      target: { value: "Guides" },
    });
    fireEvent.click(
      within(list).getByRole("button", { name: "Move Guides up" })
    );
    fireEvent.click(
      within(within(list).getAllByRole("listitem")[2] as HTMLElement).getByRole(
        "checkbox",
        { name: /Optional/ }
      )
    );
    fireEvent.click(
      within(within(list).getAllByRole("listitem")[1] as HTMLElement).getByRole(
        "checkbox",
        { name: /Leave out/ }
      )
    );
    expect(latest.aiFiles.groups).toEqual([
      { key: "code:docs", heading: "Guides" },
      { key: "posts", leftOut: true },
      { key: "single:home", optional: true },
    ]);
    // A save sends the choices as they are stored.
    expect(changesOf({ id: "s1" }, latest)?.aiFiles).toEqual({
      groups: [
        { key: "code:docs", heading: "Guides" },
        { key: "posts", leftOut: true },
        { key: "single:home", optional: true },
      ],
    });
  });

  it("says what is wrong with a section of links as it is typed, and holds the preview until it is fixed", async () => {
    render(<Rows />);
    await sections();
    fireEvent.click(screen.getByRole("button", { name: /Add a section/ }));
    fireEvent.change(screen.getByLabelText("Heading of section 1"), {
      target: { value: "Docs" },
    });
    fireEvent.change(screen.getByLabelText("Links of section 1"), {
      target: { value: "not a link" },
    });
    expect(screen.getByText(/is not a link/)).toBeTruthy();
    const before = asked.bodies.length;
    fireEvent.click(screen.getByRole("button", { name: "Preview again" }));
    expect(asked.bodies.length).toBe(before);
    expect(screen.getByText("Fix the choices above to preview.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Links of section 1"), {
      target: { value: "- [API](https://api.acme.example)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview again" }));
    expect(asked.bodies.at(-1)).toEqual({
      aiFiles: {
        extraSections: [
          { heading: "Docs", links: "- [API](https://api.acme.example)" },
        ],
      },
    });
  });

  it("narrows llms-full.txt to addresses typed one a line", async () => {
    render(<Rows />);
    await sections();
    fireEvent.click(screen.getByRole("radio", { name: "Some addresses" }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Addresses llms-full.txt holds",
      }),
      {
        target: { value: "/docs/\n\n/guides/" },
      }
    );
    expect(latest.aiFiles.fullContents).toEqual({
      include: "addresses",
      prefixes: ["/docs/", "/guides/"],
    });
  });
});

describe("the rows, kept true to the draft", () => {
  it("keeps the sections to fix when a later preview is held up by one of them", async () => {
    render(<Rows />);
    const list = await sections();
    fireEvent.change(within(list).getByLabelText("Heading for Docs"), {
      target: { value: "# Docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview again" }));
    expect(screen.getByText("Fix the choices above to preview.")).toBeTruthy();
    // The heading that holds it up is still there to fix.
    expect(
      screen.getByRole("list", { name: "Sections of llms.txt" })
    ).toBeTruthy();
    expect(screen.getByLabelText("Heading for Docs")).toHaveProperty(
      "value",
      "# Docs"
    );
  });

  it("shows the saved folders and addresses again once the draft is cancelled", async () => {
    render(
      <Rows
        stored={{
          aiFiles: {
            folderFiles: ["docs"],
            fullContents: { include: "addresses", prefixes: ["/docs/"] },
          },
        }}
      />
    );
    await sections();
    const folders = screen.getByRole("textbox", {
      name: "Folders with their own files",
    });
    const prefixes = screen.getByRole("textbox", {
      name: "Addresses llms-full.txt holds",
    });
    fireEvent.change(folders, { target: { value: "docs\nguides" } });
    fireEvent.change(prefixes, { target: { value: "/guides/" } });
    expect(latest.aiFiles.folderFiles).toEqual(["docs", "guides"]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel the draft" }));
    expect(latest.aiFiles.folderFiles).toEqual(["docs"]);
    expect(folders).toHaveProperty("value", "docs");
    expect(prefixes).toHaveProperty("value", "/docs/");
  });
});

describe("the sections' order", () => {
  const listed = PREVIEW.groups;

  it("is the site's placed groups first, then the rest as listed, keeping a placed group with no pages now", () => {
    expect(
      orderedGroups(
        { groups: [{ key: "single:home" }, { key: "gone" }] },
        listed
      ).map(group => group.key)
    ).toEqual(["single:home", "gone", "posts", "code:docs"]);
  });

  it("places every group shown when one is moved or changed, so the order is kept", () => {
    const shown = orderedGroups({}, listed);
    expect(withMoved({}, shown, 2, 0).groups).toEqual([
      { key: "single:home" },
      { key: "posts" },
      { key: "code:docs" },
    ]);
    expect(
      withGroup({}, shown, "posts", group => ({ ...group, optional: true }))
        .groups
    ).toEqual([
      { key: "posts", optional: true },
      { key: "code:docs" },
      { key: "single:home" },
    ]);
  });
});
