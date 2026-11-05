// @vitest-environment jsdom
/**
 * A publish removing a component's fields: the hold asked for with the count
 * the designer was told, and the question asked again when that count grew.
 *
 * The before-action seam is captured rather than run by a host: the test calls
 * the handler as the runner would, and answers the dialog it opens. What the
 * handler resolves or throws is what the runner turns into the publish going
 * ahead, being cancelled or being refused.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RemovalHoldResult } from "../removal-hold-contract";

/** Every mounted handler, as the runner holds them. */
const befores = new Set<(action: string) => Promise<void> | void>();
const writes = vi.fn();
const reads = vi.fn();
/** The document's status: `null` for a store with no Draft/Published lifecycle. */
let status: { status: string; hasWorkingDraft: boolean } | null = {
  status: "published",
  hasWorkingDraft: true,
};

vi.mock("@nextlyhq/plugin-sdk/admin", async () => {
  const React = await import("react");
  return {
    useBeforeDocumentAction: (
      handler: (action: string) => Promise<void> | void
    ) => {
      const latest = React.useRef(handler);
      React.useEffect(() => {
        latest.current = handler;
      });
      React.useEffect(() => {
        const run = (action: string) => latest.current(action);
        befores.add(run);
        return () => {
          befores.delete(run);
        };
      }, []);
    },
    useDocumentIdentity: () => ({ documentId: "hero" }),
    useDocumentLocale: () => null,
    useDocumentStatus: () => status,
    readPluginRoute: (args: { path: string }) => reads(args.path),
    writePluginRoute: (args: { path: string; body: unknown }) =>
      writes(args.path, args.body),
  };
});

const { useRemovalHold, HOLD_FAILED } = await import("./removal-hold-client");

afterEach(() => {
  cleanup();
  befores.clear();
  writes.mockReset();
  reads.mockReset();
  status = { status: "published", hasWorkingDraft: true };
});

/** A component exposing these fields. */
const component = (fields: string[]) => ({
  formatVersion: 1,
  kind: "component",
  nodes: [],
  exposed: fields.map(id => ({
    id,
    label: id,
    nodeId: "h",
    propPath: "text",
    type: "text",
  })),
});

function Harness({
  fields,
  confirmed,
}: {
  fields: string[];
  confirmed?: { count: number; complete: boolean };
}): JSX.Element {
  return useRemovalHold({
    document: () => component(fields) as never,
    confirmed: () => confirmed,
  });
}

/** The live definition exposes `title` and `body`. */
function liveExposes(): void {
  reads.mockResolvedValue({
    live: { properties: ["title", "body"], slots: [] },
    retired: { properties: [], slots: [] },
    reach: null,
    pages: null,
  });
}

const answer = (item: RemovalHoldResult) => ({ message: "", item });

/** Run every before-action as a publish would. */
const publish = () => Promise.all([...befores].map(run => run("publish")));

describe("a publish removing a component's fields", () => {
  it("asks for a hold with the removed fields and the count told", async () => {
    liveExposes();
    writes.mockResolvedValue(
      answer({ kind: "held", reach: { count: 2, complete: true } })
    );
    render(
      <Harness fields={["body"]} confirmed={{ count: 2, complete: true }} />
    );

    await publish();

    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0]![1]).toEqual({
      id: "hero",
      properties: ["title"],
      slots: [],
      confirmed: 2,
      confirmedComplete: true,
    });
  });

  it("asks nothing for a publish that removes no field, or a save", async () => {
    liveExposes();
    render(<Harness fields={["title", "body"]} />);

    await publish();
    await Promise.all([...befores].map(run => run("save")));

    expect(writes).not.toHaveBeenCalled();
  });

  it("asks for a hold on a save where the store has no lifecycle", async () => {
    status = null;
    liveExposes();
    writes.mockResolvedValue(
      answer({ kind: "held", reach: { count: 1, complete: true } })
    );
    render(<Harness fields={["body"]} />);

    await Promise.all([...befores].map(run => run("save")));

    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("asks again with the grown count, and holds what was confirmed", async () => {
    liveExposes();
    writes
      .mockResolvedValueOnce(
        answer({ kind: "recount", reach: { count: 3, complete: false } })
      )
      .mockResolvedValueOnce(
        answer({ kind: "held", reach: { count: 3, complete: false } })
      );
    render(
      <Harness fields={["body"]} confirmed={{ count: 2, complete: true }} />
    );

    let done = false;
    const running = publish().then(() => {
      done = true;
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("placed directly in 2 documents");
    expect(dialog.textContent).toContain("now placed in at least 3 documents");
    expect(done).toBe(false);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Publish and remove" })
      );
      await running;
    });

    expect(done).toBe(true);
    expect(writes.mock.calls[1]![1]).toMatchObject({ confirmed: 3 });
  });

  it("calls the publish off when the designer cancels", async () => {
    liveExposes();
    writes.mockResolvedValue(
      answer({ kind: "recount", reach: { count: 3, complete: true } })
    );
    render(
      <Harness fields={["body"]} confirmed={{ count: 2, complete: true }} />
    );

    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("says how many place it when no count was told", async () => {
    liveExposes();
    writes.mockResolvedValue(
      answer({ kind: "recount", reach: { count: 1, complete: true } })
    );
    render(<Harness fields={["body"]} />);

    void publish().catch(() => undefined);
    const dialog = await screen.findByRole("alertdialog");

    expect(writes.mock.calls[0]![1]).toMatchObject({ confirmed: 0 });
    expect(dialog.textContent).toContain(
      "This component is placed directly in 1 document."
    );
  });

  it("refuses the publish when the hold cannot be asked for", async () => {
    liveExposes();
    writes.mockRejectedValue(new Error("network"));
    render(<Harness fields={["body"]} />);

    await expect(publish()).rejects.toThrow(HOLD_FAILED);
  });
});
