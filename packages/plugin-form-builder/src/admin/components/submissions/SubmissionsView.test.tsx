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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubmissionRow } from "./submission-row";
import { SubmissionsView, submissionPatch } from "./SubmissionsView";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SUBMISSION_COUNT_KEY } from "../editor/useSubmissionCount";

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

// The row carries the version the list read it at, and the server answers
// that the submission changed since: the action stores nothing, and the list
// says so rather than leaving the click looking like it did nothing.
describe("a row's Not spam refused because the submission changed since", () => {
  it("says the submission changed, and shows the list read again", async () => {
    const spam = {
      ...SUBMISSIONS[0],
      id: "submission-spam",
      status: "spam",
      _rev: "2",
    };
    const fetched = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (init?.method === "PATCH") {
          return Response.json(
            {
              error: {
                code: "STALE_VERSION",
                message: "This document changed since the version you gave.",
                data: { currentVersion: "3" },
              },
            },
            { status: 409 }
          );
        }
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
            return entriesPage([spam], url);
          default:
            return new Response(null, { status: 404 });
        }
      }
    );
    vi.stubGlobal("fetch", fetched);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SubmissionsView collectionSlug="form-submissions" />
      </QueryClientProvider>
    );

    await user.click(
      (await screen.findAllByRole("button", { name: "Row actions" }))[0]
    );
    await user.click(await screen.findByText("Not spam"));

    expect(
      await screen.findByText(/changed this submission since the list loaded/)
    ).toBeInTheDocument();
  });
});

// The form editor shows the form's submission count beside this list; a
// change made here reads it again rather than leaving the one taken on open.
describe("a row's status changed from the list", () => {
  async function markNotSpam(answer: "stored" | "refused") {
    const spam = { ...SUBMISSIONS[0], id: "submission-spam", status: "spam" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (init?.method === "PATCH") {
          return answer === "stored"
            ? Response.json({ message: "Updated", item: spam })
            : Response.json(
                { error: { code: "FORBIDDEN", message: "No." } },
                { status: 403 }
              );
        }
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
            return entriesPage([spam], url);
          default:
            return new Response(null, { status: 404 });
        }
      })
    );
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <SubmissionsView collectionSlug="form-submissions" />
      </QueryClientProvider>
    );
    await user.click(
      (await screen.findAllByRole("button", { name: "Row actions" }))[0]
    );
    await user.click(await screen.findByText("Not spam"));
    return invalidate;
  }

  it("reads the form's submission count again once the change is stored", async () => {
    const invalidate = await markNotSpam("stored");
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: SUBMISSION_COUNT_KEY,
      })
    );
  });

  it("leaves the count alone when the change is refused", async () => {
    // The control: the count is read again because something changed, not
    // on every click.
    const invalidate = await markNotSpam("refused");
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Row actions" })
      ).not.toHaveLength(0)
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: SUBMISSION_COUNT_KEY,
    });
  });
});

describe("SubmissionsView reads past the server's default page", () => {
  it("shows a deep-linked form's own columns", async () => {
    // The control for the case below: a form on the server's first page,
    // which any page size reaches. It passing while the next case fails is
    // what says the forms list was cut short, not that the columns never draw.
    window.history.replaceState(null, "", "/?form=form-3");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SubmissionsView collectionSlug="form-submissions" />
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("columnheader", { name: "Email for form 3" })
    ).toBeInTheDocument();
  });

  it("knows a form beyond the first ten, so its own columns show", async () => {
    // The deep link selects the twelfth form. Its per-field columns come from
    // the forms the view loaded, so a list that stopped at ten leaves it
    // unknown and the table falls back to the all-forms columns.
    window.history.replaceState(null, "", "/?form=form-12");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SubmissionsView collectionSlug="form-submissions" />
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("columnheader", { name: "Email for form 12" })
    ).toBeInTheDocument();
  });

  it("shows every submission of a page, not the server's default count", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SubmissionsView collectionSlug="form-submissions" />
      </QueryClientProvider>
    );

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

describe("a change to a submission", () => {
  const row = (rev?: string): SubmissionRow => ({
    id: "submission-1",
    form: "form-1",
    data: {},
    status: "spam",
    ...(rev === undefined ? {} : { _rev: rev }),
  });

  it("sends the version its row had when the list read it", () => {
    expect(submissionPatch(row("4"), { status: "new" })).toEqual({
      status: "new",
      _rev: "4",
    });
  });

  it("sends the change alone for a row read without one", () => {
    expect(submissionPatch(row(), { status: "new" })).toEqual({
      status: "new",
    });
    expect(submissionPatch(undefined, { status: "new" })).toEqual({
      status: "new",
    });
  });
});

// A form's own Submissions tab needs that form's fields, not every form's:
// walking the whole collection on a site with many forms delays the columns
// and loads everything to use one.
describe("the list fixed to one form", () => {
  it("reads that form alone, and draws its own columns", async () => {
    const fetched = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/admin/api/collections/forms/entries/form-11") {
        return Response.json(FORMS[10]);
      }
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
    });
    vi.stubGlobal("fetch", fetched);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SubmissionsView collectionSlug="form-submissions" formId="form-11" />
      </QueryClientProvider>
    );

    expect(
      await screen.findByRole("columnheader", { name: "Email for form 11" })
    ).toBeInTheDocument();
    const paths = fetched.mock.calls.map(
      ([input]) => new URL(String(input), "http://localhost").pathname
    );
    expect(paths).toContain("/admin/api/collections/forms/entries/form-11");
    expect(paths).not.toContain("/admin/api/collections/forms/entries");
    // No choice of form: the tab is the form's.
    expect(
      screen.queryByRole("combobox", { name: "Filter by form" })
    ).toBeNull();
  });
});

// The job application's list, as its Submissions tab draws it: a select whose
// stored values differ from its labels, and two submissions.
const JOB = {
  id: "job",
  name: "Job application",
  fields: [
    { name: "full_name", label: "Full name", type: "text" },
    { name: "email", label: "Email", type: "email" },
    {
      name: "role",
      label: "Role",
      type: "select",
      options: [
        { value: "backend-engineer", label: "Backend engineer" },
        { value: "designer", label: "Product designer" },
      ],
    },
    { name: "years", label: "Years", type: "number" },
  ],
};

const APPLICATIONS = [
  {
    id: "app-1",
    form: "job",
    title: "Hina Rossi",
    data: {
      full_name: "Hina Rossi",
      email: "hina@example.com",
      role: "backend-engineer",
      years: 4,
    },
    status: "new",
    submittedAt: "2026-11-10T14:15:00.000Z",
    _rev: "1",
  },
  {
    id: "app-2",
    form: "job",
    title: "Ali Shah",
    data: {
      full_name: "Ali Shah",
      email: "ali@example.com",
      role: "designer",
      years: 2,
    },
    status: "read",
    submittedAt: "2026-11-09T10:00:00.000Z",
    _rev: "1",
  },
  {
    id: "app-3",
    form: "job",
    title: "Noor Garcia",
    data: { full_name: "Noor Garcia", role: "designer" },
    status: "new",
    submittedAt: "2026-11-08T10:00:00.000Z",
    _rev: "1",
  },
];

/** The job form's server, for a person holding `permissions`. */
function serveJob(permissions: unknown = { isSuperAdmin: true }) {
  const fetched = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/bulk-update")) {
        const body = JSON.parse(String(init?.body)) as { ids: string[] };
        return Response.json({
          message: "Updated",
          items: body.ids.map(id => ({ id })),
          errors: [],
        });
      }
      switch (url.pathname) {
        case "/admin/api/plugins/@nextlyhq/plugin-form-builder/builder-config":
          return Response.json({
            slugs: { forms: "forms", submissions: "form-submissions" },
          });
        case "/admin/api/me/permissions":
          return Response.json(permissions);
        case "/admin/api/collections/forms/entries/job":
          return Response.json(JOB);
        case "/admin/api/collections/forms/entries":
          return entriesPage([JOB], url);
        case "/admin/api/collections/form-submissions/entries":
          return entriesPage(APPLICATIONS, url);
        default:
          return new Response(null, { status: 404 });
      }
    }
  );
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

function renderList(props: { formId?: string } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SubmissionsView collectionSlug="form-submissions" {...props} />
    </QueryClientProvider>
  );
}

/** Ticks the rows named, by their lead text in the table. */
async function tick(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  const table = await screen.findByRole("table", { name: "Submissions" });
  for (const name of names) {
    const row = (await within(table).findByText(name)).closest("tr");
    if (row === null) throw new Error(`no row for ${name}`);
    await user.click(within(row).getByRole("checkbox"));
  }
}

describe("a form's Submissions tab", () => {
  it("has the form's labels as columns, and a choice by its option's label", async () => {
    serveJob();
    renderList({ formId: "job" });
    const table = await screen.findByRole("table", { name: "Submissions" });
    await within(table).findByText("Hina Rossi");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map(header => header.textContent);
    expect(headers).toEqual(
      expect.arrayContaining(["Full name", "Email", "Role", "Years"])
    );
    expect(within(table).getByText("Backend engineer")).toBeInTheDocument();
    expect(within(table).queryByText("backend-engineer")).toBeNull();
  });
});

describe("adding a submission", () => {
  it.each([
    ["a form's tab", { formId: "job" }],
    ["every form's list", {}],
  ])("is offered nowhere on %s", async (_, props) => {
    serveJob();
    renderList(props);
    await screen.findAllByText("Hina Rossi");
    const offers = [
      ...screen.queryAllByRole("button"),
      ...screen.queryAllByRole("link"),
    ].filter(control =>
      /\b(new|add|create)\b/i.test(control.textContent ?? "")
    );
    expect(offers).toEqual([]);
  });
});

describe("ticked rows", () => {
  it("are acted on alone: Archive sends exactly those rows", async () => {
    const fetched = serveJob();
    const user = userEvent.setup();
    renderList({ formId: "job" });
    await tick(user, ["Hina Rossi", "Noor Garcia"]);

    const bar = await screen.findByRole("region", {
      name: "Selected submissions",
    });
    expect(within(bar).getByText(/2 selected/)).toBeInTheDocument();
    await user.click(within(bar).getByRole("button", { name: "Archive" }));

    const bulk = fetched.mock.calls.find(([input]) =>
      String(input).endsWith("/bulk-update")
    );
    expect(bulk).toBeDefined();
    expect(JSON.parse(String(bulk?.[1]?.body))).toEqual({
      ids: ["app-1", "app-3"],
      data: { status: "archived", spamReason: null },
      revs: { "app-1": "1", "app-3": "1" },
    });
    expect(
      await screen.findByText("Archived 2 submissions.")
    ).toBeInTheDocument();
  });

  it("export exactly the ticked rows", async () => {
    serveJob();
    const user = userEvent.setup();
    renderList({ formId: "job" });
    await tick(user, ["Hina Rossi", "Ali Shah"]);
    const bar = await screen.findByRole("region", {
      name: "Selected submissions",
    });
    await user.click(within(bar).getByRole("button", { name: "Export" }));
    const csv = await screen.findByRole("menuitem", { name: /CSV/ });
    const address = new URL(csv.getAttribute("href") ?? "", "http://x");
    expect(address.searchParams.get("ids")).toBe("app-1,app-2");
    expect(address.searchParams.get("form")).toBe("job");
    expect(address.searchParams.get("format")).toBe("csv");
  });

  it("offer only what the person's role allows", async () => {
    serveJob({ permissions: ["read-form-submissions", "read-forms"] });
    const user = userEvent.setup();
    renderList({ formId: "job" });
    await tick(user, ["Hina Rossi"]);
    const bar = await screen.findByRole("region", {
      name: "Selected submissions",
    });
    for (const name of [
      "Mark as read",
      "Archive",
      "Spam",
      "Export",
      "Delete",
    ]) {
      expect(within(bar).queryByRole("button", { name })).toBeNull();
    }
  });

  it("delete only once the person confirms", async () => {
    const fetched = serveJob();
    const user = userEvent.setup();
    renderList({ formId: "job" });
    await tick(user, ["Ali Shah"]);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      fetched.mock.calls.some(([input]) =>
        String(input).includes("bulk-delete")
      )
    ).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Keep them" }));
    expect(
      fetched.mock.calls.some(([input]) =>
        String(input).includes("bulk-delete")
      )
    ).toBe(false);
  });
});

describe("the date filter", () => {
  it("asks the server for the dates chosen", async () => {
    const fetched = serveJob();
    const user = userEvent.setup();
    renderList({ formId: "job" });
    await screen.findAllByText("Hina Rossi");
    await user.click(screen.getByRole("button", { name: /^Date sent:/ }));
    await user.click(
      await screen.findByRole("button", { name: "Last 7 days" })
    );

    await waitFor(() => {
      const wheres = fetched.mock.calls
        .map(([input]) => new URL(String(input), "http://localhost"))
        .filter(
          url =>
            url.pathname === "/admin/api/collections/form-submissions/entries"
        )
        .map(url => JSON.parse(url.searchParams.get("where") ?? "{}"));
      expect(wheres.at(-1)?.submittedAt?.greater_than_equal).toEqual(
        expect.any(String)
      );
    });
    expect(
      screen.getByRole("button", { name: "Date sent: Last 7 days" })
    ).toBeInTheDocument();
  });
});
