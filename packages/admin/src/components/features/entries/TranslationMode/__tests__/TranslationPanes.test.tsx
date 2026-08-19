// Translation mode's two structural promises.
//
// INACTIVE it must be nothing at all — not a wrapper that happens to look
// transparent. Every localized document renders through this component, so a
// stray element or a stray chrome request here changes the ordinary editor for
// everyone.
//
// ACTIVE it must render its own way out, because it takes the admin's
// navigation rail. `useSuppressAdminChrome` grants `primaryRail` only to a
// request carrying `canExit: true`, and that flag is an assertion the component
// makes about itself — nothing checks that an exit is really on screen. This
// file is that check.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { TranslationPanes } from "../TranslationPanes";
import type { SourcePaneDocument } from "../SourceDocumentPane";

const { suppress } = vi.hoisted(() => ({ suppress: vi.fn() }));
vi.mock("@admin/components/layout/ChromeSuppression", () => ({
  useSuppressAdminChrome: (o: unknown) => suppress(o),
}));
// The source pane renders a whole field tree through the editor's components;
// this file is about the WRAPPER, so it is stubbed to a marker.
vi.mock("../SourceDocumentPane", () => ({
  SourceDocumentPane: ({ source }: { source: SourcePaneDocument }) => (
    <div data-testid="source-pane">{source.sourceLabel}</div>
  ),
}));

const SOURCE: SourcePaneDocument = {
  sourceLocale: "en",
  sourceLabel: "English",
  targetLabel: "Spanish",
  rtl: false,
  fields: [],
  values: {},
};

describe("TranslationPanes", () => {
  beforeEach(() => suppress.mockReset());

  it("renders its child ALONE when there is no source", () => {
    const { container } = render(
      <TranslationPanes source={undefined} onExit={() => {}}>
        <p>the editor</p>
      </TranslationPanes>
    );

    expect(screen.getByText("the editor")).toBeInTheDocument();
    // The structural claim: the child is the container's only element. A
    // wrapper div would satisfy "the editor is on screen" while changing the
    // layout of every localized document that is NOT in the mode.
    expect(container.firstElementChild?.tagName).toBe("P");
    expect(container.childElementCount).toBe(1);
    expect(screen.queryByTestId("source-pane")).not.toBeInTheDocument();
  });

  it("asks for no chrome suppression when there is no source", () => {
    render(
      <TranslationPanes source={undefined} onExit={() => {}}>
        <p>the editor</p>
      </TranslationPanes>
    );
    expect(suppress).not.toHaveBeenCalled();
  });

  it("shows the source beside the editor when there is one", () => {
    render(
      <TranslationPanes source={SOURCE} onExit={() => {}}>
        <p>the editor</p>
      </TranslationPanes>
    );

    expect(screen.getByTestId("source-pane")).toHaveTextContent("English");
    expect(screen.getByText("the editor")).toBeInTheDocument();
  });

  it("renders a way out whenever it takes the navigation rail", () => {
    // The two halves are asserted TOGETHER on purpose. `canExit: true` is a
    // claim the component makes about itself, and the suppression layer trusts
    // it — so an exit that stopped rendering would strand an author full-screen
    // with the rail already surrendered, and no test of either half alone
    // would notice.
    render(
      <TranslationPanes source={SOURCE} onExit={() => {}}>
        <p>the editor</p>
      </TranslationPanes>
    );

    const request = suppress.mock.calls[0]?.[0] as {
      layers: string[];
      canExit: boolean;
    };
    expect(request.layers).toContain("primaryRail");
    expect(request.canExit).toBe(true);
    expect(
      screen.getByRole("button", { name: /exit translation mode/i })
    ).toBeInTheDocument();
  });

  it("leaves the mode when the exit is used", async () => {
    const onExit = vi.fn();
    render(
      <TranslationPanes source={SOURCE} onExit={onExit}>
        <p>the editor</p>
      </TranslationPanes>
    );

    await userEvent.click(
      screen.getByRole("button", { name: /exit translation mode/i })
    );
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("names both languages, so the pairing is readable without the URL", () => {
    render(
      <TranslationPanes source={SOURCE} onExit={() => {}}>
        <p>the editor</p>
      </TranslationPanes>
    );
    const bar = screen.getByText(/translating/i).parentElement;
    expect(bar).toHaveTextContent("Spanish");
    expect(bar).toHaveTextContent("English");
  });
});
