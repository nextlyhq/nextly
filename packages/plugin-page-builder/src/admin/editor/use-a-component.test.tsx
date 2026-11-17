// @vitest-environment jsdom

/**
 * "Use a component ▾" on the starter's card: the published components marked
 * for the area, each with its picture, and the one chosen put in the set.
 *
 * The reads and the write are stood in for at the SDK; the pictures stand
 * for the components they draw (the drawing is the pictures module's own
 * test). Each case names the broken version it rules out.
 *
 * @module admin/editor/use-a-component.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
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
  useSetPictures:
    (definitions: Readonly<Record<string, unknown>>, complete: boolean) =>
    (picture: readonly { area: string; componentId: string }[]) => (
      <span
        data-testid="picture"
        data-regions={picture
          .map(region => `${region.area}:${region.componentId}`)
          .join(",")}
        data-defined={String(
          picture.every(region => region.componentId in definitions)
        )}
        data-complete={String(complete)}
      />
    ),
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

import { UseAComponent } from "./use-a-component";

const read = vi.mocked(usePluginRoute);
const write = vi.mocked(writePluginRoute);

function listed(
  items: AreaComponentsResponse["items"],
  meta: Partial<AreaComponentsResponse["meta"]> = {}
): AreaComponentsResponse {
  return {
    items,
    meta: {
      area: "header",
      more: false,
      mayChoose: true,
      definitions: {},
      ...meta,
    },
  };
}

const HEADERS = listed([
  { id: "ridgeline", title: "Ridgeline header" },
  { id: "starter-h", title: "Starter header" },
]);

/** Answer the list and the pictures reads, by path. */
function answering(
  list: AreaComponentsResponse | undefined,
  pictures: AreaComponentsResponse | undefined = list
) {
  read.mockImplementation(({ path, enabled }) => {
    const asked = path.includes("pictures=1");
    const data = asked ? (enabled === false ? undefined : pictures) : list;
    return {
      data,
      error: null,
      pending: data === undefined,
      refetch: () => {},
    } as unknown as ReturnType<typeof usePluginRoute>;
  });
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
  toast.success.mockReset();
  toast.error.mockReset();
  answering(HEADERS);
});
afterEach(cleanup);

function shown(
  props: Partial<React.ComponentProps<typeof UseAComponent>> = {}
) {
  return render(
    <UseAComponent area="header" setId="main" current="starter-h" {...props} />
  );
}

const trigger = () => screen.getByRole("button", { name: "Use a component" });

async function open() {
  await act(async () => {
    fireEvent.click(trigger());
  });
}

/** Each listed row: its name, whether it is current, what its picture draws. */
function rows() {
  return screen.getAllByRole("option").map(option => ({
    name: option.querySelector('[data-slot="hf-name"]')?.textContent,
    current: option.textContent?.includes("(current)") === true,
    picture: option
      .querySelector('[data-testid="picture"]')
      ?.getAttribute("data-regions"),
  }));
}

describe("Use a component ▾ on the starter's card", () => {
  it("offers nothing while the list is on its way, and nothing to someone who may not change sets", () => {
    answering(undefined);
    const { unmount } = shown();
    expect(
      screen.queryByRole("button", { name: "Use a component" })
    ).toBeNull();
    unmount();
    answering(listed(HEADERS.items, { mayChoose: false }));
    shown();
    expect(
      screen.queryByRole("button", { name: "Use a component" })
    ).toBeNull();
  });

  it("asks for the header components only, and for their pictures only once the menu opens", async () => {
    shown();
    expect(screen.queryAllByTestId("picture")).toHaveLength(0);
    const asked = () =>
      read.mock.calls.map(([request]) => ({
        path: request.path,
        enabled: request.enabled,
      }));
    expect(asked()).toContainEqual({
      path: "/layouts/area-components?area=header",
      enabled: true,
    });
    expect(asked()).toContainEqual({
      path: "/layouts/area-components?area=header&pictures=1",
      enabled: false,
    });
    await open();
    expect(asked().at(-1)).toEqual({
      path: "/layouts/area-components?area=header&pictures=1",
      enabled: true,
    });
  });

  it("lists each component marked for the area with its picture, the one shown now marked current", async () => {
    shown();
    expect(trigger().getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger().textContent).toContain("Use a component");
    await open();
    expect(rows()).toEqual([
      {
        name: "Ridgeline header",
        current: false,
        picture: "header:ridgeline",
      },
      { name: "Starter header", current: true, picture: "header:starter-h" },
    ]);
  });

  it("puts the chosen component in the set, says so, and asks every set choices read again", async () => {
    write.mockResolvedValue({
      message:
        "Ridgeline header is now the header of every page that uses the Main header & footer.",
      item: {
        set: { id: "main", title: "Main" },
        area: "header",
        component: { id: "ridgeline", title: "Ridgeline header" },
      },
    } as never);
    shown();
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement);
    });
    expect(write).toHaveBeenCalledWith({
      plugin: "@nextlyhq/plugin-page-builder",
      path: "/layouts/main/areas/header",
      method: "PATCH",
      body: { component: "ridgeline" },
    });
    expect(toast.success).toHaveBeenCalledWith(
      "Ridgeline header is now the header of every page that uses the Main header & footer."
    );
    expect(askChoicesAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("writes nothing when the one shown now is chosen again", async () => {
    shown();
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[1] as HTMLElement);
    });
    expect(write).not.toHaveBeenCalled();
    expect(askChoicesAgain).not.toHaveBeenCalled();
  });

  it("says a refusal in core's own words, and changes nothing on the canvas", async () => {
    write.mockRejectedValue(
      new Error(
        "The Main header & footer has changes that aren't published yet. Publish or discard them first, then choose its header."
      )
    );
    shown();
    await open();
    await act(async () => {
      fireEvent.click(screen.getAllByRole("option")[0] as HTMLElement);
    });
    expect(toast.error).toHaveBeenCalledWith(
      "The Main header & footer has changes that aren't published yet. Publish or discard them first, then choose its header."
    );
    expect(askChoicesAgain).not.toHaveBeenCalled();
    expect(trigger().hasAttribute("disabled")).toBe(false);
  });

  it("says how to offer another when only the one shown now is marked for the area", async () => {
    answering(listed([{ id: "starter-h", title: "Starter header" }]));
    shown();
    await open();
    expect(screen.getByText(/No other component is marked/).textContent).toBe(
      "No other component is marked “Use as: Header” yet. Mark one in Components to choose it here."
    );
  });

  it("says when more are marked for the area than the list holds", async () => {
    answering(listed(HEADERS.items, { more: true }));
    shown();
    await open();
    expect(
      screen.getByText("Showing the first 50 by name.").textContent
    ).toBeTruthy();
  });

  it("speaks of the footer in its own words", async () => {
    answering(
      listed([{ id: "starter-f", title: "Starter footer" }], { area: "footer" })
    );
    shown({ area: "footer", current: "starter-f" });
    await open();
    expect(
      read.mock.calls.some(
        ([request]) => request.path === "/layouts/area-components?area=footer"
      )
    ).toBe(true);
    expect(screen.getByText(/No other component is marked/).textContent).toBe(
      "No other component is marked “Use as: Footer” yet. Mark one in Components to choose it here."
    );
  });
});
