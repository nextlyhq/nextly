// @vitest-environment jsdom

/**
 * The redirects screen as a person uses it: adding a redirect and reading
 * what was done, a refusal with the way to the redirect already there, an
 * inline edit, redirecting an address not found to the suggested page, and
 * importing a file only once its dry run is clean. What each write sends is
 * read from the write itself.
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  writePluginRoute: vi.fn(),
  toastMutationResult: vi.fn(),
}));

import {
  toastMutationResult,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type {
  ImportResult,
  NotFoundView,
  RedirectView,
} from "../../redirects/contract";
import { SeoRedirectsPage } from "../SeoRedirectsPage";

const AUTO: RedirectView = {
  id: "r1",
  from: "/testimonial",
  to: "/customers",
  type: "permanent",
  origin: "automatic",
  addedBy: null,
  addedAt: "2026-10-21T10:00:00.000Z",
  editedAt: "2026-10-21T10:00:00.000Z",
};
const SARA: RedirectView = {
  id: "r2",
  from: "/webinar",
  to: "/events/spring-webinar",
  type: "temporary",
  origin: "person",
  addedBy: "Sara Khan",
  addedAt: "2026-10-03T10:00:00.000Z",
  editedAt: "2026-10-03T10:00:00.000Z",
};
const MISSING: NotFoundView = {
  id: "n1",
  path: "/pricing-plans",
  from: "/pricing-plans",
  hits: 17,
  lastSeen: "2026-11-07T10:00:00.000Z",
  kind: "missing",
  suggestion: "/pricing",
};

/** What the fake server answers the not-found list with. */
let notFoundAnswer: () => { items?: NotFoundView[]; error?: Error };

/** Every write the screen made, in order. */
let writes: { path: string; method?: string; body?: unknown }[];
/** How the fake server answers a write. */
let answer: (request: {
  path: string;
  method?: string;
  body?: unknown;
}) => unknown;

beforeEach(() => {
  writes = [];
  answer = () => ({ message: "Done.", item: {} });
  notFoundAnswer = () => ({ items: [MISSING] });
  const refetch = vi.fn();
  vi.mocked(usePluginRoute).mockImplementation(((args: { path: string }) => {
    const answered =
      args.path === "/not-found" ? notFoundAnswer() : { items: [AUTO, SARA] };
    return {
      data:
        answered.items === undefined ? undefined : { items: answered.items },
      pending: false,
      error: answered.error ?? null,
      refetch,
      fetching: false,
    };
  }) as unknown as typeof usePluginRoute);
  vi.mocked(writePluginRoute).mockImplementation((async (request: {
    path: string;
    method?: string;
    body?: unknown;
  }) => {
    writes.push({
      path: request.path,
      method: request.method,
      body: request.body,
    });
    const result = answer(request);
    if (result instanceof Error) throw result;
    return result;
  }) as unknown as typeof writePluginRoute);
  vi.mocked(toastMutationResult).mockClear();
});

const from = () => screen.getByLabelText("From") as HTMLInputElement;
const to = () => screen.getByLabelText("To") as HTMLInputElement;

describe("the redirects screen", () => {
  it("lists each redirect with its type and who added it", () => {
    render(<SeoRedirectsPage />);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("Automatic")).toBeTruthy();
    expect(
      within(rows[1] as HTMLElement).getByText("on rename", { exact: false })
    ).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("Temporary")).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("Sara Khan")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Not found 1/ })).toBeTruthy();
  });

  it("adds a redirect as typed, and says what was done", async () => {
    answer = () => ({
      message: "Added. It works from the next visit.",
      item: { ...SARA, id: "r3" },
    });
    render(<SeoRedirectsPage />);

    fireEvent.change(from(), { target: { value: "/old-blog/*" } });
    fireEvent.change(to(), { target: { value: "/blog/*" } });
    fireEvent.click(screen.getByRole("button", { name: /Add redirect/ }));

    await screen.findByText("Added. It works from the next visit.");
    expect(writes).toEqual([
      {
        path: "/redirects",
        method: "POST",
        body: { from: "/old-blog/*", to: "/blog/*", type: "permanent" },
      },
    ]);
    expect(from().value).toBe("");
  });

  it("shows a refusal as the server says it, with the way to the redirect already there", async () => {
    answer = () =>
      Object.assign(new Error("refused"), {
        status: 409,
        code: "DUPLICATE",
        message:
          "/webinar already has a redirect. Remove it first, or edit it in the list.",
      });
    render(<SeoRedirectsPage />);

    fireEvent.change(from(), { target: { value: "/webinar" } });
    fireEvent.change(to(), { target: { value: "/x" } });
    fireEvent.click(screen.getByRole("button", { name: /Add redirect/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit that redirect" })
    );

    const field = screen.getByLabelText(
      "New destination for /webinar"
    ) as HTMLInputElement;
    expect(field.value).toBe("/events/spring-webinar");
  });

  it("edits a redirect in its row and sends the new To address and type", async () => {
    answer = () => ({
      message: "Saved. /webinar now goes to /events, permanent.",
      item: SARA,
    });
    render(<SeoRedirectsPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit redirect from /webinar" })
    );
    fireEvent.change(screen.getByLabelText("New destination for /webinar"), {
      target: { value: "/events" },
    });
    fireEvent.change(screen.getByLabelText("Type for /webinar"), {
      target: { value: "permanent" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved. /webinar now goes to /events, permanent.");
    expect(writes).toEqual([
      {
        path: "/redirects/r2",
        method: "PATCH",
        body: { to: "/events", type: "permanent" },
      },
    ]);
  });

  it("takes an address not found to the form, with the closest live page suggested", async () => {
    render(<SeoRedirectsPage />);

    fireEvent.click(screen.getByRole("tab", { name: /Not found/ }));
    expect(screen.getByText("17")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Redirect /pricing-plans" })
    );

    expect(from().value).toBe("/pricing-plans");
    expect(to().value).toBe("/pricing");
    expect(
      screen.getByText(
        "Suggested: /pricing, the closest live page. Change it if it's wrong."
      )
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(to()));
  });

  it("shows a file's dry run, imports nothing while a row has a loop, and imports a clean file", async () => {
    const withLoop: ImportResult = {
      applied: false,
      rows: [
        {
          line: 1,
          from: "/old-blog/*",
          to: "/blog/*",
          kind: "new",
          says: "New pattern: every old address goes to the same place under the new one.",
        },
        {
          line: 2,
          from: "/customers",
          to: "/testimonial",
          kind: "refused",
          refusal: "loop",
          says: "Loop: /customers → /testimonial → /customers.",
        },
      ],
    };
    answer = request =>
      (request.body as { apply?: boolean }).apply === true
        ? {
            message: "Imported 1 redirect in one step",
            item: { ...withLoop, applied: true },
          }
        : { message: "2 rows read. Nothing has changed yet.", item: withLoop };
    render(<SeoRedirectsPage />);
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    fireEvent.change(input, {
      target: {
        files: [
          new File(
            ["/old-blog/*,/blog/*\n/customers,/testimonial"],
            "redirects.csv"
          ),
        ],
      },
    });

    const box = await screen.findByRole("region", {
      name: "Import redirects.csv",
    });
    expect(
      within(box).getByText("Loop: /customers → /testimonial → /customers.")
    ).toBeTruthy();
    expect(
      within(box).getByText(/Fix the 1 row with a loop and upload again\./)
    ).toBeTruthy();
    const importButton = within(box).getByRole("button", {
      name: "Import 1 redirect",
    }) as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);
    expect(
      writes.map(each => (each.body as { apply?: boolean }).apply)
    ).toEqual([undefined]);

    const clean: ImportResult = {
      applied: false,
      rows: [withLoop.rows[0] as ImportResult["rows"][number]],
    };
    answer = request =>
      (request.body as { apply?: boolean }).apply === true
        ? {
            message: "Imported 1 redirect in one step",
            item: { ...clean, applied: true },
          }
        : { message: "1 row read. Nothing has changed yet.", item: clean };
    fireEvent.change(input, {
      target: {
        files: [new File(["/old-blog/*,/blog/*"], "redirects-fixed.csv")],
      },
    });
    const fixed = await screen.findByRole("region", {
      name: "Import redirects-fixed.csv",
    });
    fireEvent.click(
      within(fixed).getByRole("button", { name: "Import 1 redirect" })
    );

    await waitFor(() =>
      expect(toastMutationResult).toHaveBeenCalledWith(
        "Imported 1 redirect in one step",
        undefined
      )
    );
    expect(screen.queryByRole("region", { name: /Import/ })).toBeNull();
    expect(writes.at(-1)?.body).toEqual({
      file: "/old-blog/*,/blog/*",
      apply: true,
    });
  });
  it("keeps the redirects usable for someone who may not read the addresses not found", () => {
    notFoundAnswer = () => ({
      error: Object.assign(new Error("forbidden"), {
        status: 403,
        code: "FORBIDDEN",
        message: "You don't have permission to do that.",
      }),
    });
    render(<SeoRedirectsPage />);

    expect(
      screen.getByRole("button", { name: "Edit redirect from /webinar" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Not found/ }));
    expect(screen.getByRole("alert").textContent).toContain(
      "The addresses not found could not be read."
    );
  });

  it("fills the form with an address not found on another language's domain as it was asked for", () => {
    notFoundAnswer = () => ({
      items: [
        {
          ...MISSING,
          path: "/weg",
          from: "https://example.de/weg",
          suggestion: "https://example.de/neu",
        },
      ],
    });
    render(<SeoRedirectsPage />);

    fireEvent.click(screen.getByRole("tab", { name: /Not found/ }));
    fireEvent.click(screen.getByRole("button", { name: "Redirect /weg" }));

    expect(from().value).toBe("https://example.de/weg");
    expect(to().value).toBe("https://example.de/neu");
  });

  it("keeps what was typed when switching tabs, and never writes the tab to the address", () => {
    // The admin remounts a plugin page whenever its address changes, which
    // would throw typed input away.
    const before = window.location.href;
    render(<SeoRedirectsPage />);

    fireEvent.change(from(), { target: { value: "/half-typed" } });
    fireEvent.click(screen.getByRole("tab", { name: /Not found/ }));
    fireEvent.click(screen.getByRole("tab", { name: /Redirects/ }));

    expect(from().value).toBe("/half-typed");
    expect(window.location.href).toBe(before);
  });
});
