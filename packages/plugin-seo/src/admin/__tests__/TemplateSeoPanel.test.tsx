// @vitest-environment jsdom
/**
 * A template's SEO panel as a person uses it: the stored rule read as text
 * with variables, a change stored as the design's own metadata when the field
 * is left, a variable added where the person was typing, the shared title and
 * the share image as rules of their own, a variable naming no field said to
 * be one, the preview following the route's answer for the rule as edited,
 * and an Undo outside the panel shown at once.
 */
import "./dom-setup";

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Levels } from "../../resolver/order";
import type { TemplateContext } from "../../template/contract";

/** Each request the panel sent the route. */
const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
/** The editor's language, and whether the route fails to answer. */
const editing = vi.hoisted(() => ({
  locale: null as string | null,
  failing: false,
  /** Each report of unsaved work, by its key. */
  unsaved: new Map<string, boolean>(),
  /** Whether the editor refuses the panel's edits. */
  refusing: false,
}));

/** A rule's text pieces filled as the Page Builder fills them for the post. */
function filled(segments: unknown): string | undefined {
  if (!Array.isArray(segments)) return undefined;
  const values: Record<string, string> = {
    title: "Surfer vs Rext",
    excerpt: "Surfer grades drafts.",
    applicationName: "Rext AI",
  };
  return segments
    .map(piece =>
      typeof piece === "string"
        ? piece
        : (values[(piece as { $bind: string }).$bind] ?? "")
    )
    .join("");
}

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  // The admin's own parts the panel draws with, as they are.
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useDocumentLocale: () =>
    editing.locale === null ? null : { code: editing.locale },
  useReportUnsavedWork: (key: string, unsaved: boolean) => {
    editing.unsaved.set(key, unsaved);
  },
  writePluginRoute: ({ body }: { body: Record<string, unknown> }) => {
    sent.push(body);
    if (editing.failing) return Promise.reject(new Error("offline"));
    const document = body.document as {
      settings?: { seo?: Record<string, unknown> };
    };
    const rule = document.settings?.seo ?? {};
    const template = Object.fromEntries(
      Object.entries({
        title: filled(rule.title),
        description: filled(rule.description),
        socialTitle: filled(rule.socialTitle),
      }).filter(([, value]) => value !== undefined)
    );
    const levels: Levels = {
      page: { title: "Typed on the post" },
      code: {},
      template,
      pattern: {},
      content: {},
      site: { title: "Rext AI" },
      address: "/blog/surfer-vs-rext",
    };
    const context: TemplateContext = {
      typeLabel: "Blog post",
      typePlural: "Blog posts",
      fields: [
        { name: "title", token: "Post title" },
        { name: "excerpt", token: "Post excerpt" },
      ],
      imageFields: [{ name: "cover", label: "Cover image" }],
      entries: [
        { id: "p1", label: "Surfer vs Rext" },
        { id: "p2", label: "Jasper vs Rext" },
      ],
      count: 19,
      previewed: { id: String(body.entryId ?? "p1"), levels },
      site: { name: "Rext AI", origin: "https://rext.ai" },
    };
    return Promise.resolve(context);
  },
}));

const { TemplateSeoPanel } = await import("../TemplateSeoPanel");
type DesignSeo = NonNullable<
  Parameters<typeof TemplateSeoPanel>[0]["seo"]["value"]
>;

const RULE: DesignSeo = {
  title: [
    { $bind: "title" },
    " | ",
    { $bind: "applicationName", source: "site" },
  ],
  description: [{ $bind: "excerpt" }],
};

/** Each value the panel stored, in order. */
let stored: (DesignSeo | null)[] = [];
/** Set from outside the panel, as the editor's Undo does. */
let setFromOutside: (value: DesignSeo | undefined) => void = () => {};
/** The edits the panel holds, made as the editor makes them before a save. */
const holding = new Set<() => void>();
const makeHeld = () => {
  for (const make of [...holding]) make();
};

function Host({ initial }: { initial: DesignSeo | undefined }): ReactNode {
  const [value, setValue] = useState<DesignSeo | undefined>(initial);
  setFromOutside = setValue;
  return (
    <TemplateSeoPanel
      draws={{ collection: "posts", entryId: null }}
      seo={{
        value,
        set: next => {
          if (editing.refusing) return false;
          stored.push(next);
          setValue(next ?? undefined);
          return true;
        },
      }}
      design={{ formatVersion: 1, kind: "template", nodes: [] }}
      writable
      setBadge={() => {}}
      holdEdit={make => {
        holding.add(make);
        return () => {
          holding.delete(make);
        };
      }}
    />
  );
}

beforeEach(() => {
  sent.length = 0;
  stored = [];
  editing.locale = null;
  editing.failing = false;
  editing.unsaved.clear();
  editing.refusing = false;
  holding.clear();
});
afterEach(cleanup);

async function open(initial: DesignSeo | undefined = RULE) {
  render(<Host initial={initial} />);
  return screen.findByLabelText("Title on Google");
}

describe("a template's SEO panel", () => {
  it("reads the stored rule as text with variables, and says who it applies to", async () => {
    const title = await open();
    expect(title).toHaveProperty("value", "{Post title} | {Site name}");
    expect(screen.getByLabelText("Description on Google")).toHaveProperty(
      "value",
      "{Post excerpt}"
    );
    expect(
      screen.getByText(/every blog post that uses this template/)
    ).toBeTruthy();
    expect(screen.getByText(/19 pages/)).toBeTruthy();
    expect(
      screen.getByText(/Each blog post's own text in its SEO tab still wins\./)
    ).toBeTruthy();
  });

  it("previews the rule as the route fills it, not the post's own text", async () => {
    await open();
    expect((await screen.findByTestId("seo-search-title")).textContent).toBe(
      "Surfer vs Rext | Rext AI"
    );
  });

  it("stores a change as the design's metadata when the field is left, and asks the route with it", async () => {
    const user = userEvent.setup();
    const title = await open();
    await user.clear(title);
    await user.type(title, "Read {{Post title}");
    expect(stored).toEqual([]);
    await user.tab();

    expect(stored).toEqual([
      {
        title: ["Read ", { $bind: "title" }],
        description: [{ $bind: "excerpt" }],
      },
    ]);
    await waitFor(() =>
      expect(
        sent.some(
          body => JSON.stringify(body.document).includes('"Read "') === true
        )
      ).toBe(true)
    );
  });

  it("adds a variable where the person was typing, and stores it", async () => {
    const user = userEvent.setup();
    await open({});
    const description = screen.getByLabelText("Description on Google");
    await user.click(description);
    await user.click(screen.getByRole("button", { name: "{Post excerpt}" }));

    expect(description).toHaveProperty("value", "{Post excerpt}");
    expect(stored.at(-1)).toEqual({ description: [{ $bind: "excerpt" }] });
  });

  it("stores a shared title and a share image field as rules of their own", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(
      screen.getByRole("switch", { name: "Different title when shared" })
    );
    expect(stored.at(-1)).toMatchObject({ socialTitle: [] });

    await user.click(screen.getByRole("button", { name: "Change" }));
    await user.click(screen.getByLabelText("Take the share image from"));
    await user.click(
      await screen.findByRole("option", { name: "Cover image" })
    );
    expect(stored.at(-1)).toMatchObject({ image: { $bind: "cover" } });
  });

  it("says a variable that names no field is shown as written", async () => {
    const user = userEvent.setup();
    const title = await open({});
    await user.type(title, "{{Author}");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /\{Author\} names no field/
    );
  });

  it("shows a change made outside the panel at once, as an Undo is", async () => {
    const title = await open();
    setFromOutside({ title: ["Older"] });
    await waitFor(() => expect(title).toHaveProperty("value", "Older"));
  });

  it("previews with the page chosen", async () => {
    const user = userEvent.setup();
    await open();
    const heading = await screen.findByLabelText("Preview with");
    await user.click(heading);
    expect(await screen.findAllByRole("option")).toHaveLength(2);
    await user.click(screen.getAllByRole("option")[1] as HTMLElement);
    await waitFor(() =>
      expect(sent.some(body => body.entryId === "p2")).toBe(true)
    );
  });

  it("keeps what a stored binding says beyond a variable where its text is not changed", async () => {
    const user = userEvent.setup();
    const kept: DesignSeo = {
      title: [{ $bind: "title", fallback: "Untitled" }, " | Rext AI"],
      description: [{ $bind: "excerpt" }],
      image: { $bind: "cover", size: "card" },
    };
    await open(kept);
    const description = screen.getByLabelText("Description on Google");
    await user.clear(description);
    await user.type(description, "Read it");
    await user.tab();
    expect(stored.at(-1)).toEqual({
      title: kept.title,
      description: ["Read it"],
      image: kept.image,
    });
  });

  it("asks the route in the language being edited", async () => {
    editing.locale = "fr";
    await open();
    await waitFor(() => expect(sent.at(-1)).toMatchObject({ locale: "fr" }));
  });

  it("stores a rule still being typed when the panel closes", async () => {
    const user = userEvent.setup();
    const title = await open();
    await user.clear(title);
    await user.type(title, "New {{Post title}");
    cleanup();
    expect(stored.at(-1)).toMatchObject({
      title: ["New ", { $bind: "title" }],
    });
  });

  it("has the editor store a rule still being typed when the page is saved, and says it is unsaved until then", async () => {
    const user = userEvent.setup();
    const title = await open();
    const unsaved = () => [...editing.unsaved.values()].some(Boolean);
    expect(unsaved()).toBe(false);

    await user.clear(title);
    await user.type(title, "Saved {{Post title}");
    expect(unsaved()).toBe(true);
    expect(stored).toEqual([]);

    // The save shortcut, pressed with the field still in focus.
    act(makeHeld);
    expect(stored.at(-1)).toMatchObject({
      title: ["Saved ", { $bind: "title" }],
    });
    await waitFor(() => expect(unsaved()).toBe(false));
  });

  it("says a rule the editor refuses was not stored, and keeps it to store again", async () => {
    const user = userEvent.setup();
    const title = await open();
    editing.refusing = true;
    await user.clear(title);
    await user.type(title, "Too long");
    await user.tab();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /couldn.t be stored/
    );
    expect(title).toHaveProperty("value", "Too long");
    expect([...editing.unsaved.values()].some(Boolean)).toBe(true);

    editing.refusing = false;
    act(makeHeld);
    expect(stored.at(-1)).toMatchObject({ title: ["Too long"] });
    await waitFor(() =>
      expect(screen.queryByText(/couldn.t be stored/)).toBeNull()
    );
  });

  it("says the preview is the last one read when reading it again fails", async () => {
    const user = userEvent.setup();
    const title = await open();
    await screen.findByTestId("seo-search-title");
    editing.failing = true;
    await user.type(title, "!");
    await user.tab();
    expect(
      await screen.findByText(/could not be read again just now/)
    ).toBeTruthy();
  });

  it("draws its choices with the admin's own select", async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole("button", { name: "Change" }));
    for (const label of ["Preview with", "Take the share image from"]) {
      const select = await screen.findByLabelText(label);
      expect(select.getAttribute("role")).toBe("combobox");
      expect(select.tagName).toBe("BUTTON");
    }
  });
});
