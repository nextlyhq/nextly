// @vitest-environment jsdom
/**
 * The admin draws one top bar, and the page on screen fills its two places:
 * its breadcrumb at the left (`start`) and its own actions at the right
 * (`end`). A page renders them inside its own tree, so they keep its state,
 * and they are drawn in the bar. Outside the shell there is no bar, and a
 * place draws what it was given where it stands.
 *
 * The shared Breadcrumbs component is the common case: inside the shell it is
 * drawn as the bar's trail, which below 600px of bar keeps only the way back.
 * A folder path inside a page's content stays where it is.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Breadcrumbs } from "@admin/components/shared/breadcrumbs";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
}));

import { DashboardHeader } from "./DashboardHeader";
import { HeaderTrailProvider } from "./HeaderTrail";
import { barFolds } from "./bar-fold";
import {
  TopBarPlace,
  TopBarPlacesProvider,
  useTopBarWidth,
} from "./TopBarPlaces";

function Shell({
  children,
  onOpenMenu,
}: {
  children: React.ReactNode;
  onOpenMenu?: () => void;
}) {
  return (
    <HeaderTrailProvider>
      <TopBarPlacesProvider>
        <DashboardHeader onOpenMenu={onOpenMenu} />
        <main>{children}</main>
      </TopBarPlacesProvider>
    </HeaderTrailProvider>
  );
}

/** A page whose bar action reads and writes the page's own state. */
function CountingPage() {
  const [count, setCount] = useState(0);
  return (
    <>
      <p>Saved {count} times</p>
      <TopBarPlace name="end">
        <button type="button" onClick={() => setCount(count + 1)}>
          Save
        </button>
      </TopBarPlace>
    </>
  );
}

const bar = () => screen.getByRole("banner");
const main = () => screen.getByRole("main");

afterEach(cleanup);

describe("the top bar's places", () => {
  it("draws a page's actions at the bar's right end, wired to the page", () => {
    render(
      <Shell>
        <CountingPage />
      </Shell>
    );
    const save = within(bar()).getByRole("button", { name: "Save" });
    expect(bar().querySelector('[data-top-bar-place="end"]')).toContainElement(
      save
    );
    expect(within(main()).queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.click(save);
    expect(within(main()).getByText("Saved 1 times")).toBeTruthy();
  });

  it("draws a place's content where it stands outside the shell", () => {
    render(<CountingPage />);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("draws nothing of a page that has gone", () => {
    const { rerender } = render(
      <Shell>
        <CountingPage />
      </Shell>
    );
    rerender(
      <Shell>
        <p>another page</p>
      </Shell>
    );
    expect(within(bar()).queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("the bar's own controls", () => {
  it("is as tall as the admin's bar height, which other parts read too", () => {
    render(<Shell>page</Shell>);
    expect(bar().className).toContain("h-(--admin-bar-height)");
  });

  it("opens the navigation drawer from its menu button, below the rail's width", () => {
    const onOpenMenu = vi.fn();
    render(<Shell onOpenMenu={onOpenMenu}>page</Shell>);
    const menu = within(bar()).getByRole("button", {
      name: "Open the navigation menu",
    });
    expect(menu.className).toContain("lg:hidden");
    fireEvent.click(menu);
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});

describe("a page's breadcrumb", () => {
  const ITEMS = [
    { label: "Dashboard", href: "/admin" },
    { label: "Settings", href: "/admin/settings" },
    { label: "Webhooks" },
  ];

  it("is drawn as the bar's trail, and nothing of it in the page", () => {
    render(
      <Shell>
        <Breadcrumbs items={ITEMS} />
      </Shell>
    );
    const trail = within(bar()).getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(trail)
        .getAllByRole("link")
        .map(link => link.textContent)
    ).toEqual(["Dashboard", "Settings"]);
    expect(within(trail).getByText("Webhooks")).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(main()).queryByRole("navigation")).toBeNull();
  });

  it("keeps only the way back to the parent page on a narrow bar", () => {
    render(
      <Shell>
        <Breadcrumbs items={ITEMS} />
      </Shell>
    );
    const trail = within(bar()).getByRole("navigation", { name: "Breadcrumb" });
    const [outer, parent] = within(trail).getAllByRole("listitem");
    // jsdom evaluates no CSS: what a narrow bar hides is read from the
    // container-query class that hides it.
    expect(outer?.className).toContain("@max-[37.5rem]/topbar:hidden");
    expect(parent?.className).not.toContain("@max-[37.5rem]/topbar:hidden");
    expect(
      within(trail).getByText("Webhooks").closest("li")?.className
    ).toContain("@max-[37.5rem]/topbar:hidden");
  });

  it("keeps a page with no parent named at every width", () => {
    render(
      <Shell>
        <Breadcrumbs items={[{ label: "Dashboard" }]} />
      </Shell>
    );
    const here = within(bar()).getByText("Dashboard");
    expect(here.closest("li")?.className).not.toContain(
      "@max-[37.5rem]/topbar:hidden"
    );
  });

  it("goes back through a step that navigates by handler", () => {
    const back = vi.fn();
    render(
      <Shell>
        <Breadcrumbs
          items={[{ label: "Media", onClick: back }, { label: "Holiday" }]}
        />
      </Shell>
    );
    fireEvent.click(within(bar()).getByRole("button", { name: "Media" }));
    expect(back).toHaveBeenCalledOnce();
  });

  it("stays in the page where it is a path inside the content", () => {
    render(
      <Shell>
        <Breadcrumbs placement="inline" items={ITEMS} />
      </Shell>
    );
    expect(within(main()).getByRole("navigation")).toBeTruthy();
    expect(within(bar()).queryByRole("navigation")).toBeNull();
  });
});

describe("the bar's width, as a page reads it", () => {
  it("is known in the first frame drawn, before the browser paints", async () => {
    // The bar is 400 px wide. React applies what a layout effect sets in the
    // same task as the commit, before the browser paints; what a passive
    // effect sets lands in a later task. The first DOM the page shows, as a
    // mutation observer sees it at the end of that task, must already say
    // the width.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 400, height: 52 })
      );
    const acting = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasActing = acting.IS_REACT_ACT_ENVIRONMENT;
    acting.IS_REACT_ACT_ENVIRONMENT = false;
    function Reader() {
      const width = useTopBarWidth();
      return <span data-testid="bar-width">{width ?? "none"}</span>;
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      const firstDrawn = new Promise<string>(resolve => {
        const observer = new MutationObserver(() => {
          const shown = container.querySelector('[data-testid="bar-width"]');
          if (shown === null) return;
          observer.disconnect();
          resolve(shown.textContent ?? "");
        });
        observer.observe(container, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      root.render(
        <Shell>
          <Reader />
        </Shell>
      );
      expect(await firstDrawn).toBe("400");
    } finally {
      root.unmount();
      container.remove();
      acting.IS_REACT_ACT_ENVIRONMENT = wasActing;
      rect.mockRestore();
    }
  });
});

describe("the bar's width, measured as its container query measures it", () => {
  it("takes the first measurement inside the bar's padding, so a 720 px bar with 24 px padding folds from the start", () => {
    // The bar's box is 720 px with 24 px of padding either side: its content,
    // which the observer and the outline's container query both read, is
    // 672 px, below the fold. An observer that never answers leaves the
    // first measurement standing alone.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 720, height: 52 })
      );
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation(
      element =>
        ({
          paddingLeft: element.tagName === "HEADER" ? "24px" : "0px",
          paddingRight: element.tagName === "HEADER" ? "24px" : "0px",
          borderLeftWidth: "0px",
          borderRightWidth: "0px",
        }) as CSSStyleDeclaration
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    function Reader() {
      const width = useTopBarWidth();
      return (
        <span data-testid="bar-width">
          {width === null
            ? "none"
            : `${width} ${barFolds(width) ? "folded" : "open"}`}
        </span>
      );
    }
    try {
      render(
        <Shell>
          <Reader />
        </Shell>
      );
      expect(screen.getByTestId("bar-width").textContent).toBe("672 folded");
    } finally {
      vi.unstubAllGlobals();
      style.mockRestore();
      rect.mockRestore();
    }
  });
});
