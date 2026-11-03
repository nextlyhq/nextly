// @vitest-environment jsdom
/**
 * The question asked before a publish that would leave a page's parts
 * unpublished.
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

import type {
  PublishDependenciesResult,
  PublishReadinessResponse,
} from "../publish-readiness-contract";

let before: ((action: string) => Promise<void> | void) | null = null;
const routes = vi.fn();
const warnings = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useBeforeDocumentAction: (handler: (action: string) => Promise<void>) => {
    before = handler;
  },
  writePluginRoute: (args: { path: string; body: unknown }) =>
    routes(args.path, args.body),
}));

vi.mock("@nextlyhq/ui", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    toast: { ...(real.toast as object), warning: warnings },
  };
});

const { usePublishOffer } = await import("./publish-offer");

afterEach(() => {
  cleanup();
  before = null;
  routes.mockReset();
  warnings.mockReset();
});

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

function Harness({ layout = null }: { layout?: string | null }): JSX.Element {
  return usePublishOffer({
    documents: () => [DOCUMENT],
    layout,
    subject: "page",
  });
}

/** Readiness answers `readiness`; publishing answers `published`. */
function server(
  readiness: PublishReadinessResponse,
  published: PublishDependenciesResult = { published: [], refused: [] }
) {
  routes.mockImplementation(async (path: string) =>
    path === "/publish-readiness" ? readiness : { item: published }
  );
}

/** Start a publish as the runner would; the promise is what it awaits. */
function publish(action = "publish"): Promise<void> {
  if (before === null) throw new Error("no before-action handler");
  return Promise.resolve(before(action));
}

const card = {
  kind: "component" as const,
  id: "c1",
  title: "Pricing card",
  mayPublish: true,
};
const header = {
  kind: "component" as const,
  id: "c2",
  title: "Site header",
  mayPublish: false,
};

describe("before a publish", () => {
  it("asks nothing when everything the page needs is live", async () => {
    server({ dependencies: [], missing: 0 });
    render(<Harness />);
    await publish();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(routes).toHaveBeenCalledWith("/publish-readiness", {
      documents: [DOCUMENT],
      layout: null,
    });
  });

  it("asks only before a publish, not a save", async () => {
    server({ dependencies: [card], missing: 0 });
    render(<Harness />);
    await publish("save");
    expect(routes).not.toHaveBeenCalled();
  });

  it("publishes as before when the check cannot be made", async () => {
    routes.mockRejectedValue(new Error("offline"));
    render(<Harness />);
    await expect(publish()).resolves.toBeUndefined();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("names what is not published and leads with publishing the page only", async () => {
    server({ dependencies: [card], missing: 0 });
    render(<Harness />);
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "This page uses 1 component that isn't published"
    );
    expect(dialog.textContent).toContain("Pricing card");
    fireEvent.click(screen.getByRole("button", { name: "Publish page only" }));
    await expect(running).resolves.toBeUndefined();
    // Only the question was asked: nothing else was published.
    expect(routes).toHaveBeenCalledTimes(1);
  });

  it("cancels the publish when the author says no", async () => {
    server({ dependencies: [card], missing: 0 });
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });

  it("publishes the chosen components first, then lets the page publish", async () => {
    server(
      { dependencies: [card], missing: 0 },
      { published: [{ kind: "component", id: "c1" }], refused: [] }
    );
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    await expect(running).resolves.toBeUndefined();
    expect(routes).toHaveBeenLastCalledWith("/publish-dependencies", {
      dependencies: [{ kind: "component", id: "c1" }],
    });
    expect(warnings).not.toHaveBeenCalled();
  });

  it("offers only what the author may publish, and says why for the rest", async () => {
    server({ dependencies: [card, header], missing: 0 });
    render(<Harness />);
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("You can't publish components");
    // Two need publishing, one may be: the offer publishes that one and the
    // page, so it reads "both".
    fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    await running;
    expect(routes).toHaveBeenLastCalledWith("/publish-dependencies", {
      dependencies: [{ kind: "component", id: "c1" }],
    });
  });

  it("offers no publish at all when the author may publish none of them", async () => {
    server({ dependencies: [header], missing: 0 });
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    expect(
      screen.queryByRole("button", { name: /Publish both|Publish all/ })
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Publish page only" }));
    await running;
  });

  it("lists parts in page order, and publishes the deepest first", async () => {
    // The server answers deepest first: the badge the card places, then the
    // card, then the Layout.
    const badge = { ...card, id: "c0", title: "Badge in the card" };
    const layout = {
      kind: "layout" as const,
      id: "l1",
      title: "Landing",
      mayPublish: true,
    };
    server({ dependencies: [badge, card, layout], missing: 0 });
    render(<Harness layout="l1" />);
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    const listed = [...dialog.querySelectorAll("li")].map(
      item => item.textContent
    );
    expect(listed).toEqual([
      "Pricing card, component",
      "Badge in the card, component",
      "Landing, Layout",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Publish all 4" }));
    await running;
    expect(routes).toHaveBeenLastCalledWith("/publish-dependencies", {
      dependencies: [
        { kind: "component", id: "c0" },
        { kind: "component", id: "c1" },
        { kind: "layout", id: "l1" },
      ],
    });
  });

  it("leaves out a component the author unticks", async () => {
    const second = { ...card, id: "c3", title: "Footer" };
    server({ dependencies: [card, second], missing: 0 });
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    expect(screen.getByRole("button", { name: "Publish all 3" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Footer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    await running;
    expect(routes).toHaveBeenLastCalledWith("/publish-dependencies", {
      dependencies: [{ kind: "component", id: "c1" }],
    });
  });

  it("says which the server would not publish, and why, and publishes the page", async () => {
    server(
      { dependencies: [card], missing: 0 },
      {
        published: [],
        refused: [
          {
            kind: "component",
            id: "c1",
            reason: "You don't have permission to publish it.",
          },
        ],
      }
    );
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    await expect(running).resolves.toBeUndefined();
    expect(warnings).toHaveBeenCalledWith(
      "1 wasn't published with this page",
      expect.objectContaining({
        description: "Pricing card: You don't have permission to publish it.",
      })
    );
  });

  it("refuses the publish when the components could not be published at all", async () => {
    routes.mockImplementation(async (path: string) => {
      if (path === "/publish-readiness") {
        return { dependencies: [card], missing: 0 };
      }
      throw new Error("The server is unavailable.");
    });
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    await expect(running).rejects.toThrow(/Nothing was published/);
  });

  it("names the Layout, and what visitors see until it is published", async () => {
    server({
      dependencies: [
        { kind: "layout", id: "l1", title: "Landing", mayPublish: true },
      ],
      missing: 0,
    });
    render(<Harness layout="l1" />);
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("This page's Layout isn't published");
    expect(dialog.textContent).toContain("site's default Layout");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    });
    await running;
    await waitFor(() =>
      expect(routes).toHaveBeenLastCalledWith("/publish-dependencies", {
        dependencies: [{ kind: "layout", id: "l1" }],
      })
    );
  });

  it("warns about a placed component that no longer exists", async () => {
    server({ dependencies: [], missing: 1 });
    render(<Harness />);
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "This page uses a component that no longer exists"
    );
    fireEvent.click(screen.getByRole("button", { name: "Publish page only" }));
    await running;
  });
});
