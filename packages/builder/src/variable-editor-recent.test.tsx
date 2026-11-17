// @vitest-environment jsdom

/**
 * A colour variable's picker in Design shows the same Recent colours as a
 * block's: picking one writes it as listed, and a colour typed or picked for
 * the variable joins the list.
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

import { RecentColoursStore } from "./recent-colours";
import type { PreferenceStore } from "./shell-state";
import { TokensPanel } from "./tokens-panel";

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

const SITE: SiteTokenSet = {
  tokens: [
    { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
  ],
};

/** A store over one value, as the host's browser store is. */
function memory(initial: string | null = null): PreferenceStore & {
  readonly value: string | null;
} {
  let value = initial;
  return {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
    get value() {
      return value;
    },
  };
}

/** The panel with a host that keeps what it is handed, as the editor does. */
function Hosted({
  store,
  onChange,
}: {
  store: PreferenceStore;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const [tokens, setTokens] = React.useState(SITE);
  const latest = React.useRef(tokens);
  return (
    <RecentColoursStore.Provider value={store}>
      <TokensPanel
        tokens={tokens}
        currentTokens={() => latest.current}
        onChange={next => {
          latest.current = next;
          setTokens(next);
          onChange(next);
        }}
      />
    </RecentColoursStore.Provider>
  );
}

async function openBrand(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: /^Brand/ }));
  return screen.findByRole("dialog");
}

const lightOf = (tokens: SiteTokenSet | undefined): string | undefined =>
  tokens?.tokens.find(token => token.name === "color.brand")?.values.light;

describe("a colour variable's picker", () => {
  it("shows Recent colours, and writes a picked one as it is listed", async () => {
    const onChange = vi.fn();
    const store = memory('["hsl(120 100% 25%)","#ff0000"]');
    render(<Hosted store={store} onChange={onChange} />);
    const editor = await openBrand();
    fireEvent.click(
      within(editor).getByRole("button", { name: "Pick the light colour" })
    );

    expect(within(editor).getByText("Recent colours")).toBeTruthy();
    // The second, so moving it to the front is seen.
    fireEvent.click(within(editor).getByRole("button", { name: "#ff0000" }));

    await waitFor(() =>
      expect(lightOf(onChange.mock.lastCall?.[0])).toBe("#ff0000")
    );
    expect(JSON.parse(store.value ?? "[]")).toEqual([
      "#ff0000",
      "hsl(120 100% 25%)",
    ]);
  });

  it("remembers a colour typed into the value", async () => {
    const store = memory();
    render(<Hosted store={store} onChange={vi.fn()} />);
    const editor = await openBrand();
    const field = within(editor).getByRole("textbox", { name: "Light" });
    fireEvent.change(field, { target: { value: "rgb(255, 0, 0)" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(JSON.parse(store.value ?? "[]")).toEqual(["rgb(255, 0, 0)"]);
  });

  it("does not remember a value that is no colour", async () => {
    const store = memory();
    render(<Hosted store={store} onChange={vi.fn()} />);
    const editor = await openBrand();
    const field = within(editor).getByRole("textbox", { name: "Light" });
    fireEvent.change(field, { target: { value: "banana" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(store.value).toBeNull();
  });
});
