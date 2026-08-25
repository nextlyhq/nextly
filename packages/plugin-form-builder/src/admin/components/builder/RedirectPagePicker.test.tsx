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

/**
 * A server whose `pages` collection is titled by `headline`.
 *
 * Deliberately NOT one of the conventional names the picker falls back to: a
 * fixture titled by `title` returns the same green whether the configured
 * field was honoured or ignored.
 */
function serve(rows: Record<string, unknown>[], useAsTitle?: string) {
  requested = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      if (url.includes("/entries")) {
        return {
          ok: true,
          json: async () => ({ items: rows, meta: { totalPages: 1 } }),
        };
      }
      return {
        ok: true,
        json: async () => (useAsTitle ? { admin: { useAsTitle } } : {}),
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
