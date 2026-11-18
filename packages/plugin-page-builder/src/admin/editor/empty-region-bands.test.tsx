// @vitest-environment jsdom

/**
 * The canvas's "No header yet" band, from the editor's side: which areas get
 * one, what it offers to whom, "Create a header" opening the new header in
 * place once it is drawn, and "Use a component" opening the list where the
 * band's button is.
 *
 * The reads and the writes are stood in for at the SDK. Each case names the
 * broken version it rules out.
 *
 * @module admin/editor/empty-region-bands.test
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
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
  useDocumentLocale: vi.fn(() => null),
  writePluginRoute: vi.fn(),
}));

vi.mock("../header-footer-pictures", () => ({
  useSetPictures: () => () => <span data-testid="picture" />,
}));

const askChoicesAgain = vi.fn();
vi.mock("../page-layout", () => ({
  useAskChoicesAgain: () => askChoicesAgain,
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("@nextlyhq/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/ui")>()),
  toast: {
    success: (...args: unknown[]) => toast.success(...args),
    error: (...args: unknown[]) => toast.error(...args),
  },
}));

import { usePluginRoute, writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import type { AreaComponentsResponse } from "../../layout-area-contract";
import type { EmptyDefaultArea, RegionCardFacts } from "../page-layout";

import {
  EmptyRegionBandsOverlay,
  useEmptyRegionBands,
  type EmptyRegionBands,
} from "./empty-region-bands";

const read = vi.mocked(usePluginRoute);
const write = vi.mocked(writePluginRoute);

/** The components list's answer, with whether the caller may choose. */
function answering(mayChoose: boolean | undefined) {
  read.mockImplementation(({ path, enabled }) => {
    const data: AreaComponentsResponse | undefined =
      mayChoose === undefined || enabled === false
        ? undefined
        : {
            items: [{ id: "ridgeline", title: "Ridgeline header" }],
            meta: {
              area: path.includes("area=footer") ? "footer" : "header",
              more: false,
              mayChoose,
              definitions: {},
            },
          };
    return {
      data,
      error: null,
      pending: data === undefined,
      refetch: () => {},
    } as unknown as ReturnType<typeof usePluginRoute>;
  });
}

const NO_HEADER: readonly EmptyDefaultArea[] = [
  { area: "header", setId: "main", setTitle: "Main" },
];

/** A region the canvas draws, as its card says: which component, which set. */
const drawn = (
  area: RegionArea,
  componentId = area === "header" ? "new-h" : "footer-1",
  setId = "main"
): RegionCardFacts => ({
  area,
  componentId,
  setId,
  setTitle: setId,
  starter: false,
});

interface Props {
  empty: readonly EmptyDefaultArea[];
  mode: "page-builder" | "code";
  following?: boolean;
}

const requestEdit = vi.fn();

function bands(props: Partial<Props> = {}) {
  return renderHook(
    (current: Props) =>
      useEmptyRegionBands({
        empty: current.empty,
        siteHeaderFooter: current.mode,
        followsDefault: current.following ?? true,
        reread: askChoicesAgain,
      }),
    {
      initialProps: { empty: NO_HEADER, mode: "page-builder", ...props },
    }
  );
}

/** What the bands open, drawn over a canvas whose regions' cards are `cards`. */
function overlay(
  current: EmptyRegionBands,
  cards: readonly RegionCardFacts[]
): ReturnType<typeof render> {
  return render(
    <EmptyRegionBandsOverlay
      bands={current}
      cards={cards}
      requestEdit={requestEdit}
    />
  );
}

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = () => false;
  proto.releasePointerCapture = () => {};
  proto.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  read.mockReset();
  write.mockReset();
  askChoicesAgain.mockReset();
  requestEdit.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  answering(true);
});
afterEach(cleanup);

describe("the bands where the site default shows no header or footer", () => {
  it("draws one for each empty area only, with both ways to fill it", () => {
    const band = bands().result.current.bands;
    expect(Object.keys(band ?? {})).toEqual(["header"]);
    expect(band?.header).toMatchObject({
      sentence:
        "No header yet. Pages on this site show no header until you add one.",
      actions: { create: "Create a header", use: "Use a component" },
    });
  });

  it("draws none where code draws the site's header and footer, asking nothing", () => {
    expect(bands({ mode: "code" }).result.current.bands).toBeUndefined();
    expect(read.mock.calls.every(([ask]) => ask.enabled === false)).toBe(true);
  });

  it("draws none until the read says who may fill it, so it never offers what it takes back", () => {
    answering(undefined);
    expect(bands().result.current.bands).toBeUndefined();
  });

  it("tells someone who may not change sets who can, offering nothing", () => {
    answering(false);
    expect(bands().result.current.bands?.header).toEqual({
      sentence:
        "No header yet. Pages on this site show no header until you add one.",
      actions: { ask: "Ask someone who can change the site's header." },
    });
  });
});

/** The create route's answer: the header made, in the default Main. */
const CREATED = {
  message: "Header was created.",
  item: {
    set: { id: "main", title: "Main" },
    area: "header",
    component: { id: "new-h", title: "Header" },
  },
};

describe("Create a header", () => {
  function pressCreate(hook: ReturnType<typeof bands>) {
    const actions = hook.result.current.bands?.header?.actions;
    if (actions === undefined || !("onCreate" in actions)) {
      throw new Error("no Create on the band");
    }
    return act(async () => {
      actions.onCreate();
    });
  }

  it("creates it in the default's area, says so, and opens it in place once the canvas draws it", async () => {
    write.mockResolvedValue({
      message: "Header was created.",
      item: {
        set: { id: "main", title: "Main" },
        area: "header",
        component: { id: "new-h", title: "Header" },
      },
    });
    const hook = bands();
    await pressCreate(hook);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/default-layout/areas/header",
        method: "POST",
      })
    );
    expect(toast.success).toHaveBeenCalledWith("Header was created.");
    expect(askChoicesAgain).toHaveBeenCalledTimes(1);
    expect(hook.result.current.created).toEqual({
      area: "header",
      componentId: "new-h",
      setId: "main",
    });
    // Not before it is drawn: editing a region the canvas lacks opens nothing.
    const drawnOver = overlay(hook.result.current, [drawn("footer")]);
    expect(requestEdit).not.toHaveBeenCalled();
    drawnOver.rerender(
      <EmptyRegionBandsOverlay
        bands={hook.result.current}
        cards={[drawn("header"), drawn("footer")]}
        requestEdit={requestEdit}
      />
    );
    expect(requestEdit).toHaveBeenCalledExactlyOnceWith("header");
    // Once: handled, so a later redraw opens nothing again.
    expect(hook.result.current.created).toBeNull();
    drawnOver.rerender(
      <EmptyRegionBandsOverlay
        bands={hook.result.current}
        cards={[drawn("header")]}
        requestEdit={requestEdit}
      />
    );
    expect(requestEdit).toHaveBeenCalledTimes(1);
  });

  it("opens nothing when the area shows another header, the page having moved to another set", async () => {
    write.mockResolvedValue(CREATED);
    const hook = bands();
    await pressCreate(hook);
    overlay(hook.result.current, [drawn("header", "landing-h", "landing")]);
    expect(requestEdit).not.toHaveBeenCalled();
    // Given up, so the header is not opened later either.
    expect(hook.result.current.created).toBeNull();
  });

  it("drops the opening once the page stops following the default", async () => {
    write.mockResolvedValue(CREATED);
    const hook = bands();
    await pressCreate(hook);
    hook.rerender({ empty: [], mode: "page-builder", following: false });
    expect(hook.result.current.created).toBeNull();
  });

  it("says a refusal in the route's words and opens nothing", async () => {
    write.mockRejectedValue(
      new Error("The Main header & footer already has a header.")
    );
    const hook = bands();
    await pressCreate(hook);
    expect(toast.error).toHaveBeenCalledWith(
      "The Main header & footer already has a header."
    );
    expect(hook.result.current.created).toBeNull();
    overlay(hook.result.current, [drawn("header")]);
    expect(requestEdit).not.toHaveBeenCalled();
  });
});

describe("Use a component, from the band", () => {
  function openMenu(hook: ReturnType<typeof bands>) {
    const actions = hook.result.current.bands?.header?.actions;
    if (actions === undefined || !("onUse" in actions)) {
      throw new Error("no Use on the band");
    }
    act(() => {
      actions.onUse({ x: 10, y: 20, width: 100, height: 30 });
    });
  }

  it("lists the components marked for the area and puts the one chosen in the default", async () => {
    write.mockResolvedValue({
      message: "Ridgeline header is now the header.",
      item: {
        set: { id: "main", title: "Main" },
        area: "header",
        component: { id: "ridgeline", title: "Ridgeline header" },
      },
    });
    const hook = bands();
    expect(hook.result.current.menu).toBeNull();
    openMenu(hook);
    overlay(hook.result.current, [drawn("footer")]);
    const option = await screen.findByRole("option", {
      name: /Ridgeline header/,
    });
    await act(async () => {
      fireEvent.click(option);
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/layouts/main/areas/header",
        method: "PATCH",
        body: { component: "ridgeline" },
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Ridgeline header is now the header."
    );
  });

  it("closes once the area is filled, whoever filled it", () => {
    const hook = bands();
    openMenu(hook);
    expect(hook.result.current.menu).not.toBeNull();
    hook.rerender({ empty: [], mode: "page-builder" });
    expect(hook.result.current.menu).toBeNull();
  });
});
