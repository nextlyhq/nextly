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
  /** The section the history hands the route's change. */
  before: undefined as unknown,
  /** What the route's change answered, the section as the route left it. */
  after: undefined as unknown,
  changes: 0,
  rereads: 0,
  may: true,
  cleaned: {
    kind: "done",
    removed: ["t-spare"],
    kept: [] as unknown[],
  } as unknown,
  asked: [] as (readonly string[])[],
}));

const panels = vi.hoisted(() => ({
  tokens: undefined as
    | undefined
    | {
        tokens: { tokens: { id?: string; name: string }[]; order?: string[] };
        onCleanUp?: (ids: readonly string[]) => Promise<unknown>;
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
    changeThrough: async (
      section: string,
      change: (before: unknown) => Promise<unknown>
    ) => {
      calls.order.push(`change ${section}`);
      calls.changes += 1;
      calls.after = await change(calls.before);
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

beforeEach(() => {
  calls.order.length = 0;
  calls.asked.length = 0;
  calls.changes = 0;
  calls.rereads = 0;
  calls.may = true;
  calls.before = { tokens: [spare, accent], order: ["t-accent", "t-spare"] };
  calls.after = undefined;
  calls.cleaned = { kind: "done", removed: ["t-spare"], kept: [] };
  panels.tokens = undefined;
});

afterEach(cleanup);

function renderStudio(): void {
  render(
    <TokensStudio
      merged={{ tokens: [spare, accent], order: ["t-accent", "t-spare"] } as never}
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
    // The step's second half is the section as the route left it.
    expect(calls.after).toEqual({ tokens: [accent], order: ["t-accent"] });
    expect(answer).toEqual(calls.cleaned);
    expect(shownIds()).toEqual(
      expect.arrayContaining(["t-accent"])
    );
    expect(shownIds()).not.toContain("t-spare");
    expect(panels.tokens?.tokens.order).toEqual(["t-accent"]);
    expect(calls.rereads).toBe(1);
  });

  it("keeps no step and changes nothing shown when nothing was removed", async () => {
    calls.cleaned = { kind: "refused", reason: "No." };
    renderStudio();
    await act(async () => {
      await panels.tokens?.onCleanUp?.(["t-spare"]);
    });
    expect(calls.after).toBeUndefined();
    expect(shownIds()).toEqual(expect.arrayContaining(["t-spare", "t-accent"]));
    expect(calls.rereads).toBe(0);
  });

  it("offers no clean-up to an author who may not change Design", () => {
    calls.may = false;
    renderStudio();
    expect(panels.tokens).toBeDefined();
    expect(panels.tokens?.onCleanUp).toBeUndefined();
  });
});
