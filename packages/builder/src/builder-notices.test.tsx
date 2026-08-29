// @vitest-environment jsdom

/**
 * Notices, and the failure they exist for.
 *
 * The queue's own rules are cheap to assert and are asserted here. What is only
 * true in COMPOSITION is the case the surface was built for: a class creation
 * refused after the author has clicked another block. The style inspector keys
 * the selector by node, so that click unmounts the component holding the
 * refusal, and the report has to survive it.
 *
 * The selector is driven through a real keyed remount rather than by calling
 * the sink directly. Raising a notice by hand would assert that a region
 * renders what it is given, which is not the property in doubt.
 *
 * @module builder-notices.test
 */
import type { NamedClass } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BuilderNoticeRegion,
  NoticeSinkProvider,
  useNoticeQueue,
} from "./builder-notices";
import { ClassSelector } from "./class-selector";

afterEach(cleanup);

const LIBRARY: NamedClass[] = [
  { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} },
];

/** A creation whose answer the test decides, after the author has moved on. */
function deferredCreation(): {
  onCreateClass: () => Promise<{ ok: false; reason: string }>;
  refuse: (reason: string) => Promise<void>;
} {
  let settle: ((value: { ok: false; reason: string }) => void) | undefined;
  const pending = new Promise<{ ok: false; reason: string }>(resolve => {
    settle = resolve;
  });
  return {
    onCreateClass: () => pending,
    refuse: async reason => {
      await act(async () => {
        settle?.({ ok: false, reason });
        await pending;
      });
    },
  };
}

/**
 * The shell's arrangement in miniature: the region ABOVE the keyed selector.
 *
 * Keyed by `nodeId` exactly as `style-inspector-panel` keys it, because that
 * key is the mechanism under test — an unkeyed selector is reused across the
 * change and never unmounts, so the defect cannot occur and the test would
 * pass against the broken code.
 */
function Harness({
  nodeId,
  onCreateClass,
}: {
  nodeId: string;
  onCreateClass: () => Promise<{ ok: false; reason: string }>;
}): React.ReactElement {
  const notices = useNoticeQueue();
  return (
    <>
      <BuilderNoticeRegion
        notices={notices.notices}
        onDismiss={notices.dismiss}
      />
      <NoticeSinkProvider raise={notices.raise}>
        <ClassSelector
          key={nodeId}
          library={LIBRARY}
          nodeClassIds={[]}
          nodeId={nodeId}
          onCreateClass={onCreateClass}
          onNodeClassesChange={vi.fn(() => "applied" as const)}
        />
      </NoticeSinkProvider>
    </>
  );
}

function field(): HTMLElement {
  return screen.getByRole("combobox");
}

describe("a refusal that arrives after the author has moved on", () => {
  it("is still reported, from a surface the selection did not unmount", async () => {
    const { onCreateClass, refuse } = deferredCreation();
    const view = render(
      <Harness nodeId="node-a" onCreateClass={onCreateClass} />
    );

    fireEvent.change(field(), { target: { value: "promo" } });
    fireEvent.keyDown(field(), { key: "Enter" });

    // The author clicks another block while the write is still on the network.
    // This is the unmount: the instance holding the refusal is now gone.
    view.rerender(<Harness nodeId="node-b" onCreateClass={onCreateClass} />);

    await refuse("This class could not be saved.");

    expect(screen.getByText("This class could not be saved.")).toBeTruthy();
  });

  it("does not ALSO report inline when the selector is still there", async () => {
    // One refusal, one place to read it. A control that can speak for itself
    // does, and the region stays quiet — a region repeating what is already on
    // screen is one an author learns to ignore.
    const { onCreateClass, refuse } = deferredCreation();
    render(<Harness nodeId="node-a" onCreateClass={onCreateClass} />);

    fireEvent.change(field(), { target: { value: "promo" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await refuse("This class could not be saved.");

    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/);
    // The region stays mounted so it can announce later reports, and is EMPTY
    // — a region repeating what is already on screen is one an author learns
    // to ignore.
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("the queue", () => {
  function Queue(): React.ReactElement {
    const notices = useNoticeQueue();
    return (
      <>
        <button onClick={() => notices.raise("Same news")} type="button">
          raise
        </button>
        <button onClick={() => notices.raise("Other news")} type="button">
          raise other
        </button>
        <BuilderNoticeRegion
          notices={notices.notices}
          onDismiss={notices.dismiss}
        />
      </>
    );
  }

  /*
   * Where the region SITS is asserted in `builder-shell.test`, not here: it
   * inherits the `--nx-builder-*` tokens by being rendered inside the chrome
   * element, and that structure exists only in the shell. Asserting it against
   * this file's own harness would have been asserting the harness.
   */

  it("does not re-announce every notice when one is added", () => {
    // `role="status"` is atomic by default, so a second notice makes a screen
    // reader read the first one again.
    render(<Queue />);
    fireEvent.click(screen.getByRole("button", { name: "raise" }));
    expect(screen.getByRole("status").getAttribute("aria-atomic")).toBe(
      "false"
    );
  });

  it("keeps the live region MOUNTED while it is empty", () => {
    /*
     * A polite live region has to exist before its content changes. One
     * inserted already carrying its message is not reliably announced — unlike
     * `role="alert"` — so a screen-reader user could miss the only report that
     * a class was not created. Empty it holds no rows.
     */
    render(<Queue />);
    const region = screen.getByRole("status");
    expect(region).toBeTruthy();
    expect(region.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("does not stack one sentence twice", () => {
    render(<Queue />);
    const raise = screen.getByRole("button", { name: "raise" });
    fireEvent.click(raise);
    fireEvent.click(raise);
    expect(screen.getAllByText("Same news")).toHaveLength(1);
  });

  it("dismisses the one addressed, and keeps the rest", () => {
    render(<Queue />);
    fireEvent.click(screen.getByRole("button", { name: "raise" }));
    fireEvent.click(screen.getByRole("button", { name: "raise other" }));
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);

    // The FIRST dismiss button belongs to "Same news", so the survivor names
    // which notice went — a count alone would pass if the wrong one were
    // removed.
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("Same news")).toBeNull();
    expect(screen.getByText("Other news")).toBeTruthy();
  });

  it("reports a repeat the author had already dismissed", () => {
    // Identity is a counter rather than the sentence: the same failure can
    // happen twice, and an author who cleared the first is owed the second.
    render(<Queue />);
    const raise = screen.getByRole("button", { name: "raise" });
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(raise);
    expect(screen.getByText("Same news")).toBeTruthy();
  });
});
