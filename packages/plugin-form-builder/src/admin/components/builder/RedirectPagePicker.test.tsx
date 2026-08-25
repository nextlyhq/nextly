// @vitest-environment jsdom

/**
 * The path from a collection's own metadata to what an author sees.
 *
 * The unit tests beside this file assert `labelFieldsFor` and `selectParam` in
 * isolation, and every one of them stays green if the metadata request reads
 * the wrong endpoint, or misreads the response, or stops feeding its answer
 * into the listing. In each of those cases the shipped picker still shows
 * opaque ids — the exact defect the unit tests were written for. What separates
 * a working picker from that one is whether the CONFIGURED field reaches the
 * request and the label, so these observe the request the component actually
 * makes and the text it actually renders.
 *
 * jsdom is requested per file rather than in the shared vitest config: the
 * integration suites in this package boot a real Nextly instance and have no
 * use for a DOM.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { RedirectPagePicker } from "./RedirectPagePicker";

// Radix calls all four when a Select opens and jsdom implements none, so
// without them a test dies on a missing method rather than failing an
// assertion.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

/** Every URL the component requested, in order. */
let requested: string[] = [];
/** The document a by-id read should answer with, for the recovery path. */
let recoverable: Record<string, unknown> | undefined;

/**
 * A server whose `pages` collection is titled by `headline`.
 *
 * Deliberately NOT one of the conventional names the picker falls back to: a
 * fixture titled by `title` returns the same green whether the configured
 * field was honoured or ignored.
 */
function serve(
  rows: Record<string, unknown>[],
  useAsTitle?: string,
  localized?: boolean
) {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      // A by-id read answers with the document ITSELF; the listing answers
      // with `{ items }`. Matching both on "/entries" would hand the recovery
      // path a list it cannot read, and it would report the selection
      // unreadable rather than exercising the marker.
      const byId = /\/entries\/([^?]+)/.exec(url);
      if (byId) {
        const found = rows.find(r => r.id === byId[1]) ?? recoverable;
        return { ok: Boolean(found), json: async () => found };
      }
      if (url.includes("/entries")) {
        return {
          ok: true,
          json: async () => ({ items: rows, meta: { totalPages: 1 } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          ...(useAsTitle ? { admin: { useAsTitle } } : {}),
          ...(localized === undefined ? {} : { localized }),
        }),
      };
    })
  );
}

const entriesRequest = () => requested.find(url => url.includes("/entries"));

/** The projection the server would actually apply, from the URL as sent. */
function projection(url: string): Record<string, boolean> {
  const select = new URL(url, "https://test.local").searchParams.get("select");
  return JSON.parse(select ?? "{}") as Record<string, boolean>;
}

beforeEach(() => {
  requested = [];
  recoverable = undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the configured title field reaches the request and the label", () => {
  it("asks the metadata endpoint for the collection", async () => {
    serve([], "headline");
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await waitFor(() => expect(entriesRequest()).toBeDefined());
    expect(requested[0]).toContain("/admin/api/collections/pages");
    expect(requested[0]).not.toContain("/entries");
  });

  it("projects the field the collection configures", async () => {
    serve([{ id: "p1", headline: "Launch day" }], "headline");
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await waitFor(() => expect(entriesRequest()).toBeDefined());
    // The property that separates a working picker from one showing ids: the
    // request asks for `headline`, in the encoding the dispatcher accepts.
    expect(projection(entriesRequest()!)).toMatchObject({
      id: true,
      headline: true,
      status: true,
    });
  });

  it("labels a document by its configured field, not by its id", async () => {
    serve([{ id: "p1", headline: "Launch day" }], "headline");
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    expect(await screen.findByText("Launch day")).toBeInTheDocument();
    expect(screen.queryByText("p1")).not.toBeInTheDocument();
  });

  it("falls back to the conventional names when the collection configures none", async () => {
    serve([{ id: "p1", title: "About" }], undefined);
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    expect(await screen.findByText("About")).toBeInTheDocument();
  });
});

describe("what the picker says about a page that is not live", () => {
  it("marks an unpublished page as a draft", async () => {
    // Unpublished pages are offered on purpose. The marker is what stops
    // "offered" reading as "live" — and a published form saved against one is
    // refused, so an author who cannot see this has no way to predict that.
    serve(
      [
        {
          id: "p1",
          headline: "Launch day",
          status: "draft",
          firstPublishedAt: null,
        },
      ],
      "headline"
    );
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    const option = await screen.findByRole("option", { name: /Launch day/ });
    expect(option).toHaveTextContent("Draft");
  });

  it("does not mark a published page", async () => {
    serve(
      [{ id: "p1", headline: "Launch day", status: "published" }],
      "headline"
    );
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    const option = await screen.findByRole("option", { name: /Launch day/ });
    expect(option).not.toHaveTextContent("Draft");
  });

  it("does not mark a page whose collection merely has a status field", async () => {
    // `status: "draft"` on a collection with no publish lifecycle is an
    // ordinary field value, not a publish state. Marking it would put "Draft"
    // beside a page that is live, and the save rule would then refuse it.
    serve([{ id: "p1", headline: "Launch day", status: "draft" }], "headline");
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    const option = await screen.findByRole("option", { name: /Launch day/ });
    expect(option).not.toHaveTextContent("Draft");
  });

  it("does not mark a collection that has no publish lifecycle", async () => {
    // No `status` field at all. Marking these would put "Draft" beside every
    // page on every site that never turned drafts on.
    serve([{ id: "p1", headline: "Launch day" }], "headline");
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    const option = await screen.findByRole("option", { name: /Launch day/ });
    expect(option).not.toHaveTextContent("Draft");
  });
});

describe("a target collection that publishes per locale", () => {
  // A page published before and showing `status: "draft"` now. On a plain
  // collection that means unpublished; on a localized one a translation may be
  // public, and the main row says nothing about it.
  const previouslyPublished = {
    id: "p1",
    headline: "Launch day",
    status: "draft",
    firstPublishedAt: "2026-08-25T00:00:00.000Z",
  };

  it("does not mark it a draft when the collection is localized", async () => {
    // Marking it would tell an author a page visitors can reach in Spanish is
    // not live, and the save rule would refuse a form pointing at it.
    serve([previouslyPublished], "headline", true);
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    const option = await screen.findByRole("option", { name: /Launch day/ });
    expect(option).not.toHaveTextContent("Draft");
  });

  it("marks it a draft when the collection is not localized", async () => {
    // The separating case. Without this, the test above passes just as well
    // against a picker that stopped marking drafts entirely.
    serve([previouslyPublished], "headline", false);
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={undefined}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    const option = await screen.findByRole("option", { name: /Launch day/ });
    expect(option).toHaveTextContent("Draft");
  });

  it("marks a never-published page whatever the collection says", async () => {
    // No `firstPublishedAt`: never public in any language, so localization
    // cannot rescue it and both settings must mark it.
    for (const localized of [true, false]) {
      serve(
        [
          {
            id: "p1",
            headline: "Launch day",
            status: "draft",
            firstPublishedAt: null,
          },
        ],
        "headline",
        localized
      );
      const view = render(
        <RedirectPagePicker
          collections={["pages"]}
          value={undefined}
          onChange={vi.fn()}
        />
      );
      await userEvent.click(await screen.findByLabelText("Redirect page"));
      expect(
        await screen.findByRole("option", { name: /Launch day/ })
      ).toHaveTextContent("Draft");
      view.unmount();
    }
  });
});

describe("a stored selection the listing never reached", () => {
  // `useSelectedChoice` fetches it by id and adds it to the list. It must
  // decide the marker the same way the listing does — a document shown under
  // one rule when the listing reaches it and another when it does not is the
  // same page telling an author two different things.
  const storedValue = { relationTo: "pages", value: "p9" };

  it("marks a recovered never-published page as a draft", async () => {
    serve([], "headline", false);
    recoverable = {
      id: "p9",
      headline: "Launch day",
      status: "draft",
      firstPublishedAt: null,
    };
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={storedValue}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    expect(
      await screen.findByRole("option", { name: /Launch day/ })
    ).toHaveTextContent("Draft");
  });

  it("marks a recovered page that its plain collection unpublished", async () => {
    // The case that separates the flag being PASSED from it being dropped:
    // `localized: false` and `undefined` disagree only here. Reading the flag
    // as undefined answers "unknown" and the marker silently disappears, which
    // both other recovery tests would still pass through.
    serve([], "headline", false);
    recoverable = {
      id: "p9",
      headline: "Launch day",
      status: "draft",
      firstPublishedAt: "2026-08-25T00:00:00.000Z",
    };
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={storedValue}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    expect(
      await screen.findByRole("option", { name: /Launch day/ })
    ).toHaveTextContent("Draft");
  });

  it("does not mark a recovered page on a localized collection", async () => {
    // The separating case: identical document, localized collection, so the
    // main row's draft status does not answer for it.
    serve([], "headline", true);
    recoverable = {
      id: "p9",
      headline: "Launch day",
      status: "draft",
      firstPublishedAt: "2026-08-25T00:00:00.000Z",
    };
    render(
      <RedirectPagePicker
        collections={["pages"]}
        value={storedValue}
        onChange={vi.fn()}
      />
    );

    await userEvent.click(await screen.findByLabelText("Redirect page"));
    expect(
      await screen.findByRole("option", { name: /Launch day/ })
    ).not.toHaveTextContent("Draft");
  });
});
