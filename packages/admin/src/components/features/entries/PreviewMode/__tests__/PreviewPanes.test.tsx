/**
 * What the preview pane costs when nobody opens it, and what it asks for when
 * somebody does.
 *
 * The claims worth pinning are the ones the component's own docblock makes:
 * inactive it is structurally absent rather than merely invisible, and active
 * it releases the page MEASURE without taking the admin's navigation. Both are
 * assertions about what did NOT happen, so each carries a control.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const suppress = vi.hoisted(() => vi.fn());
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
    refresh: vi.fn(),
  } as {
    url: string | null;
    reloadKey: number;
    isLoading: boolean;
    reason: string | null;
    refresh: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@admin/components/layout/ChromeSuppression", () => ({
  useSuppressAdminChrome: (o: unknown) => suppress(o),
}));

vi.mock("../usePreviewFrame", () => ({
  usePreviewFrame: () => frameState.current,
}));

import { PreviewPanes } from "../PreviewPanes";

const props = {
  onClose: vi.fn(),
  collection: "pages",
  entryId: "7",
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
    refresh: vi.fn(),
  };
});

describe("PreviewPanes when the pane is closed", () => {
  it("renders the editor with no wrapper of its own", () => {
    const { container } = render(
      <PreviewPanes {...props} open={false}>
        <p data-testid="editor">editor</p>
      </PreviewPanes>
    );

    // The child is the ROOT, so nothing was wrapped around it. A wrapper that
    // merely had no styles would still show up here as a parent element.
    expect(container.firstElementChild).toBe(screen.getByTestId("editor"));
  });

  it("asks for no chrome, so a closed pane costs the page nothing", () => {
    render(
      <PreviewPanes {...props} open={false}>
        <p>editor</p>
      </PreviewPanes>
    );

    expect(suppress).not.toHaveBeenCalled();
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
