// @vitest-environment jsdom
/**
 * The Variables studio's "Clean up unused…": the colours go through the
 * clean-up route as one step of the editor's history, held edits written
 * first, and the studio stops showing the removed ones at once. An author
 * who may not change Design is offered none.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  order: [] as string[],
  /** The halves the route's change answered for the history's step. */
  halves: undefined as unknown,
  changes: 0,
  rereads: 0,
  may: true,
  cleaned: undefined as unknown,
  asked: [] as (readonly string[])[],
  /** Holds the route's answer back until the test lets it go. */
  gate: undefined as undefined | Promise<void>,
}));

const panels = vi.hoisted(() => ({
  tokens: undefined as
    | undefined
    | {
        tokens: { tokens: { id?: string; name: string }[]; order?: string[] };
        onCleanUp?: (ids: readonly string[]) => Promise<unknown>;
        onChange?: (next: unknown) => void;
      },
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({ useCan: () => calls.may }));

vi.mock("../site-style-client", () => ({
  useSaveSiteStyle: () => ({
    save: async () => ({ saved: true, issues: {} }),
    reserve: () => ({ save: async () => ({}), cancel: () => {} }),
    reread: () => {
      calls.rereads += 1;
    },
    changeThrough: async (section: string, change: () => Promise<unknown>) => {
      calls.order.push(`change ${section}`);
      calls.changes += 1;
      calls.halves = await change();
    },
  }),
  useHeldSiteStyle: () => ({
    extend: () => {},
    release: async () => {
      calls.order.push("release");
    },
  }),
}));

vi.mock("../variables-client", async importOriginal => ({
  ...(await importOriginal<typeof import("../variables-client")>()),
  cleanUpUnused: async (ids: readonly string[]) => {
    calls.order.push("route");
    calls.asked.push(ids);
    await calls.gate;
    return calls.cleaned;
  },
}));

vi.mock("@nextlyhq/builder/shell", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/builder/shell")>()),
  TokensPanel: (props: NonNullable<typeof panels.tokens>) => {
    panels.tokens = props;
    return null;
  },
}));

const { TokensStudio, VariablesTab } = await import("./site-style-studios");

const colour = (id: string) => ({
  id,
  name: `color.${id.slice(2)}`,
  kind: "color",
  values: { light: "#123456" },
});
const spare = colour("t-spare");
const accent = colour("t-accent");
const blueAccent = { ...accent, values: { light: "#0000ff" } };
const added = colour("t-added");

beforeEach(() => {
  calls.order.length = 0;
  calls.asked.length = 0;
  calls.changes = 0;
  calls.rereads = 0;
  calls.may = true;
  calls.halves = undefined;
  calls.gate = undefined;
  calls.cleaned = {
    result: { kind: "done", removed: ["t-spare"], kept: [] },
    // As the server answered them: another author has since made Accent
    // blue and added a colour, which this studio never read.
    halves: {
      before: { tokens: [spare, blueAccent, added] },
      after: { tokens: [blueAccent, added], order: ["t-added"] },
    },
  };
  panels.tokens = undefined;
});

afterEach(cleanup);

function renderStudio(): void {
  render(
    <TokensStudio
      merged={
        { tokens: [spare, accent], order: ["t-accent", "t-spare"] } as never
      }
      supplied={undefined}
      pending={false}
    >
      <VariablesTab tab="colours" />
    </TokensStudio>
  );
}

const shownIds = () =>
  (panels.tokens?.tokens.tokens ?? []).flatMap(token =>
    token.id === undefined ? [] : [token.id]
  );

describe("cleaning up unused colours from the studio", () => {
  it("removes through the route as one step, held edits written first, and stops showing them", async () => {
    renderStudio();
    let answer: unknown;
    await act(async () => {
      answer = await panels.tokens?.onCleanUp?.(["t-spare", "t-accent"]);
    });
    expect(calls.order).toEqual(["release", "change tokens", "route"]);
    expect(calls.asked).toEqual([["t-spare", "t-accent"]]);
    // The step's halves are the server's, as the route answered them.
    expect(calls.halves).toEqual({
      before: { tokens: [spare, blueAccent, added] },
      after: { tokens: [blueAccent, added], order: ["t-added"] },
    });
    expect(answer).toEqual({ kind: "done", removed: ["t-spare"], kept: [] });
    // What the server holds now is shown, not this studio's older copy.
    expect(shownIds()).toEqual(expect.arrayContaining(["t-accent", "t-added"]));
    expect(shownIds()).not.toContain("t-spare");
    expect(
      panels.tokens?.tokens.tokens.find(token => token.id === "t-accent")
    ).toMatchObject({ values: { light: "#0000ff" } });
    expect(panels.tokens?.tokens.order).toEqual(["t-added"]);
    expect(calls.rereads).toBe(1);
  });

  it("keeps an edit made while the clean-up runs, rather than the server's answer from before it", async () => {
    renderStudio();
    let letGo: () => void = () => {};
    calls.gate = new Promise(resolve => {
      letGo = resolve;
    });
    let running: Promise<unknown> | undefined;
    await act(async () => {
      running = panels.tokens?.onCleanUp?.(["t-spare"]);
    });
    // The author closes the dialog and makes Accent red meanwhile.
    const redAccent = { ...accent, values: { light: "#ff0000" } };
    act(() => {
      panels.tokens?.onChange?.({
        tokens: [spare, redAccent],
        order: ["t-accent", "t-spare"],
      });
    });
    await act(async () => {
      letGo();
      await running;
    });
    expect(
      panels.tokens?.tokens.tokens.find(token => token.id === "t-accent")
    ).toMatchObject({ values: { light: "#ff0000" } });
    expect(calls.rereads).toBe(1);
  });

  it("keeps no step and changes nothing shown when nothing was removed", async () => {
    calls.cleaned = { result: { kind: "refused", reason: "No." } };
    renderStudio();
    await act(async () => {
      await panels.tokens?.onCleanUp?.(["t-spare"]);
    });
    expect(calls.halves).toBeUndefined();
    expect(shownIds()).toEqual(expect.arrayContaining(["t-spare", "t-accent"]));
    // Read again all the same, so what is shown is what is stored.
    expect(calls.rereads).toBe(1);
  });

  it("offers no clean-up to an author who may not change Design", () => {
    calls.may = false;
    renderStudio();
    expect(panels.tokens).toBeDefined();
    expect(panels.tokens?.onCleanUp).toBeUndefined();
  });
});
