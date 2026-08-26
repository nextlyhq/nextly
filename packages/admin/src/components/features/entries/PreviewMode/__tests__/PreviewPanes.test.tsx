/**
 * What the preview pane costs when nobody opens it, and what it asks for when
 * somebody does.
 *
 * The claims worth pinning are the ones the component's own docblock makes:
 * inactive it is structurally absent rather than merely invisible, and active
 * it releases the page MEASURE without taking the admin's navigation. Both are
 * assertions about what did NOT happen, so each carries a control.
 */
import { useEffect } from "react";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const suppress = vi.hoisted(() => vi.fn());
const frameArgs = vi.hoisted(() => vi.fn());
/*
 * Typed WIDER than its initial value on purpose: two cases below drive the
 * frame's failure and loading states, and an inferred `url: string` /
 * `reason: null` would reject exactly the states worth testing.
 */
const frameState = vi.hoisted(() => ({
  current: {
    url: "https://site.example/api/preview?token=t",
    reloadKey: 0,
    isLoading: false,
    reason: null,
    block: null,
    refresh: vi.fn(),
  } as {
    url: string | null;
    reloadKey: number;
    isLoading: boolean;
    reason: string | null;
    block: string | null;
    refresh: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@admin/components/layout/ChromeSuppression", () => ({
  useSuppressAdminChrome: (o: unknown) => suppress(o),
}));

/*
 * Only the HOOK is replaced. The block messages come from the real module, so
 * the cases below render the copy an author would actually read rather than a
 * fixture that would keep passing after the real text was emptied.
 */
vi.mock("../usePreviewFrame", async importOriginal => ({
  ...(await importOriginal<typeof import("../usePreviewFrame")>()),
  usePreviewFrame: (args: unknown) => {
    frameArgs(args);
    return frameState.current;
  },
}));

import { PreviewPanes } from "../PreviewPanes";

const props = {
  onClose: vi.fn(),
  scope: { collection: "pages", entryId: "7" },
  label: "Preview",
  revision: "r1",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Rebuilt each time: two cases below replace the whole object to drive the
  // frame's failure and loading states, and leaving that in place would carry
  // into the next test.
  frameState.current = {
    url: "https://site.example/api/preview?token=t",
    reloadKey: 0,
    isLoading: false,
    reason: null,
    block: null,
    refresh: vi.fn(),
  };
});

describe("PreviewPanes when the pane is closed", () => {
  it("keeps a box on the OUTERMOST wrapper and none on the rest", () => {
    /*
     * The wrapper elements EXIST while closed — that is what keeps the editor
     * mounted across a toggle — so the property is about what they contribute
     * to layout, and the two levels contribute differently.
     *
     * The outermost is a direct child of `.nx-page-shell`, whose `> *` rule
     * places children in the content column. A boxless child gives that rule
     * nothing to apply to and promotes ITS children into the grid, where they
     * match no selector and auto-place from the gutter — so `display: contents`
     * there mislays the ordinary closed editor while every wrapper still
     * carries the expected class. `PageShell` warns about exactly this shape.
     *
     * Everything BELOW it is boxless, which is the same remedy that warning
     * states: give the direct child a box, move the boxlessness inside it.
     */
    const { container } = render(
      <PreviewPanes {...props} open={false}>
        <p data-testid="editor">editor</p>
      </PreviewPanes>
    );

    const editor = screen.getByTestId("editor");
    let node = editor.parentElement;
    const wrappers: HTMLElement[] = [];
    while (node !== null && node !== container) {
      wrappers.push(node);
      node = node.parentElement;
    }

    // Control: more than one wrapper, so "outermost" and "the rest" are
    // different elements and the two assertions below cannot be the same one.
    expect(wrappers.length).toBeGreaterThan(1);

    const outermost = wrappers[wrappers.length - 1];
    expect(outermost?.className ?? "").not.toContain("contents");
    for (const wrapper of wrappers.slice(0, -1)) {
      expect(wrapper.className).toContain("contents");
    }
  });

  it("suppresses no chrome layer, so a closed pane costs the page nothing", () => {
    render(
      <PreviewPanes {...props} open={false}>
        <p>editor</p>
      </PreviewPanes>
    );

    // The hook IS called now, because the component always renders — so the
    // property is what it ASKS FOR. An empty layer list registers nothing;
    // asserting the hook was never called would only pin the old mechanism.
    expect(suppress).toHaveBeenCalledWith({ layers: [], canExit: true });
  });

  it("mints nothing, so no credential and no audit row for a pane nobody opened", () => {
    render(
      <PreviewPanes {...props} open={false}>
        <p>editor</p>
      </PreviewPanes>
    );

    // The frame hook is mocked here, so this pins the ARGUMENT that decides it
    // rather than the mint itself: `active` false is what keeps it quiet, and
    // it is the only thing standing between a closed pane and an audit row.
    expect(frameArgs).toHaveBeenCalledWith(
      expect.objectContaining({ active: false })
    );
  });
});

describe("toggling the preview", () => {
  /**
   * A child that reports every time it MOUNTS.
   *
   * The defect this covers is invisible in the rendered output — the editor
   * looks identical after a remount, and only state that never reached the
   * form is gone. Counting mounts is what makes it observable.
   */
  function MountCounter({ onMount }: { onMount: () => void }) {
    useEffect(() => {
      onMount();
    }, [onMount]);
    return <p data-testid="editor">editor</p>;
  }

  it("keeps the editor MOUNTED when the pane opens and closes", () => {
    /*
     * Returning `children` alone when closed and a wrapped tree when open put
     * the editor under a different element type at a different depth, so React
     * unmounted and remounted it on every toggle — discarding anything a field
     * held that had not reached the form. A field keeping a temporarily invalid
     * value locally, exactly so it does not publish nonsense, is the case that
     * hurts: the work looks saved and vanishes on a click.
     */
    const onMount = vi.fn();
    const { rerender } = render(
      <PreviewPanes {...props} open={false}>
        <MountCounter onMount={onMount} />
      </PreviewPanes>
    );
    expect(onMount).toHaveBeenCalledTimes(1);

    rerender(
      <PreviewPanes {...props} open>
        <MountCounter onMount={onMount} />
      </PreviewPanes>
    );
    expect(onMount).toHaveBeenCalledTimes(1);

    rerender(
      <PreviewPanes {...props} open={false}>
        <MountCounter onMount={onMount} />
      </PreviewPanes>
    );
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it("DOES mount it once to begin with, so the count above is not stuck at zero", () => {
    // The control: a counter that never fires would satisfy every assertion
    // above while proving nothing.
    const onMount = vi.fn();
    render(
      <PreviewPanes {...props} open={false}>
        <MountCounter onMount={onMount} />
      </PreviewPanes>
    );

    expect(onMount).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewPanes when the pane is open", () => {
  it("releases the page measure and keeps the admin's navigation", () => {
    render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    // The POSITIVE half: it does ask, so the negative above is a true absence
    // rather than a hook that never runs.
    expect(suppress).toHaveBeenCalledWith({
      layers: ["pageFrame"],
      canExit: true,
    });
  });

  it("declares its own content container around the editor", () => {
    // Without this the editor's `@4xl/content:` queries measure the dashboard's
    // full-width `<main>` while rendering into half of it, and the document
    // rail is laid out beside a column with no room for it.
    const { container } = render(
      <PreviewPanes {...props} open>
        <p data-testid="editor">editor</p>
      </PreviewPanes>
    );

    const editor = screen.getByTestId("editor");
    expect(container.querySelector(".\\@container\\/content")).not.toBeNull();
    expect(editor.closest(".\\@container\\/content")).not.toBeNull();
  });
});

describe("retrying after a mint that failed", () => {
  it("leaves the refresh control usable", async () => {
    // The message beside it asks the editor to try again, and `refresh` mints
    // again — so a control disabled here points at an affordance that is not
    // there, and the only retry was to close the pane and reopen it.
    frameState.current = {
      ...frameState.current,
      url: null,
      reason: "failed",
      isLoading: false,
    };

    render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(
      screen.getByRole("button", { name: "Refresh the preview" })
    ).toBeEnabled();
  });

  it("disables it only while a mint is in flight", () => {
    // The control for the case above: there IS a state that disables it, so
    // the assertion above is about the failure case rather than about a
    // control that can never be disabled at all.
    frameState.current = {
      ...frameState.current,
      url: null,
      reason: null,
      isLoading: true,
    };

    render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(
      screen.getByRole("button", { name: "Refresh the preview" })
    ).toBeDisabled();
  });
});

describe("a pane that holds a url it must not frame", () => {
  /*
   * Both blocking states end the same way if the frame is rendered anyway: the
   * site receives a request with no preview session and answers with the
   * PUBLISHED page, inside a pane captioned as a draft. So the assertion that
   * matters is the absence of the iframe, and it carries its control below.
   */
  it("renders no iframe when the site is on another origin", () => {
    frameState.current = { ...frameState.current, block: "crossOrigin" };

    const { container } = render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders no iframe when another pane took the session", () => {
    frameState.current = { ...frameState.current, block: "superseded" };

    const { container } = render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(container.querySelector("iframe")).toBeNull();
  });

  it("DOES render one when nothing blocks it", () => {
    // The control for both absences above: the pane is capable of rendering a
    // frame, so those are refusals rather than a component that never does.
    const { container } = render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(container.querySelector("iframe")).not.toBeNull();
  });

  it("keeps the new-tab link, which is what the message points at", () => {
    // A cross-origin site previews perfectly well in a TAB — only the frame
    // cannot carry the cookie — so removing the link with the frame would take
    // away the remedy along with the problem.
    frameState.current = { ...frameState.current, block: "crossOrigin" };

    render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(
      screen.getByRole("link", { name: "Open the preview in a new tab" })
    ).toHaveAttribute("href", "https://site.example/api/preview?token=t");
  });

  it("leaves refresh enabled, since refreshing is how the session comes back", () => {
    frameState.current = { ...frameState.current, block: "superseded" };

    render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(
      screen.getByRole("button", { name: "Refresh the preview" })
    ).toBeEnabled();
  });
});

describe("a refusal is worded for the document in hand", () => {
  /*
   * The pane serves an entry and a Single alike, so a message naming the wrong
   * kind sends someone to a field they cannot change — and for a Single the
   * entry advice is exactly wrong, since it is addressed by a slug it always
   * has. The noun is DERIVED from the scope here rather than passed beside it.
   */
  it("tells a Single's author about the preview URL, not a slug", () => {
    frameState.current = {
      ...frameState.current,
      url: null,
      reason: "unavailable",
    };

    render(
      <PreviewPanes {...props} scope={{ single: "home" }} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(screen.getByText(/this single/i)).toBeInTheDocument();
    expect(screen.queryByText(/slug/i)).toBeNull();
  });

  it("still tells an ENTRY's author about the slug", () => {
    // The control: the refusal above is about the scope rather than the pane
    // having stopped mentioning slugs at all.
    frameState.current = {
      ...frameState.current,
      url: null,
      reason: "unavailable",
    };

    render(
      <PreviewPanes {...props} open>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(screen.getByText(/slug/i)).toBeInTheDocument();
  });
});

describe("the document change that refreshes the frame", () => {
  it("does not reload on the first render", () => {
    // The frame has just minted and loaded. Treating the token's initial value
    // as a save would render the site twice on every open.
    render(
      <PreviewPanes {...props} open revision="r1">
        <p>editor</p>
      </PreviewPanes>
    );

    expect(frameState.current.refresh).not.toHaveBeenCalled();
  });

  it("reloads when the document revision changes", () => {
    const { rerender } = render(
      <PreviewPanes {...props} open revision="r1">
        <p>editor</p>
      </PreviewPanes>
    );
    // The control for the assertion above: same component, same props but for
    // the token, and now it DOES refresh — so the silence above is about the
    // first render rather than about a wire that was never connected.
    expect(frameState.current.refresh).not.toHaveBeenCalled();

    rerender(
      <PreviewPanes {...props} open revision="r2">
        <p>editor</p>
      </PreviewPanes>
    );

    expect(frameState.current.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not reload again when something else rerenders it", () => {
    const { rerender } = render(
      <PreviewPanes {...props} open revision="r1">
        <p>editor</p>
      </PreviewPanes>
    );
    rerender(
      <PreviewPanes {...props} open revision="r2">
        <p>editor</p>
      </PreviewPanes>
    );
    expect(frameState.current.refresh).toHaveBeenCalledTimes(1);

    rerender(
      <PreviewPanes {...props} open revision="r2" label="Preview">
        <p>editor</p>
      </PreviewPanes>
    );

    expect(frameState.current.refresh).toHaveBeenCalledTimes(1);
  });
});
