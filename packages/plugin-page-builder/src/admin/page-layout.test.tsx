// @vitest-environment jsdom
/**
 * The page's Layout picker, as an author meets it in the form, and the regions
 * the editor draws from the same choice.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm, type Control, type FieldValues } from "react-hook-form";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: vi.fn(),
  useDocumentIdentity: vi.fn(),
  useDocumentLocale: vi.fn(() => null),
}));

import {
  useDocumentIdentity,
  useDocumentLocale,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import {
  LAYOUT_CHOICES_ROUTE_PATH,
  PAGE_COLLECTION_ROUTE_PATH,
  type LayoutChoicesResponse,
} from "../layout-choices-contract";

import {
  PageLayoutPicker,
  usePageLayoutAsk,
  usePageLayoutRegions,
  usePageLayoutSettings,
} from "./page-layout";

const read = vi.mocked(usePluginRoute);
const identity = vi.mocked(useDocumentIdentity);
const documentLocale = vi.mocked(useDocumentLocale);

/** The collection the form under test belongs to, and the site's pages. */
let formCollection = "pages";
let pagesCollection = "pages";

const choices: LayoutChoicesResponse = {
  items: [
    {
      id: "main",
      title: "Main",
      published: true,
      draftChangesNotLive: false,
      regions: [{ area: "header", componentId: "h" }],
    },
    {
      id: "landing",
      title: "Landing",
      published: true,
      draftChangesNotLive: true,
      regions: [
        { area: "header", componentId: "lh" },
        { area: "footer", componentId: "lf" },
      ],
    },
  ],
  meta: {
    defaultLayout: "main",
    layoutsCollection: "layouts",
    canUpdateLayouts: true,
    more: false,
    matched: [],
    defaultUnreadable: false,
    regionComponents: {},
    regionDefinitions: {},
  },
};

function answering(data: LayoutChoicesResponse | undefined, error?: unknown) {
  identity.mockImplementation(() => ({
    kind: "collection",
    slug: formCollection,
  }));
  read.mockImplementation(({ path }) => {
    // The page collection's answer is the site's, whatever the choices say.
    if (path === PAGE_COLLECTION_ROUTE_PATH) {
      return {
        data: { pagesCollection },
        error: null,
        pending: false,
        refetch: () => {},
      } as unknown as ReturnType<typeof usePluginRoute>;
    }
    return {
      data,
      error: error ?? null,
      pending: data === undefined && error === undefined,
      refetch: () => {},
    } as unknown as ReturnType<typeof usePluginRoute>;
  });
}

/** The paths the choices were asked at. */
function choicePaths(): string[] {
  return read.mock.calls
    .map(([request]) => request.path)
    .filter(path => path.startsWith(LAYOUT_CHOICES_ROUTE_PATH));
}

beforeAll(() => {
  // Radix Select measures and captures the pointer; jsdom does neither.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

beforeEach(() => {
  formCollection = "pages";
  pagesCollection = "pages";
  read.mockClear();
  documentLocale.mockReturnValue(null);
  answering(choices);
});
afterEach(cleanup);

let values: () => FieldValues = () => ({});

function Form({
  defaults,
  children,
}: {
  defaults: FieldValues;
  children: (control: Control<FieldValues>) => ReactNode;
}) {
  const form = useForm({ defaultValues: defaults });
  values = form.getValues;
  return <>{children(form.control)}</>;
}

function renderPicker(
  defaults: FieldValues = { layout: null, noHeaderFooter: false }
) {
  return render(
    <Form defaults={defaults}>
      {control => <PageLayoutPicker control={control} />}
    </Form>
  );
}

async function choose(label: string) {
  const trigger = screen.getByRole("combobox", { name: "Layout" });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name: label }));
  });
}

describe("the page's Layout picker", () => {
  it("is one labelled control, described by the line saying which Layout is in effect", () => {
    renderPicker();
    const trigger = screen.getByRole("combobox", { name: "Layout" });
    const why = document.getElementById(
      trigger.getAttribute("aria-describedby") ?? ""
    );
    expect(why?.textContent).toBe(
      "Follows the site default, Main, because this page doesn't choose its own Layout."
    );
    expect(trigger.textContent).toContain("Site default · Main");
  });

  it("writes the Layout and clears the switch when a Layout is chosen", async () => {
    renderPicker({ layout: null, noHeaderFooter: true });
    await choose("Landing");
    expect(values()).toMatchObject({
      layout: "landing",
      noHeaderFooter: false,
    });
  });

  it("writes the switch for No header or footer", async () => {
    renderPicker({ layout: "landing", noHeaderFooter: false });
    await choose("No header or footer");
    expect(values()).toMatchObject({ layout: "landing", noHeaderFooter: true });
  });

  it("is read-only, saying so, for an author who may not read Layouts", () => {
    answering(
      undefined,
      Object.assign(new Error("Forbidden"), { status: 403 })
    );
    renderPicker({ layout: "landing", noHeaderFooter: false });
    const trigger = screen.getByRole("combobox", { name: "Layout" });
    expect(trigger).toHaveProperty("disabled", true);
    expect(
      screen.getAllByText("A Layout you can't view").length
    ).toBeGreaterThan(0);
  });

  it("offers a retry when the choices could not be read", () => {
    answering(undefined, Object.assign(new Error("Boom"), { status: 500 }));
    renderPicker();
    expect(screen.getByText("Couldn't load Layouts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("asks for the page's own Layout by id, so a Layout past the list's bound is answered", () => {
    renderPicker({ layout: "landing", noHeaderFooter: false });
    expect(choicePaths()).toContain(
      `${LAYOUT_CHOICES_ROUTE_PATH}?selected=landing`
    );
  });

  it("asks for the choices in the language being edited", () => {
    documentLocale.mockReturnValue({ code: "de" } as ReturnType<
      typeof useDocumentLocale
    >);
    renderPicker({ layout: "landing", noHeaderFooter: false });
    expect(choicePaths()).toContain(
      `${LAYOUT_CHOICES_ROUTE_PATH}?selected=landing&locale=de`
    );
  });

  it("offers a search when the site has more Layouts than one answer lists, and a found one can be chosen", async () => {
    // The first 200 of 250 Layouts, and more beyond them.
    const layout = (i: number) => ({
      id: `l${i}`,
      title: `Layout ${i}`,
      published: true,
      draftChangesNotLive: false,
      regions: [],
    });
    const first = {
      items: Array.from({ length: 200 }, (_, i) => layout(i)),
      meta: { ...choices.meta, defaultLayout: "l0", more: true },
    };
    const searched = {
      items: [layout(0), layout(230)],
      meta: {
        ...choices.meta,
        defaultLayout: "l0",
        more: false,
        matched: ["l230"],
      },
    };
    identity.mockImplementation(() => ({ kind: "collection", slug: "pages" }));
    read.mockImplementation(({ path }) => {
      const answer =
        path === PAGE_COLLECTION_ROUTE_PATH
          ? { pagesCollection: "pages" }
          : path.includes("q=Layout+230")
            ? searched
            : path.includes("q=")
              ? { ...searched, items: [layout(0)] }
              : first;
      return {
        data: answer,
        error: null,
        pending: false,
        refetch: () => {},
      } as unknown as ReturnType<typeof usePluginRoute>;
    });
    renderPicker();
    const trigger = screen.getByRole("combobox", { name: "Layout" });
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(
      screen.getByText("Showing the first 200; search to find more.")
    ).toBeTruthy();
    const search = screen.getByRole("combobox", { name: "Search Layouts" });
    await act(async () => {
      fireEvent.change(search, { target: { value: "Layout 230" } });
    });
    const found = await screen.findByRole("option", { name: "Layout 230" });
    await act(async () => {
      fireEvent.click(found);
    });
    expect(values()).toMatchObject({ layout: "l230", noHeaderFooter: false });
  });

  /** A capped list whose search answers as `searched` says. */
  async function searchCapped(
    searched: {
      data?: unknown;
      error?: unknown;
    },
    query = "Layout 230"
  ): Promise<{ retry: ReturnType<typeof vi.fn> }> {
    const layout = (i: number) => ({
      id: `l${i}`,
      title: `Layout ${i}`,
      published: true,
      draftChangesNotLive: false,
      regions: [],
    });
    const first = {
      items: Array.from({ length: 200 }, (_, i) => layout(i)),
      meta: { ...choices.meta, defaultLayout: "l0", more: true },
    };
    const retry = vi.fn();
    identity.mockImplementation(() => ({ kind: "collection", slug: "pages" }));
    read.mockImplementation(({ path }) => {
      if (path === PAGE_COLLECTION_ROUTE_PATH) {
        return {
          data: { pagesCollection: "pages" },
          error: null,
          pending: false,
          refetch: () => {},
        } as unknown as ReturnType<typeof usePluginRoute>;
      }
      if (path.includes("q=")) {
        return {
          data: searched.data,
          error: searched.error ?? null,
          pending: searched.data === undefined && searched.error === undefined,
          refetch: retry,
        } as unknown as ReturnType<typeof usePluginRoute>;
      }
      return {
        data: first,
        error: null,
        pending: false,
        refetch: () => {},
      } as unknown as ReturnType<typeof usePluginRoute>;
    });
    renderPicker();
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: "Layout" }));
    });
    await act(async () => {
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search Layouts" }),
        { target: { value: query } }
      );
    });
    // Past the pause before a search is asked.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 250));
    });
    return { retry };
  }

  it("says it is searching, and shows none of the first answer, while a search is on its way", async () => {
    await searchCapped({});
    expect(screen.getByText("Searching…")).toBeTruthy();
    // The first answer's Layouts are not matches for what was typed.
    expect(screen.queryByRole("option", { name: "Layout 5" })).toBeNull();
  });

  it("says no Layouts match a search that matches none, keeping the current choice", async () => {
    // The answer still carries the page's default, which the route adds
    // whatever the query; it does not match, so it is not a result.
    await searchCapped(
      {
        data: {
          items: [
            {
              id: "l0",
              title: "Layout 0",
              published: true,
              draftChangesNotLive: false,
              regions: [],
            },
          ],
          meta: {
            ...choices.meta,
            defaultLayout: "l0",
            more: false,
            matched: [],
          },
        },
      },
      "zzz"
    );
    expect(screen.getByText("No Layouts match.")).toBeTruthy();
    expect(screen.queryAllByRole("option")).toEqual([]);
    // The trigger still says what is chosen.
    expect(
      screen.getByRole("combobox", { name: "Layout" }).textContent
    ).toContain("Site default · Layout 0");
  });

  it("keeps the rows the server matched, however their titles compare here", async () => {
    // A database collation matches "cafe" to "Café"; a client comparison
    // would not. The server's word is the one kept. The default is added to
    // the answer whatever the query, and is not a match.
    await searchCapped(
      {
        data: {
          items: [
            {
              id: "l0",
              title: "Layout 0",
              published: true,
              draftChangesNotLive: false,
              regions: [],
            },
            {
              id: "cafe",
              title: "Café",
              published: true,
              draftChangesNotLive: false,
              regions: [],
            },
          ],
          meta: {
            ...choices.meta,
            defaultLayout: "l0",
            more: false,
            matched: ["cafe"],
          },
        },
      },
      "cafe"
    );
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Café"]);
  });

  it("says a search failed and offers to try again, with no stale options", async () => {
    const { retry } = await searchCapped({
      error: Object.assign(new Error("Boom"), { status: 500 }),
    });
    expect(screen.getByText("Couldn't search Layouts")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Layout 5" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(retry).toHaveBeenCalled();
  });

  it("asks for the choices again when the author comes back to the tab", async () => {
    const refetch = vi.fn();
    read.mockImplementation(
      ({ path }) =>
        ({
          data:
            path === PAGE_COLLECTION_ROUTE_PATH
              ? { pagesCollection: "pages" }
              : choices,
          error: null,
          pending: false,
          refetch,
        }) as unknown as ReturnType<typeof usePluginRoute>
    );
    renderPicker();
    refetch.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(refetch).toHaveBeenCalled();
    refetch.mockClear();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the plain dropdown when every Layout fits in one answer", () => {
    renderPicker();
    expect(
      screen.queryByText("Showing the first 200; search to find more.")
    ).toBeNull();
    // The dropdown's own trigger, not a search field.
    expect(screen.queryByRole("combobox", { name: "Search Layouts" })).toBe(
      null
    );
  });

  it("draws on the pages collection a host renamed", () => {
    formCollection = "site-pages";
    pagesCollection = "site-pages";
    answering(choices);
    renderPicker();
    expect(screen.getByRole("combobox", { name: "Layout" })).toBeTruthy();
  });

  it("draws nothing on another collection with its own switch of the same name", () => {
    // A field-name collision: this collection has a boolean called
    // `noHeaderFooter` of its own, and is not the pages collection.
    formCollection = "campaigns";
    answering(choices);
    const { container } = render(
      <Form defaults={{ title: "A campaign", noHeaderFooter: false }}>
        {control => <PageLayoutPicker control={control} />}
      </Form>
    );
    expect(container.textContent).toBe("");
    expect(Object.keys(values()).sort()).toEqual(["noHeaderFooter", "title"]);
    expect(choicePaths()).toEqual([]);
  });

  it("draws nothing, and adds no field, on a form that is not a page's", () => {
    formCollection = "posts";
    answering(choices);
    const { container } = render(
      <Form defaults={{ title: "A post" }}>
        {control => <PageLayoutPicker control={control} />}
      </Form>
    );
    expect(container.textContent).toBe("");
    expect(Object.keys(values())).toEqual(["title"]);
  });
});

describe("the Settings section for the page's Layout", () => {
  function Section({ defaults }: { defaults: FieldValues }) {
    const form = useForm({ defaultValues: defaults });
    return <>{usePageLayoutSettings(form.control)}</>;
  }

  it("carries its own heading and description, then the picker", () => {
    render(<Section defaults={{ layout: null, noHeaderFooter: false }} />);
    const section = screen.getByRole("region", { name: "Header and footer" });
    expect(
      screen.getByRole("heading", { level: 3, name: "Header and footer" })
    ).toBeTruthy();
    expect(section.textContent).toContain(
      "Which Layout this page is drawn inside."
    );
    expect(
      section.contains(screen.getByRole("combobox", { name: "Layout" }))
    ).toBe(true);
  });

  it("is nothing for a form that is not a page's", () => {
    formCollection = "campaigns";
    answering(choices);
    const { container } = render(
      <Section defaults={{ title: "A campaign", noHeaderFooter: false }} />
    );
    expect(container.textContent).toBe("");
  });
});

describe("the regions the editor draws from the choice", () => {
  function regionsFor(defaults: FieldValues) {
    return renderHook(() => {
      const form = useForm({ defaultValues: defaults });
      return usePageLayoutRegions(form.control, null);
    }).result.current;
  }

  it("keeps the regions it drew while the answer for a new choice is on its way", async () => {
    // The answer for Landing has not arrived; the one held is Main's, which
    // carries no definitions for Landing's regions.
    identity.mockImplementation(() => ({ kind: "collection", slug: "pages" }));
    read.mockImplementation(({ path }) => {
      const data =
        path === PAGE_COLLECTION_ROUTE_PATH
          ? { pagesCollection: "pages" }
          : path.includes("selected=landing")
            ? undefined
            : choices;
      return {
        data,
        error: null,
        pending: data === undefined,
        refetch: () => {},
      } as unknown as ReturnType<typeof usePluginRoute>;
    });
    let form: ReturnType<typeof useForm> | undefined;
    const hook = renderHook(() => {
      form = useForm({
        defaultValues: { layout: null, noHeaderFooter: false },
      });
      return usePageLayoutRegions(form.control, null);
    });
    expect(hook.result.current.canvas[0]?.label).toBe(
      "Header, from Layout Main"
    );
    await act(async () => {
      form?.setValue("layout", "landing");
    });
    expect(hook.result.current.canvas[0]?.label).toBe(
      "Header, from Layout Main"
    );
  });

  it("names each region, where it comes from, and offers Edit Layout in a new tab", () => {
    const { canvas, layers } = regionsFor({
      layout: null,
      noHeaderFooter: false,
    });
    expect(canvas).toHaveLength(1);
    expect(canvas[0]).toMatchObject({
      area: "header",
      label: "Header, from Layout Main",
      badge: "Header · from Layout",
      edit: {
        href: "/admin/collections/layouts/main",
        text: "Edit Layout ↗",
        name: "Edit Layout Main (opens in a new tab)",
      },
    });
    expect(layers.map(row => [row.name, row.origin])).toEqual([
      ["Header", "from Layout Main"],
    ]);
  });

  it("says when the Layout in effect has changes a visitor does not see yet", () => {
    const { canvas } = regionsFor({ layout: "landing", noHeaderFooter: false });
    expect(canvas.map(region => region.note)).toEqual([
      "Draft changes not live: Layout Landing",
      "Draft changes not live: Layout Landing",
    ]);
  });

  it("offers no Edit link to an author who may not update Layouts", () => {
    answering({
      ...choices,
      meta: { ...choices.meta, canUpdateLayouts: false },
    });
    const { canvas } = regionsFor({ layout: null, noHeaderFooter: false });
    expect(canvas[0]?.edit).toBeUndefined();
  });

  it("draws none for a page with no header or footer", () => {
    expect(
      regionsFor({ layout: "landing", noHeaderFooter: true }).canvas
    ).toEqual([]);
  });
});

describe("a save refused for its Layout", () => {
  it("shows the server's reason under the picker, tied to the control", async () => {
    let setError: ((message: string) => void) | undefined;
    function Refused() {
      const form = useForm({
        defaultValues: { layout: "landing", noHeaderFooter: false },
      });
      setError = message =>
        form.setError("layout", { type: "server", message });
      return <PageLayoutPicker control={form.control} />;
    }
    render(<Refused />);
    await screen.findByRole("combobox", { name: "Layout" });

    act(() =>
      setError?.(
        "This Layout is being removed, so pages can't choose it. Choose another Layout."
      )
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "This Layout is being removed, so pages can't choose it. Choose another Layout."
    );
    const control = screen.getByRole("combobox", { name: "Layout" });
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(control.getAttribute("aria-describedby")).toContain(alert.id);
  });
});

describe("a Layout behind Remove Layout's fence in the list", () => {
  it("shows its name and a muted short reason, with the whole reason as its tooltip and description", async () => {
    answering({
      ...choices,
      items: [
        ...choices.items,
        {
          id: "retired",
          title: "Campaign",
          published: false,
          draftChangesNotLive: false,
          regions: [],
          removal: "unpublished",
        },
      ],
    });
    renderPicker();
    const trigger = screen.getByRole("combobox", { name: "Layout" });
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
    });

    const option = screen.getByRole("option", { name: /Campaign/ });
    expect(option.textContent).toBe(
      "Campaign · Unpublished. Publish it again to choose it."
    );
    const reason =
      "This Layout was unpublished with Remove Layout, so pages can't choose it until it is published again. Choose another Layout.";
    expect(option.getAttribute("title")).toBe(reason);
    expect(option.getAttribute("aria-description")).toBe(reason);
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("what a publish asks about the page's Layout", () => {
  function askFor(defaults: FieldValues) {
    return renderHook(() => {
      const form = useForm({ defaultValues: defaults });
      return usePageLayoutAsk(form.control);
    }).result.current;
  }

  it("names the Layout a page names", () => {
    expect(askFor({ layout: "landing", noHeaderFooter: false })).toEqual({
      layout: "landing",
      siteDefault: false,
    });
  });

  it("asks about the site's default for a page that names none", () => {
    expect(askFor({ layout: null, noHeaderFooter: false })).toEqual({
      layout: null,
      siteDefault: true,
    });
  });

  it("asks about no Layout for a page drawn with no header or footer", () => {
    expect(askFor({ layout: "landing", noHeaderFooter: true })).toEqual({
      layout: null,
      siteDefault: false,
    });
  });

  it("asks about no Layout on a form that is not a page's", () => {
    formCollection = "posts";
    answering(choices);
    expect(askFor({ layout: null, noHeaderFooter: false })).toEqual({
      layout: null,
      siteDefault: false,
    });
  });
});
