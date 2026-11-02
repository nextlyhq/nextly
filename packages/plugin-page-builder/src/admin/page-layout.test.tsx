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

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ usePluginRoute: vi.fn() }));

import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type { LayoutChoicesResponse } from "../layout-choices-contract";

import { PageLayoutPicker, usePageLayoutRegions } from "./page-layout";

const read = vi.mocked(usePluginRoute);

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
    truncated: false,
    regionComponents: {},
    regionDefinitions: {},
  },
};

function answering(data: LayoutChoicesResponse | undefined, error?: unknown) {
  read.mockReturnValue({
    data,
    error: error ?? null,
    pending: data === undefined && error === undefined,
    refetch: () => {},
  } as unknown as ReturnType<typeof usePluginRoute>);
}

beforeAll(() => {
  // Radix Select measures and captures the pointer; jsdom does neither.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
});

beforeEach(() => answering(choices));
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
    expect(why?.textContent).toBe("Site default: Main");
    expect(trigger.textContent).toContain("Site default (Main)");
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

  it("draws nothing, and adds no field, on a form that is not a page's", () => {
    const { container } = render(
      <Form defaults={{ title: "A post" }}>
        {control => <PageLayoutPicker control={control} />}
      </Form>
    );
    expect(container.textContent).toBe("");
    expect(Object.keys(values())).toEqual(["title"]);
  });
});

describe("the regions the editor draws from the choice", () => {
  function regionsFor(defaults: FieldValues) {
    return renderHook(() => {
      const form = useForm({ defaultValues: defaults });
      return usePageLayoutRegions(form.control, null);
    }).result.current;
  }

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
