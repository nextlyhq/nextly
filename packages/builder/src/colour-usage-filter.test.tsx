// @vitest-environment jsdom

/**
 * The Colours tab's usage filter: "All", "Unused" and "Used on this page",
 * "All" by default. Unused claims only what the site's count has shown
 * unused, and says "Counting usage…" while the count is not whole; "Used on
 * this page" follows the open page as it changes, before any save.
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
import { afterEach, beforeAll, describe, expect, it } from "vitest";

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

const colour = (name: string, light = "#123456") => ({
  name: `color.${name}`,
  kind: "color" as const,
  values: { light },
});

const SITE: SiteTokenSet = {
  tokens: [
    colour("brand"),
    colour("accent"),
    colour("spare"),
    colour("button"),
    {
      name: "shadow.lift",
      kind: "shadow",
      values: { light: "0 1px 2px var(--site-color-accent)" },
    },
  ],
};

const NONE = { pages: 0, components: 0, patterns: 0, layouts: 0 };

const reach = (
  documents: number,
  complete = true,
  blockDefaults: readonly string[] = []
): VariableReach => ({
  documents,
  byKind: { ...NONE, pages: documents },
  sharedStyles: [],
  blockDefaults,
  complete,
});

/** Counts: brand on a page, the rest on none, button only by a core block. */
function access(complete = true): VariablesAccess {
  const reaches: Record<string, VariableReach> = {
    "color.brand": reach(2, complete),
    // Named by the Lift shadow, as the host's count says.
    "color.accent": { ...reach(0, complete), variables: ["shadow.lift"] },
    "color.spare": reach(0, complete),
    "color.button": reach(0, complete, ["core/button"]),
    "shadow.lift": reach(0, complete),
  };
  return {
    usage: async ids => {
      const variables = new Map(
        ids.flatMap(id =>
          reaches[id] === undefined ? [] : [[id, reaches[id]] as const]
        )
      );
      return {
        whole: complete,
        counting: !complete,
        mayCount: false,
        variables,
      };
    },
    uses: async () => ({
      items: [],
      total: 0,
      hidden: 0,
      hasNext: false,
      complete: true,
    }),
  };
}

function Panel({
  usage,
  usedOnPage,
  site = SITE,
}: {
  usage: VariablesAccess;
  usedOnPage?: ReadonlySet<string>;
  /** The site's variables as a host hands them, changed by a later render. */
  site?: SiteTokenSet;
}): React.JSX.Element {
  const [tokens, setTokens] = React.useState(site);
  React.useEffect(() => setTokens(site), [site]);
  return (
    <TokensPanel
      tokens={tokens}
      currentTokens={() => tokens}
      onChange={setTokens}
      groups={["colours"]}
      usage={usage}
      {...(usedOnPage === undefined ? {} : { usedOnPage })}
    />
  );
}

/** The colour rows listed, by the name shown. */
function listed(): string[] {
  return [
    ...document.querySelectorAll(
      '[data-group="colours"] .nx-vars__row .nx-vars__name'
    ),
  ].map(name => name.textContent ?? "");
}

const filter = () => screen.getByRole("radiogroup", { name: "Show colours" });
const option = (name: string) => within(filter()).getByRole("radio", { name });

describe("the Colours tab's usage filter", () => {
  it('offers "All", "Unused" and "Used on this page", "All" chosen', () => {
    render(<Panel usage={access()} />);
    expect(
      within(filter())
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["All", "Unused", "Used on this page"]);
    expect(option("All").getAttribute("aria-checked")).toBe("true");
    expect(listed()).toEqual(["Brand", "Accent", "Spare", "Button"]);
  });

  it("lists under Unused what nothing the site stores uses, a core block's look not counting", async () => {
    render(<Panel usage={access()} />);
    fireEvent.click(option("Unused"));
    // Accent is named by the Lift shadow; Button only by a core block.
    await waitFor(() => expect(listed()).toEqual(["Spare", "Button"]));
    expect(screen.queryByText("Counting usage…")).toBeNull();
  });

  it("claims nothing unused while the count is not whole, and says so", async () => {
    render(<Panel usage={access(false)} />);
    fireEvent.click(option("Unused"));
    expect(await screen.findByText("Counting usage…")).toBeDefined();
    expect(listed()).toEqual([]);
  });

  it("lists under Used on this page what the open page uses, following it as it changes", () => {
    const view = render(
      <Panel usage={access()} usedOnPage={new Set(["color.spare"])} />
    );
    fireEvent.click(option("Used on this page"));
    expect(listed()).toEqual(["Spare"]);
    view.rerender(
      <Panel
        usage={access()}
        usedOnPage={new Set(["color.spare", "color.brand"])}
      />
    );
    expect(listed()).toEqual(["Brand", "Spare"]);
  });

  it("keeps a colour just added listed while its editor is open, whatever the filter", async () => {
    render(<Panel usage={access()} />);
    fireEvent.click(option("Unused"));
    await waitFor(() => expect(listed()).toEqual(["Spare", "Button"]));
    fireEvent.click(screen.getByRole("button", { name: "Add colour" }));
    expect(
      await screen.findByRole("dialog", { name: "Edit New colour" })
    ).toBeDefined();
    expect(listed()).toContain("New colour");
  });

  it("reads the counts again once a colour changes, while Unused is chosen", async () => {
    const counted = access();
    let reads = 0;
    const usage: VariablesAccess = {
      ...counted,
      usage: async (ids, signal) => {
        reads += 1;
        return counted.usage(ids, signal);
      },
    };
    const view = render(<Panel usage={usage} />);
    fireEvent.click(option("Unused"));
    await waitFor(() => expect(listed()).toEqual(["Spare", "Button"]));
    const before = reads;
    // Spare now names Button through var(): the site has changed under it.
    view.rerender(
      <Panel
        usage={usage}
        site={{
          ...SITE,
          tokens: SITE.tokens.map(token =>
            token.name === "color.spare"
              ? { ...token, values: { light: "var(--site-color-button)" } }
              : token
          ),
        }}
      />
    );
    await waitFor(() => expect(reads).toBeGreaterThan(before), {
      timeout: 3000,
    });
  });

  it("moves between the choices with the arrow keys", () => {
    render(<Panel usage={access()} />);
    option("All").focus();
    fireEvent.keyDown(option("All"), { key: "ArrowRight" });
    expect(option("Unused").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(option("Unused"));
  });
});
