// @vitest-environment jsdom

/**
 * "Clean up unused…" on the Colours tab: every colour the site made that
 * nothing uses is listed, ticked, with "Remove N colours"; built-in colours
 * never are. Confirming sends the ticked ones in one step. One the host
 * kept, because it became used meanwhile, is named with where it is used.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ColourCleanUpResult } from "./colour-cleanup";
import { TokensPanel } from "./tokens-panel";
import type { VariableReach, VariablesAccess } from "./variable-usage";

afterEach(cleanup);

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

const colour = (name: string, label: string, light = "#123456") => ({
  name: `color.${name}`,
  label,
  kind: "color" as const,
  values: { light },
});

/** What the site's code and the engine supply: the built-in colours. */
const BUILT_IN: SiteTokenSet = {
  tokens: [colour("primary", "Primary"), colour("surface", "Surface")],
};

const SITE: SiteTokenSet = {
  tokens: [
    ...BUILT_IN.tokens,
    colour("spare", "Spare"),
    colour("extra", "Extra"),
    colour("used", "Used"),
    colour("on-page", "On page"),
  ],
};

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

const reach = (documents: number, complete = true): VariableReach => ({
  documents,
  byKind: { ...NONE, pages: documents },
  sharedStyles: [],
  blockDefaults: [],
  variables: [],
  siteText: [],
  complete,
});

/** Counts: Used on a page, every other colour on none. */
function access(complete = true): VariablesAccess {
  return {
    usage: async ids => ({
      whole: complete,
      counting: !complete,
      mayCount: false,
      variables: new Map(
        ids.map(id => [id, reach(id === "color.used" ? 1 : 0, complete)])
      ),
    }),
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
  };
}

type CleanUp = (ids: readonly string[]) => Promise<ColourCleanUpResult>;

function Panel({
  onCleanUp,
  usage = access(),
  readOnly = false,
}: {
  onCleanUp?: CleanUp;
  usage?: VariablesAccess;
  readOnly?: boolean;
}): React.JSX.Element {
  return (
    <TokensPanel
      tokens={SITE}
      currentTokens={() => SITE}
      onChange={() => {}}
      supplied={BUILT_IN}
      groups={["colours"]}
      search=""
      usage={usage}
      usedOnPage={new Set(["color.on-page"])}
      readOnly={readOnly}
      {...(onCleanUp === undefined ? {} : { onCleanUp })}
    />
  );
}

const done = (
  removed: readonly string[],
  kept: Extract<ColourCleanUpResult, { kind: "done" }>["kept"] = []
): ColourCleanUpResult => ({ kind: "done", removed, kept });

/** Opens the clean-up once every colour's count has been read. */
async function openCleanUp(): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Clean up unused…" })
  );
  const dialog = await screen.findByRole("dialog");
  // Listed once the counts are in.
  await within(dialog).findByRole("checkbox", { name: "Spare" });
  return dialog;
}

describe("Clean up unused…", () => {
  it("lists every colour the site made that nothing uses, each ticked, and never a built-in one", async () => {
    render(<Panel onCleanUp={async () => done([])} />);
    const dialog = await openCleanUp();
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes.map(box => box.getAttribute("aria-label"))).toEqual([
      "Spare",
      "Extra",
    ]);
    for (const box of boxes)
      expect(box.getAttribute("aria-checked")).toBe("true");
    // Used by a page, used on the page open now, or built in: not listed.
    for (const name of ["Primary", "Surface", "Used", "On page"]) {
      expect(within(dialog).queryByRole("checkbox", { name })).toBeNull();
    }
    expect(
      within(dialog).getByRole("button", { name: "Remove 2 colours" })
    ).toBeDefined();
  });

  it("removes the ticked colours in one step, then closes, giving focus back", async () => {
    const onCleanUp = vi.fn<CleanUp>(async ids => done(ids));
    render(<Panel onCleanUp={onCleanUp} />);
    const dialog = await openCleanUp();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Extra" }));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove 1 colour" })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onCleanUp).toHaveBeenCalledTimes(1);
    expect(onCleanUp).toHaveBeenCalledWith(["color.spare"]);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Clean up unused…" })
      )
    );
  });

  it("keeps one that became used meanwhile, naming it and where, and says the rest went", async () => {
    render(
      <Panel
        onCleanUp={async () =>
          done(
            ["color.spare"],
            [
              {
                id: "color.extra",
                name: "Extra",
                reason: "Extra is used on Home.",
              },
            ]
          )
        }
      />
    );
    const dialog = await openCleanUp();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove 2 colours" })
    );
    expect(await within(dialog).findByText("Removed 1 colour.")).toBeDefined();
    expect(within(dialog).getByText("Kept, as it's in use now:")).toBeDefined();
    expect(within(dialog).getByText("Extra is used on Home.")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says why when the clean-up is refused, keeping the list as it was", async () => {
    render(
      <Panel
        onCleanUp={async () => ({
          kind: "refused",
          reason: "You can't change this site's design.",
        })}
      />
    );
    const dialog = await openCleanUp();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove 2 colours" })
    );
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "You can't change this site's design."
    );
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(2);
  });

  it("claims nothing while the count is not whole, saying so", async () => {
    render(<Panel onCleanUp={async () => done([])} usage={access(false)} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Clean up unused…" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Counting usage…")).toBeDefined();
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      within(dialog).getByRole("button", { name: "Remove 0 colours" })
    ).toHaveProperty("disabled", true);
  });

  it("says when there is nothing to clean up", async () => {
    const usage: VariablesAccess = {
      ...access(),
      usage: async ids => ({
        whole: true,
        counting: false,
        mayCount: false,
        variables: new Map(ids.map(id => [id, reach(1)])),
      }),
    };
    render(<Panel onCleanUp={async () => done([])} usage={usage} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Clean up unused…" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Every colour you made is in use.")
    ).toBeDefined();
  });

  it("is reached and used from the keyboard, Escape giving focus back", async () => {
    const onCleanUp = vi.fn<CleanUp>(async ids => done(ids));
    render(<Panel onCleanUp={onCleanUp} />);
    const open = await screen.findByRole("button", {
      name: "Clean up unused…",
    });
    open.focus();
    fireEvent.keyDown(open, { key: "Enter" });
    fireEvent.click(open);
    const dialog = await screen.findByRole("dialog");
    const spare = await within(dialog).findByRole("checkbox", {
      name: "Spare",
    });
    spare.focus();
    fireEvent.keyDown(spare, { key: " " });
    fireEvent.click(spare);
    expect(spare.getAttribute("aria-checked")).toBe("false");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(open));
    expect(onCleanUp).not.toHaveBeenCalled();
  });

  it("is offered only where the host can clean up and the author may change Design", async () => {
    const { unmount } = render(<Panel />);
    await screen.findByRole("radiogroup", { name: "Show colours" });
    expect(
      screen.queryByRole("button", { name: "Clean up unused…" })
    ).toBeNull();
    unmount();
    render(<Panel readOnly onCleanUp={async () => done([])} />);
    await screen.findByRole("radiogroup", { name: "Show colours" });
    expect(
      screen.queryByRole("button", { name: "Clean up unused…" })
    ).toBeNull();
  });
});
