// @vitest-environment jsdom

/**
 * The submissions view against a server that pages the way the entries API
 * does: it reads the page size from `limit`, answers 10 rows when none is
 * given, and ignores any parameter it does not know.
 *
 * What separates a working view from a broken one is whether the page size it
 * asks for is the one it gets. A view that names the size under a parameter the
 * server does not read is handed the default page, and nothing fails: the forms
 * filter quietly ends at the tenth form and each page of the table quietly
 * shows ten of the submissions it counts. So these serve more than the default
 * page of both and assert what renders past it.
 *
 * jsdom is requested per file rather than in the shared vitest config: the
 * integration suites in this package boot a real Nextly instance and have no
 * use for a DOM.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubmissionsView } from "./SubmissionsView";

/** The page size the entries API answers with when a request names none. */
const SERVER_DEFAULT_LIMIT = 10;

const FORMS = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return {
    id: `form-${n}`,
    name: `Form ${n}`,
    fields: [{ name: "email", label: `Email for form ${n}`, type: "email" }],
  };
});

const SUBMISSIONS = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1;
  return {
    id: `submission-${n}`,
    form: "form-1",
    data: { email: `person-${n}@example.com` },
    status: "new",
    submittedAt: "2026-11-01T12:00:00.000Z",
  };
});

/** One page of `rows`, as the entries API pages a list. */
function entriesPage(rows: unknown[], url: URL): Response {
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam === null ? SERVER_DEFAULT_LIMIT : Number.parseInt(limitParam);
  const page = Number.parseInt(url.searchParams.get("page") ?? "1");
  const items = rows.slice((page - 1) * limit, page * limit);
  return Response.json({
    items,
    meta: { total: rows.length, page, limit },
  });
}

function serve(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      switch (url.pathname) {
        case "/admin/api/plugins/@nextlyhq/plugin-form-builder/builder-config":
          return Response.json({
            slugs: { forms: "forms", submissions: "form-submissions" },
          });
        case "/admin/api/me/permissions":
          return Response.json({ isSuperAdmin: true });
        case "/admin/api/collections/forms/entries":
          return entriesPage(FORMS, url);
        case "/admin/api/collections/form-submissions/entries":
          return entriesPage(SUBMISSIONS, url);
        default:
          return new Response(null, { status: 404 });
      }
    })
  );
}

beforeEach(() => {
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("SubmissionsView reads past the server's default page", () => {
  it("shows a deep-linked form's own columns", async () => {
    // The control for the case below: a form on the server's first page,
    // which any page size reaches. It passing while the next case fails is
    // what says the forms list was cut short, not that the columns never draw.
    window.history.replaceState(null, "", "/?form=form-3");
    render(<SubmissionsView collectionSlug="form-submissions" />);

    expect(
      await screen.findByRole("columnheader", { name: "Email for form 3" })
    ).toBeInTheDocument();
  });

  it("knows a form beyond the first ten, so its own columns show", async () => {
    // The deep link selects the twelfth form. Its per-field columns come from
    // the forms the view loaded, so a list that stopped at ten leaves it
    // unknown and the table falls back to the all-forms columns.
    window.history.replaceState(null, "", "/?form=form-12");
    render(<SubmissionsView collectionSlug="form-submissions" />);

    expect(
      await screen.findByRole("columnheader", { name: "Email for form 12" })
    ).toBeInTheDocument();
  });

  it("shows every submission of a page, not the server's default count", async () => {
    render(<SubmissionsView collectionSlug="form-submissions" />);

    // The rows have drawn once the first one has: any page size shows it.
    expect(
      (await screen.findAllByText(/person-1@example\.com/)).length
    ).toBeGreaterThan(0);
    // The table's page holds 25: the eleventh and the twenty-fifth are on
    // the first page, and the twenty-sixth is not.
    expect(
      screen.queryAllByText(/person-11@example\.com/).length
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(/person-25@example\.com/).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/person-26@example\.com/)).toBeNull();
  });
});
