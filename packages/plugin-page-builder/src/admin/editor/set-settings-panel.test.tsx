// @vitest-environment jsdom
/**
 * A header & footer set's settings on its own screen in the builder, as an
 * author meets them: its name, a Header and a Footer picker with pictures
 * (components marked for the area first, then "Other components", then
 * "None"), how many pages use it, the site default's badge or "Make site
 * default", and a ⋯ menu with Rename, Duplicate and Delete. Every choice
 * writes the set's form, which the set's own Save and Publish store.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render as renderPlain,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, type FieldValues } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SetAreaChoicesResponse } from "../../set-area-choices-contract";

interface RouteRead {
  path: string;
  enabled?: boolean;
}
const routeReads: RouteRead[] = [];
let choices: unknown;
let counts: unknown;
let siteSettings: unknown;
let areaChoices: Record<string, SetAreaChoicesResponse>;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: (read: RouteRead) => {
    routeReads.push(read);
    let data: unknown;
    if (read.enabled === false) data = undefined;
    else if (read.path.startsWith("/layouts/counts")) data = counts;
    else if (read.path.startsWith("/site/settings")) data = siteSettings;
    else if (read.path.startsWith("/layouts/area-choices")) {
      const area = new URLSearchParams(read.path.split("?")[1]).get("area");
      data = areaChoices[area ?? ""];
    } else data = choices;
    return { data, error: null, refetch: vi.fn() };
  },
  useDocumentLocale: () => null,
  navigateTo: vi.fn(),
  useLeaveWithoutWarning: () => () => {},
  useDocumentActions: () => ({ run: formActions.run }),
}));

const formActions = vi.hoisted(() => ({
  run: vi.fn(async (_action: string) => ({ ok: true }) as { ok: boolean }),
}));

vi.mock("../header-footer-pictures", () => ({
  useSetPictures: () => (picture: readonly { componentId: string }[]) => (
    <span data-testid="picture">
      {picture.length === 0
        ? "empty-frame"
        : picture.map(region => region.componentId).join("+")}
    </span>
  ),
}));

const writes = vi.hoisted(() => ({
  duplicateLayout: vi.fn(async (id: string) => ({
    id: `${id}-copy`,
    title: "Copy of Main",
  })),
}));
vi.mock("../layout-writes-client", () => writes);

const made = vi.hoisted(() => ({
  createAreaComponent: vi.fn(async (area: string) => ({
    id: `${area}-new`,
    title: area === "header" ? "Header 2" : "Footer 2",
    area,
  })),
}));
vi.mock("../layout-area-client", () => made);

const copies = vi.hoisted(() => ({
  send: vi.fn(async () => ({
    component: { id: "ridgeline-copy", title: "Ridgeline header copy" },
  })),
  asked: [] as string[],
}));
vi.mock("../component-actions-client", () => ({
  useDuplicate: (componentId: string) => {
    copies.asked.push(componentId);
    return { send: copies.send, error: undefined };
  },
}));

const flows = vi.hoisted(() => ({ makeDefault: vi.fn(), remove: vi.fn() }));
vi.mock("../make-default-action", () => ({
  useMakeDefaultFlow: () => ({ start: flows.makeDefault, dialog: null }),
}));
vi.mock("../RemoveLayoutAction", () => ({
  useRemoveLayout: () => ({ open: flows.remove, dialog: null }),
}));
vi.mock("../page-layout", () => ({ useAskChoicesAgain: () => () => {} }));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: toasts,
}));

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;

const { SetSettingsPanel } = await import("./set-settings-panel");

afterEach(cleanup);

/** The form's values, as the last render saw them. */
let values: FieldValues = {};

const editArea = vi.fn();

function Panel({ initial }: { initial: FieldValues }) {
  const form = useForm({ defaultValues: initial });
  values = form.watch();
  return (
    <SetSettingsPanel
      set={{ id: "main" }}
      control={form.control}
      onEditArea={editArea}
    />
  );
}

function render(initial: FieldValues = MAIN_FORM) {
  return renderPlain(
    <QueryClientProvider client={new QueryClient()}>
      <Panel initial={initial} />
    </QueryClientProvider>
  );
}

const MAIN_FORM = {
  title: "Main",
  areas: [
    { id: "r1", area: "header", component: "ridgeline" },
    { id: "r2", area: "footer", component: "base" },
  ],
};

function choicesWith(
  defaultLayout: string,
  published = true,
  others: readonly { id: string; title: string; header: string }[] = []
) {
  return {
    items: [
      {
        id: "main",
        title: "Main",
        published,
        draftChangesNotLive: false,
        regions: [],
        areasFilled: [],
      },
      ...others.map(other => ({
        id: other.id,
        title: other.title,
        published: true,
        draftChangesNotLive: false,
        regions: [{ area: "header", componentId: other.header }],
        areasFilled: ["header"],
      })),
    ],
    meta: {
      defaultLayout,
      defaultUnreadable: false,
      layoutsCollection: "layouts",
      canUpdateLayouts: true,
      canCreateLayouts: true,
      canUpdateAnyLayout: true,
      canDeleteAnyLayout: true,
      more: false,
      matched: [],
      regionComponents: {},
      regionDefinitions: {},
    },
  };
}

beforeEach(() => {
  routeReads.length = 0;
  vi.clearAllMocks();
  choices = choicesWith("main");
  counts = { main: { pages: 11, floor: false } };
  siteSettings = { mayManageSite: true, mayChooseDefaultLayout: true };
  areaChoices = {
    header: {
      items: [
        { id: "ridgeline", title: "Ridgeline header", marked: true },
        { id: "starter-h", title: "Starter header", marked: true },
        { id: "banner", title: "Banner", marked: false },
      ],
      meta: { area: "header", more: false, definitions: {} },
    },
    footer: {
      items: [{ id: "base", title: "Base footer", marked: true }],
      meta: { area: "footer", more: false, definitions: {} },
    },
  };
});

describe("a set's settings", () => {
  it("shows its name, its header and footer, how many pages use it, and that it is the site default", () => {
    render();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Main");
    expect(screen.getByLabelText("Header").textContent).toContain(
      "Ridgeline header"
    );
    expect(screen.getByLabelText("Footer").textContent).toContain(
      "Base footer"
    );
    expect(screen.getByText("Used on 11 pages")).toBeTruthy();
    expect(screen.getByText("Site default")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Make site default" })
    ).toBeNull();
  });

  it("draws each picker's current choice as a picture", () => {
    render();
    expect(
      within(screen.getByLabelText("Header")).getByTestId("picture").textContent
    ).toBe("ridgeline");
    expect(
      within(screen.getByLabelText("Footer")).getByTestId("picture").textContent
    ).toBe("base");
  });

  it("lists the components marked for the area first, then Other components, then None and + Create a header, each choice with its picture", async () => {
    render();
    await userEvent.click(screen.getByLabelText("Header"));
    const list = screen.getByRole("listbox");
    const all = within(list).getAllByRole("option");
    expect(all.map(option => option.textContent)).toEqual([
      expect.stringContaining("Ridgeline header"),
      expect.stringContaining("Starter header"),
      expect.stringContaining("Banner"),
      expect.stringContaining("None"),
      "+ Create a header",
    ]);
    // The choices, each with its picture; the create row makes one.
    const options = all.slice(0, -1);
    expect(within(list).getByText("Other components")).toBeTruthy();
    expect(
      options.map(option => within(option).getByTestId("picture").textContent)
    ).toEqual(["ridgeline", "starter-h", "banner", "empty-frame"]);
    // The pictures are asked for once the menu opens, not before.
    expect(
      routeReads.some(
        read =>
          read.path.includes("area=header") &&
          read.path.includes("pictures=1") &&
          read.enabled !== false
      )
    ).toBe(true);
  });

  it("asks for no pictures of the list while the menu is closed", () => {
    render();
    expect(
      routeReads.filter(
        read => read.path.includes("pictures=1") && read.enabled !== false
      )
    ).toEqual([]);
  });

  it("writes a header chosen into the set's form, keeping the other area", async () => {
    render();
    await userEvent.click(screen.getByLabelText("Header"));
    await userEvent.click(screen.getByRole("option", { name: /Banner/ }));
    expect(values.areas).toEqual([
      { id: "r1", area: "header", component: "banner" },
      { id: "r2", area: "footer", component: "base" },
    ]);
  });

  it("takes the area out of the set when None is chosen", async () => {
    render();
    await userEvent.click(screen.getByLabelText("Footer"));
    await userEvent.click(screen.getByRole("option", { name: /None/ }));
    expect(values.areas).toEqual([
      { id: "r1", area: "header", component: "ridgeline" },
    ]);
    expect(screen.getByLabelText("Footer").textContent).toContain("None");
  });

  it("writes the name into the set's form", async () => {
    render();
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Landing");
    expect(values.title).toBe("Landing");
  });

  it("offers Make site default to a set that is not the default, for someone who may", async () => {
    choices = choicesWith("other");
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "Make site default" })
    );
    expect(flows.makeDefault).toHaveBeenCalledWith({
      id: "main",
      title: "Main",
      published: true,
    });
    expect(screen.queryByText("Site default")).toBeNull();
  });

  it("publishes a set never published through its own form, then makes it the default", async () => {
    choices = choicesWith("other", false);
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "Publish it, then make default" })
    );
    // The form's own publish, so what is shown here is what goes live.
    expect(formActions.run).toHaveBeenCalledWith("publish");
    expect(flows.makeDefault).toHaveBeenCalledWith({
      id: "main",
      title: "Main",
      published: true,
    });
  });

  it("makes nothing the default when the set's own publish does not go through", async () => {
    choices = choicesWith("other", false);
    formActions.run.mockResolvedValueOnce({ ok: false });
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "Publish it, then make default" })
    );
    expect(flows.makeDefault).not.toHaveBeenCalled();
  });

  it("makes a published set the default without publishing it again", async () => {
    choices = choicesWith("other");
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "Make site default" })
    );
    expect(formActions.run).not.toHaveBeenCalled();
  });

  it("offers no way to make it the default to someone who may not", () => {
    choices = choicesWith("other");
    siteSettings = { mayManageSite: false, mayChooseDefaultLayout: false };
    render();
    expect(
      screen.queryByRole("button", { name: /make default|Make site default/ })
    ).toBeNull();
  });

  it("says how many pages use it as an author reads it", () => {
    counts = { main: { pages: 1, floor: false } };
    render();
    expect(screen.getByText("Used on 1 page")).toBeTruthy();
    cleanup();
    counts = { main: { pages: 200, floor: true } };
    render();
    expect(screen.getByText("Used on at least 200 pages")).toBeTruthy();
  });

  it("offers Rename, Duplicate and Delete in its ⋯ menu", async () => {
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "More for Main" })
    );
    expect(
      screen.getAllByRole("menuitem").map(item => item.textContent)
    ).toEqual(["Rename", "Duplicate", "Delete"]);
  });

  it("offers only what the author has the right to", async () => {
    choices = {
      ...choicesWith("other"),
      meta: {
        ...choicesWith("other").meta,
        canCreateLayouts: false,
        canDeleteAnyLayout: false,
      },
    };
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "More for Main" })
    );
    expect(
      screen.getAllByRole("menuitem").map(item => item.textContent)
    ).toEqual(["Rename"]);
  });

  it("Rename puts the cursor in the Name field", async () => {
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "More for Main" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
  });

  it("Duplicate copies the set and says so", async () => {
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "More for Main" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(writes.duplicateLayout).toHaveBeenCalledWith("main");
    expect(toasts.success).toHaveBeenCalledWith(
      "Copy of Main was made.",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Open" }),
      })
    );
  });

  it("refuses to delete the site default, saying why", async () => {
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "More for Main" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(toasts.error).toHaveBeenCalledWith(
      "Main is the site default. Make another set the default before deleting it."
    );
    expect(flows.remove).not.toHaveBeenCalled();
  });

  it("opens the removal for any other set", async () => {
    choices = choicesWith("other");
    render();
    await userEvent.click(
      screen.getByRole("button", { name: "More for Main" })
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(flows.remove).toHaveBeenCalled();
  });

  it("says which other sets use the header, with Make a separate copy", async () => {
    choices = choicesWith("main", true, [
      { id: "landing", title: "Landing", header: "ridgeline" },
      { id: "promo", title: "Promo", header: "banner" },
    ]);
    render();
    expect(screen.getByText("Also used by Landing")).toBeTruthy();
    // The footer is this set's alone: nothing is said under it.
    expect(screen.getAllByText(/^Also used by/)).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", { name: "Make a separate copy" })
    );
    expect(copies.send).toHaveBeenCalledWith({});
    expect(copies.asked).toContain("ridgeline");
    // Only this set's form points at the copy; the other area is kept.
    expect(values.areas).toEqual([
      { id: "r1", area: "header", component: "ridgeline-copy" },
      { id: "r2", area: "footer", component: "base" },
    ]);
  });

  it("names the other sets in the picker's rows too", async () => {
    choices = choicesWith("main", true, [
      { id: "promo", title: "Promo", header: "banner" },
    ]);
    render();
    await userEvent.click(screen.getByLabelText("Header"));
    expect(
      screen.getByRole("option", { name: /Banner/ }).textContent
    ).toContain("Also used by Promo");
  });

  it("says nothing of other sets while no other set uses the header", () => {
    choices = choicesWith("main", true, [
      { id: "promo", title: "Promo", header: "banner" },
    ]);
    render();
    expect(screen.queryByText(/^Also used by/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Make a separate copy" })
    ).toBeNull();
  });

  it("offers + Create a header last, which makes one and chooses it in the set's form", async () => {
    render();
    await userEvent.click(screen.getByLabelText("Header"));
    const options = screen.getAllByRole("option");
    expect(options.at(-1)?.textContent).toBe("+ Create a header");
    await userEvent.click(
      screen.getByRole("option", { name: "+ Create a header" })
    );
    expect(made.createAreaComponent).toHaveBeenCalledWith("header");
    await vi.waitFor(() =>
      expect(values.areas).toEqual([
        { id: "r1", area: "header", component: "header-new" },
        { id: "r2", area: "footer", component: "base" },
      ])
    );
    // Said, with the way to edit it in place.
    const [words, options2] = toasts.success.mock.calls.at(-1) ?? [];
    expect(words).toBe(
      "Header 2 was created as this set's header. Save or publish the set to keep it."
    );
    (options2 as { action: { onClick: () => void } }).action.onClick();
    expect(editArea).toHaveBeenCalledWith("header");
  });

  it("words the footer's as + Create a footer", async () => {
    render();
    await userEvent.click(screen.getByLabelText("Footer"));
    expect(
      screen.getByRole("option", { name: "+ Create a footer" })
    ).toBeTruthy();
  });

  it("says a refused create, choosing nothing", async () => {
    made.createAreaComponent.mockRejectedValueOnce(
      new Error("You don't have permission to create components.")
    );
    render();
    await userEvent.click(screen.getByLabelText("Header"));
    await userEvent.click(
      screen.getByRole("option", { name: "+ Create a header" })
    );
    await vi.waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "You don't have permission to create components."
      )
    );
    expect(values.areas).toEqual(MAIN_FORM.areas);
  });

  it("names its open list from the trigger, and holds only options and groups in it", async () => {
    render();
    const trigger = screen.getByLabelText("Header");
    await userEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(trigger.getAttribute("aria-controls")).toBe(list.id);
    expect(list.querySelector('[role="separator"]')).toBeNull();
  });
});
