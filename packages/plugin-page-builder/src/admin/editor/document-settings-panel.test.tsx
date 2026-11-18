// @vitest-environment jsdom

/**
 * The right panel with nothing selected: each document's own settings, and
 * every row writing the entry's own form, as Settings does.
 *
 * @module admin/editor/document-settings-panel.test
 */
import type { DocumentKind } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  useForm,
  useWatch,
  type Control,
  type FieldValues,
  type UseFormReturn,
} from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a plugin draws where the builder shows the page's search result;
 * null where no plugin adds a block, as without the SEO plugin. And what
 * each draw of that place was handed.
 */
const search: {
  block: React.ReactNode | null;
  asked: Record<string, unknown>[];
} = vi.hoisted(() => ({ block: null, asked: [] }));

/** The entry's form as the document editor holds it, for the SDK's hooks. */
const live: {
  form?: UseFormReturn<FieldValues>;
  writable: boolean;
  savedPath: string | null;
  /** Each write through the SDK's field, which marks the document changed. */
  sets: [string, unknown][];
  /** Which kind of document the editor has open. */
  identity: "collection" | "single";
} = { writable: true, savedPath: "/pricing", sets: [], identity: "collection" };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useDocumentField: (path: string) => {
    const form = live.form!;
    const value: unknown = useWatch({ control: form.control, name: path });
    return {
      value,
      writable: live.writable,
      set: (next: unknown) => {
        live.sets.push([path, next]);
        form.setValue(path, next, { shouldDirty: true });
        return true;
      },
    };
  },
  useDocumentIdentity: () => ({ kind: live.identity, slug: "pages" }),
  usePluginRoute: (args: { enabled?: boolean; path: string }) => ({
    data:
      args.enabled === false
        ? undefined
        : args.path.startsWith("/loop-collections")
          ? {
              items: [
                {
                  slug: "pages",
                  label: "Pages",
                  singular: "Page",
                  fields: [],
                  relations: [],
                },
              ],
            }
          : { path: live.savedPath },
    error: null,
    refetch: () => Promise.resolve(),
  }),
  useDocumentLocale: () => null,
  // The admin's slot, standing in: a plugin's block where a case adds one,
  // else the page's fallback, as the real slot draws a plugin's place.
  TargetSlot: (props: Record<string, unknown>) => {
    search.asked.push(props);
    if (props.context === null) return null;
    return search.block ?? (props.fallback as React.ReactNode);
  },
}));

// The one header & footer picker, tested where it lives.
vi.mock("../page-layout", () => ({
  PageLayoutPicker: ({ disabled }: { disabled?: boolean }) => (
    <p>
      {disabled === true
        ? "Header & footer picker, held"
        : "Header & footer picker"}
    </p>
  ),
}));

import {
  DocumentSettingsPanel,
  type DocumentSettingsPanelProps,
} from "./document-settings-panel";

const ADDRESS = {
  page: { collection: "pages", id: "p1" },
  savedSlug: "pricing",
  slugChanged: false,
  savedRevision: 0,
} as const;

/** The place a page's panel draws its search result at. */
const PLACE = {
  context: {
    userId: "u1",
    document: "page" as const,
    collection: "pages",
    entryId: "p1",
    draws: null,
  },
  tabProps: {
    seo: { value: undefined, set: () => true },
    design: { formatVersion: 1, kind: "page", nodes: [] },
    control: {} as never,
    writable: true,
    holdEdit: () => () => {},
    designField: "layout",
  },
  flushHeld: () => null,
} as unknown as NonNullable<DocumentSettingsPanelProps["place"]>;

beforeEach(() => {
  search.block = null;
  search.asked.length = 0;
  live.writable = true;
  live.savedPath = "/pricing";
  live.sets = [];
  live.identity = "collection";
});

afterEach(cleanup);

function mount(
  kind: DocumentKind,
  props: Partial<DocumentSettingsPanelProps> = {},
  values: FieldValues = { title: "Pricing", slug: "pricing" }
): { form: () => UseFormReturn<FieldValues>; open: () => number } {
  let opened = 0;
  function Host() {
    const form = useForm<FieldValues>({ defaultValues: values });
    live.form = form;
    return (
      <DocumentSettingsPanel
        kind={kind}
        own={null}
        control={form.control as Control<FieldValues>}
        onOpenSettings={() => {
          opened += 1;
        }}
        address={ADDRESS}
        place={PLACE}
        {...props}
      />
    );
  }
  render(<Host />);
  return { form: () => live.form!, open: () => opened };
}

const panel = (name: string) => screen.getByRole("region", { name });

describe("a page's settings in the right panel", () => {
  it("lists the title, address, header & footer, search result and the way to the rest", () => {
    mount("page");
    const view = panel("Page settings");
    expect(within(view).getByRole("textbox", { name: "Title" })).toHaveProperty(
      "value",
      "Pricing"
    );
    expect(
      within(view).getByRole("textbox", { name: "Address" })
    ).toHaveProperty("value", "pricing");
    expect(within(view).getByText("Header & footer picker")).toBeTruthy();
    const result = within(view).getByRole("region", { name: "Search result" });
    expect(within(result).getByText("/pricing")).toBeTruthy();
    expect(within(result).getByText("Pricing")).toBeTruthy();
    expect(
      within(view).getByRole("button", { name: "All page settings…" })
    ).toBeTruthy();
  });

  it("writes the title through the document's own field, as typing in Settings does", () => {
    const { form } = mount("page");
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Plans" },
    });
    // The SDK's write, which marks the document changed as typing would.
    expect(live.sets).toEqual([["title", "Plans"]]);
    expect(form().getValues("title")).toBe("Plans");
    // The summary follows the title as it is typed.
    expect(
      within(screen.getByRole("region", { name: "Search result" })).getByText(
        "Plans"
      )
    ).toBeTruthy();
  });

  it("writes the address into the slug, and says it moves when saved", () => {
    const { form } = mount("page", {
      address: { ...ADDRESS, slugChanged: true },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Address" }), {
      target: { value: "plans" },
    });
    expect(live.sets).toEqual([["slug", "plans"]]);
    expect(form().getValues("slug")).toBe("plans");
    expect(
      screen.getByText("The address changes when you save the page.")
    ).toBeTruthy();
  });

  it("titles the search result as Settings' preview does", () => {
    mount("page", {}, { title: "  ", slug: "pricing" });
    const result = screen.getByRole("region", { name: "Search result" });
    expect(within(result).getByText("Untitled")).toBeTruthy();
  });

  it("copies the saved address, and says it did", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    mount("page");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy address /pricing" })
      );
    });
    expect(writeText).toHaveBeenCalledWith("/pricing");
    expect(screen.getByRole("button", { name: "Address copied" })).toBeTruthy();
  });

  it("offers no copy for a page never saved, which has no address yet", () => {
    mount("page", { address: null });
    expect(screen.getByRole("textbox", { name: "Address" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Copy address/ })).toBeNull();
  });

  it("opens Settings from All page settings…", () => {
    const { open } = mount("page");
    fireEvent.click(screen.getByRole("button", { name: "All page settings…" }));
    expect(open()).toBe(1);
  });

  it("leaves the search result to a plugin that draws one, drawing its own only where none does", () => {
    // No plugin adds a block: the builder's own summary.
    mount("page");
    expect(screen.getByRole("region", { name: "Search result" })).toBeTruthy();
    expect(search.asked.at(-1)).toMatchObject({
      place: "nextlyhq-plugin-page-builder.settings",
      context: PLACE.context,
      blockProps: {
        at: "panel",
        typePlural: "Pages",
        design: PLACE.tabProps.design,
        designField: "layout",
      },
    });
    cleanup();

    search.block = <p>The plugin&apos;s own result</p>;
    mount("page");
    expect(screen.getByText("The plugin's own result")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Search result" })).toBeNull();
    // And says nothing of its own about search.
    expect(screen.queryByText(/Built from the page/)).toBeNull();
  });

  it("holds its fields while the page takes no edits", () => {
    live.writable = false;
    mount("page");
    expect(
      (screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement)
        .disabled
    ).toBe(true);
    expect(
      (screen.getByRole("textbox", { name: "Address" }) as HTMLInputElement)
        .disabled
    ).toBe(true);
    // The picker writes the form itself, so it is held too.
    expect(screen.getByText("Header & footer picker, held")).toBeTruthy();
  });

  it("keeps the page data line's place, after the search result", () => {
    mount("page", { pageData: <p>Page data line</p> });
    const view = panel("Page settings");
    const line = within(view).getByText("Page data line");
    const result = within(view).getByRole("region", { name: "Search result" });
    const all = within(view).getByRole("button", {
      name: "All page settings…",
    });
    expect(
      result.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      line.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe("a title or address the panel must not change", () => {
  it("shows a Single's fixed title without editing it, and no address", () => {
    live.identity = "single";
    mount("page", { address: null }, { title: "Homepage", slug: "homepage" });
    const title = screen.getByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement;
    expect(title.value).toBe("Homepage");
    expect(title.readOnly).toBe(true);
    expect(screen.queryByRole("textbox", { name: "Address" })).toBeNull();
  });

  it("shows a number title as the entry does, without typing text into it", () => {
    mount("page", {}, { title: 42, slug: "pricing" });
    const title = screen.getByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement;
    expect(title.value).toBe("42");
    expect(title.readOnly).toBe(true);
    expect(
      within(screen.getByRole("region", { name: "Search result" })).getByText(
        "42"
      )
    ).toBeTruthy();
  });
});

describe("another document's settings in the same place", () => {
  it("heads a component's under Component settings, with its own fields", () => {
    mount("component", { own: <p>The component&apos;s fields</p> });
    const view = panel("Component settings");
    expect(within(view).getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(within(view).getByText("The component's fields")).toBeTruthy();
    expect(
      within(view).getByRole("button", { name: "All component settings…" })
    ).toBeTruthy();
    // A component has no address, header & footer or search result.
    expect(within(view).queryByRole("textbox", { name: "Address" })).toBeNull();
    expect(within(view).queryByText("Header & footer picker")).toBeNull();
    expect(
      within(view).queryByRole("region", { name: "Search result" })
    ).toBeNull();
  });

  it("heads a saved section's under Saved section settings", () => {
    mount("pattern");
    const view = panel("Saved section settings");
    expect(within(view).getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(within(view).queryByRole("textbox", { name: "Address" })).toBeNull();
    expect(
      within(view).getByRole("button", { name: "All saved section settings…" })
    ).toBeTruthy();
  });

  it("heads a collection template's under Collection template settings", () => {
    mount("template");
    const view = panel("Collection template settings");
    expect(within(view).getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(within(view).queryByText("Header & footer picker")).toBeNull();
    expect(
      within(view).getByRole("button", { name: "All template settings…" })
    ).toBeTruthy();
  });
});
