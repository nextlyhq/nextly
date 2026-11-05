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
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  PublishDependenciesResult,
  PublishReadinessResponse,
} from "../publish-readiness-contract";

/**
 * Every mounted handler, in mount order, as the runner holds them; each is
 * given where to leave its check before the write.
 */
const befores = new Set<
  (action: string, checks: (() => boolean)[]) => Promise<void> | void
>();
const routes = vi.fn();
const warnings = vi.fn();
/** What the store's tracked writes come to, as the runner reports it. */
let writesLand = true;

vi.mock("@nextlyhq/plugin-sdk/admin", async () => {
  const React = await import("react");
  return {
    useBeforeDocumentAction: (
      handler: (
        action: string,
        store: {
          writesSettled(): Promise<boolean>;
          checkBeforeWrite(check: () => boolean): void;
        }
      ) => Promise<void> | void
    ) => {
      const latest = React.useRef(handler);
      React.useEffect(() => {
        latest.current = handler;
      });
      React.useEffect(() => {
        const run = (action: string, checks: (() => boolean)[]) =>
          latest.current(action, {
            writesSettled: async () => writesLand,
            checkBeforeWrite: check => {
              checks.push(check);
            },
          });
        befores.add(run);
        return () => {
          befores.delete(run);
        };
      }, []);
    },
    writePluginRoute: (args: { path: string; body: unknown }) =>
      routes(args.path, args.body),
  };
});

vi.mock("@nextlyhq/ui", async importOriginal => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    toast: { ...(real.toast as object), warning: warnings },
  };
});

const { usePublishOffer, useFormPublishOffer } = await import(
  "./publish-offer"
);

afterEach(() => {
  cleanup();
  befores.clear();
  writesLand = true;
  routes.mockReset();
  warnings.mockReset();
});

const DOCUMENT = { formatVersion: 1, kind: "page", nodes: [] };

function Harness({
  layout = null,
  siteDefault,
}: {
  layout?: string | null;
  siteDefault?: boolean;
}): JSX.Element {
  return usePublishOffer({
    documents: () => [DOCUMENT],
    layout,
    ...(siteDefault === undefined ? {} : { siteDefault }),
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

/**
 * Start a publish as the runner would; the promise is what it awaits. Like
 * the runner, it makes each handler's check before the write, and runs the
 * handlers again while one fails, a few times.
 */
async function publish(action = "publish"): Promise<void> {
  if (befores.size === 0) throw new Error("no before-action handler");
  for (let pass = 0; pass < 3; pass++) {
    const checks: (() => boolean)[] = [];
    for (const run of [...befores]) await run(action, checks);
    if (checks.every(check => check())) return;
  }
  throw new Error("the work kept changing before the write");
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
    // The draft is as it was asked about, so it is asked about once.
    expect(routes).toHaveBeenCalledTimes(1);
  });

  it("asks about the site's default Layout for a page that names none", async () => {
    server({ dependencies: [], missing: 0 });
    render(<Harness siteDefault />);
    await publish();
    expect(routes).toHaveBeenCalledWith("/publish-readiness", {
      documents: [DOCUMENT],
      layout: null,
      siteDefault: true,
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

  it("publishes more parts than one request carries, in batches, in order", async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      kind: "component" as const,
      id: `c${String(i)}`,
      title: `Part ${String(i)}`,
      mayPublish: true,
    }));
    server({ dependencies: many, missing: 0 });
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Publish all 52" }));
    await running;
    const batches = routes.mock.calls
      .filter(([path]) => path === "/publish-dependencies")
      .map(
        ([, body]) => (body as { dependencies: { id: string }[] }).dependencies
      );
    expect(batches.map(batch => batch.length)).toEqual([50, 1]);
    expect(batches.flat().map(entry => entry.id)).toEqual(
      many.map(entry => entry.id)
    );
  });

  it("asks once for a form with two blocks fields, about both", async () => {
    server({ dependencies: [card], missing: 0 });
    const form = {};
    const second = { formatVersion: 1, kind: "page", nodes: [{ id: "x" }] };
    function Field({ name, value }: { name: string; value: unknown }) {
      return useFormPublishOffer({
        form,
        name,
        value: () => value,
        layout: null,
        subject: "page",
      });
    }
    render(
      <>
        <Field name="content" value={DOCUMENT} />
        <Field name="sidebar" value={second} />
      </>
    );
    const running = publish();
    await screen.findByRole("alertdialog");
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Publish page only" }));
    await running;
    const asked = routes.mock.calls.filter(
      ([path]) => path === "/publish-readiness"
    );
    expect(asked).toEqual([
      ["/publish-readiness", { documents: [DOCUMENT, second], layout: null }],
    ]);
  });

  it("renders a form's field on the server, where no field has registered", () => {
    // The admin's entry screen is server-rendered before it hydrates, and a
    // store subscription without a server answer throws there.
    function Field() {
      return useFormPublishOffer({
        form: {},
        name: "content",
        value: () => DOCUMENT,
        layout: null,
        subject: "page",
      });
    }
    expect(() => renderToString(<Field />)).not.toThrow();
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

  it("publishes no part for a store a failed tracked write will refuse", async () => {
    // The runner refuses the store after the handlers when a tracked write
    // failed; a part published before that would go live without its page.
    writesLand = false;
    server({ dependencies: [card], missing: 0 });
    render(<Harness />);
    const running = publish();
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Publish both" }));
    await running;
    expect(
      routes.mock.calls.some(([path]) => path === "/publish-dependencies")
    ).toBe(false);
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

describe("an edit made while the question is asked", () => {
  /** A draft the test edits, read as a blocks field reads its form. */
  let draft: unknown = DOCUMENT;
  const edited = { ...DOCUMENT, nodes: [{ id: "n1", type: "core/heading" }] };

  function Editing(): JSX.Element {
    return usePublishOffer({
      documents: () => [draft],
      layout: null,
      subject: "page",
    });
  }

  afterEach(() => {
    draft = DOCUMENT;
  });

  it("asks again about the draft as edited, before the publish goes ahead", async () => {
    // The first answer is about the draft before the edit: everything it
    // placed is live. The edit places an unpublished component.
    routes.mockImplementation(async (path: string, body: unknown) => {
      if (path !== "/publish-readiness") throw new Error("not chosen");
      const [asked] = (body as { documents: unknown[] }).documents;
      if (asked === DOCUMENT) {
        draft = edited;
        return { dependencies: [], missing: 0 };
      }
      return { dependencies: [card], missing: 0 };
    });
    render(<Editing />);
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Pricing card");
    expect(routes).toHaveBeenLastCalledWith("/publish-readiness", {
      documents: [edited],
      layout: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish page only" }));
    await expect(running).resolves.toBeUndefined();
    expect(routes).toHaveBeenCalledTimes(2);
  });

  it("publishes no part for a draft that changed while it was asked about", async () => {
    // Each question is answered about a draft edited since it was put: the
    // parts chosen are never published, so the refusal leaves nothing live
    // without its page.
    let asks = 0;
    routes.mockImplementation(async (path: string) => {
      if (path !== "/publish-readiness") throw new Error("not to publish");
      asks += 1;
      return { dependencies: [card], missing: 0 };
    });
    render(<Editing />);
    const running = publish();
    for (let round = 1; round <= 3; round++) {
      await waitFor(() => expect(asks).toBe(round));
      const offer = await screen.findByRole("button", { name: "Publish both" });
      draft = { ...DOCUMENT, nodes: [{ id: `n${String(round)}` }] };
      fireEvent.click(offer);
    }
    await expect(running).rejects.toThrow("kept changing");
    expect(
      routes.mock.calls.some(([path]) => path === "/publish-dependencies")
    ).toBe(false);
  });

  it("puts no answer about a draft since edited to the author", async () => {
    // The first answer names a part the edit took away: asked again, the
    // draft needs nothing, and the publish goes ahead unasked.
    routes.mockImplementation(async () => {
      if (draft === DOCUMENT) {
        draft = edited;
        return { dependencies: [card], missing: 0 };
      }
      return { dependencies: [], missing: 0 };
    });
    render(<Editing />);
    await expect(publish()).resolves.toBeUndefined();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(routes).toHaveBeenCalledTimes(2);
  });

  it("asks again about an edit made after it asked, before the store writes", async () => {
    // A handler after this one gives the author time to edit (a write the
    // store then waits for): the check before the write finds the change,
    // and the question is put about the draft as stored.
    routes.mockImplementation(async (_path: string, body: unknown) => {
      const [asked] = (body as { documents: unknown[] }).documents;
      return asked === DOCUMENT
        ? { dependencies: [], missing: 0 }
        : { dependencies: [card], missing: 0 };
    });
    render(<Editing />);
    befores.add(() => {
      draft = edited;
    });
    const running = publish();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Pricing card");
    fireEvent.click(screen.getByRole("button", { name: "Publish page only" }));
    await expect(running).resolves.toBeUndefined();
    expect(routes).toHaveBeenLastCalledWith("/publish-readiness", {
      documents: [edited],
      layout: null,
    });
  });

  it("refuses a publish whose draft keeps changing while it is asked about", async () => {
    let edits = 0;
    routes.mockImplementation(async () => {
      edits += 1;
      draft = { ...DOCUMENT, nodes: [{ id: `n${String(edits)}` }] };
      return { dependencies: [], missing: 0 };
    });
    render(<Editing />);
    await expect(publish()).rejects.toThrow(
      "This page kept changing while it was checked, so it wasn't published."
    );
    // Bounded: it stops asking rather than chase the author's typing.
    expect(edits).toBe(3);
  });
});
