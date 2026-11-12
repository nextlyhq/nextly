// @vitest-environment jsdom

/**
 * A submission's own page: each kind of answer read as it was asked, opening
 * a New submission marks it Read only for a person who may update it, newer
 * and older follow the list it was opened from, and staff edit answers with
 * the version they read.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AskedSnapshot } from "../utils/asked-fields";

import { browserLabel } from "./components/submissions/browser-label";
import { SubmissionAnswers } from "./components/submissions/SubmissionAnswers";
import { senderOf } from "../utils/submission-title";

import { SubmissionPage } from "./SubmissionPage";

const navigateTo = vi.fn();
vi.mock("@nextlyhq/plugin-sdk/admin", async original => ({
  ...(await original<object>()),
  navigateTo: (href: string) => navigateTo(href),
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigateTo.mockReset();
  window.history.replaceState(null, "", "/");
});

const answer = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );

const ASKED: AskedSnapshot = {
  fields: [
    { name: "name", label: "Full name", type: "text" },
    { name: "email", label: "Email", type: "email" },
    { name: "phone", label: "Phone", type: "phone" },
    { name: "site", label: "LinkedIn or portfolio", type: "url" },
    { name: "start", label: "Earliest start date", type: "date" },
    {
      name: "role",
      label: "Role",
      type: "select",
      options: [{ value: "backend", label: "Backend engineer" }],
    },
    { name: "relocate", label: "Open to relocating?", type: "checkbox" },
    { name: "cv", label: "CV", type: "file" },
    { name: "privacy", label: "Privacy", type: "consent" },
    { name: "portfolio", label: "Design portfolio", type: "text" },
  ],
  hidden: ["portfolio"],
};

const DATA = {
  name: "Hina Rossi",
  email: "hina@example.com",
  phone: "+92 346 1981442",
  site: "https://linkedin.com/in/hina-rossi",
  start: "2026-11-24",
  role: "backend",
  relocate: false,
  cv: "media-1",
  privacy: { agreed: true, text: "I agree to the privacy policy" },
};

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
  );
}

describe("a submission's answers", () => {
  it("reads each kind as it was asked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        answer(200, {
          id: "media-1",
          originalFilename: "cv-hina-rossi.pdf",
          size: 197_632,
          url: "https://cdn.example.com/cv-hina-rossi.pdf",
        })
      )
    );
    wrap(<SubmissionAnswers asked={ASKED} data={DATA} />);

    expect(
      screen.getByRole("link", { name: "hina@example.com" })
    ).toHaveAttribute("href", "mailto:hina@example.com");
    expect(
      screen.getByRole("link", { name: "+92 346 1981442" })
    ).toHaveAttribute("href", "tel:+923461981442");
    expect(
      screen.getByRole("link", { name: /linkedin\.com\/in\/hina-rossi/ })
    ).toHaveAttribute("target", "_blank");
    // In words, in the reader's own order: the day, the month by name, the
    // year, never the stored "2026-11-24".
    const start = screen.getByText(/Nov/);
    expect(start.textContent).toMatch(/24/);
    expect(start.textContent).toMatch(/2026/);
    expect(screen.queryByText("2026-11-24")).toBeNull();
    expect(screen.getByText("Backend engineer")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(await screen.findByText("cv-hina-rossi.pdf")).toBeInTheDocument();
    expect(
      screen.getByText(/193 KB · in the Media library/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Download cv-hina-rossi.pdf" })
    ).toHaveAttribute("href", "https://cdn.example.com/cv-hina-rossi.pdf");
    expect(
      screen.getByText(/I agree to the privacy policy/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("Not asked: a condition hid it")
    ).toBeInTheDocument();
    // Read by the labels it was asked under.
    expect(screen.getByText("Full name")).toBeInTheDocument();
  });
});

interface ServerOptions {
  status: string;
  permissions: Record<string, unknown>;
  newer?: string;
  older?: string;
}

/** The list's answer to one of the page's place queries. */
function listAnswer(url: string, options: ServerOptions) {
  const where = JSON.parse(
    new URL(url, "http://x").searchParams.get("where")!
  ) as { submittedAt?: { greater_than?: string; less_than?: string } };
  const one = (id: string | undefined) =>
    answer(200, { items: id ? [{ id }] : [], meta: { total: id ? 1 : 0 } });
  if (where.submittedAt?.greater_than) return one(options.newer);
  if (where.submittedAt?.less_than) return one(options.older);
  return answer(200, { items: [{ id: "sub-1" }], meta: { total: 3 } });
}

/** A server holding one submission of the "Jobs" form, and its list. */
function server(options: ServerOptions) {
  // The submission as stored, changed by what the page saves.
  let status = options.status;
  const routes: Array<
    [match: string, reply: (url: string) => Promise<Response>]
  > = [
    ["/me/permissions", () => answer(200, options.permissions)],
    [
      "/builder-config",
      () =>
        answer(200, {
          slugs: { forms: "forms", submissions: "form-submissions" },
        }),
    ],
    [
      "/collections/forms/entries/",
      () => answer(200, { id: "form-1", name: "Jobs", fields: [] }),
    ],
    [
      "/form-submissions/entries/sub-2",
      () =>
        answer(200, {
          id: "sub-2",
          form: "form-1",
          data: DATA,
          asked: ASKED,
          status,
          submittedAt: "2026-11-10T14:15:00.000Z",
          _rev: "rev-7",
        }),
    ],
    ["/form-submissions/entries?", url => listAnswer(url, options)],
    ["/media/", () => answer(404, {})],
  ];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const sent = JSON.parse(String(init.body)) as { status?: string };
      if (sent.status) status = sent.status;
      return answer(200, { item: {} });
    }
    const route = routes.find(([match]) => url.includes(match));
    return route ? route[1](url) : answer(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const patches = (fetchMock: ReturnType<typeof server>) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "PATCH")
    .map(([, init]) => JSON.parse(String(init?.body)));

function page() {
  wrap(<SubmissionPage entryId="sub-2" collectionSlug="form-submissions" />);
  return userEvent.setup();
}

describe("a submission's page", () => {
  it("marks a New submission Read for a person who may update it", async () => {
    const fetchMock = server({
      status: "new",
      permissions: {
        permissions: ["read-form-submissions", "update-form-submissions"],
      },
    });
    page();
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ status: "read", _rev: "rev-7" }])
    );
  });

  it("keeps New once a person sets it back after opening it", async () => {
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
    });
    const user = page();
    const details = await screen.findByRole("complementary", {
      name: "Submission details",
    });
    await waitFor(() =>
      expect(within(details).getByRole("button", { name: "New" })).toBeEnabled()
    );
    await user.click(within(details).getByRole("button", { name: "New" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ status: "new", _rev: "rev-7" }])
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    // Not read again behind the person's back.
    expect(patches(fetchMock)).toEqual([{ status: "new", _rev: "rev-7" }]);
  });

  it("leaves it New for a person who may only read submissions", async () => {
    const fetchMock = server({
      status: "new",
      permissions: { permissions: ["read-form-submissions"] },
    });
    page();
    expect(
      await screen.findByRole("heading", { name: "Hina Rossi" })
    ).toBeInTheDocument();
    // The permissions have been read, and nothing is sent.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/me/permissions")
        )
      ).toBe(true)
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(patches(fetchMock)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Edit answers" })).toBeNull();
  });

  it("moves to the older and newer of the list it was opened from", async () => {
    window.history.replaceState(null, "", "/x?status=new&form=form-1");
    server({
      status: "read",
      permissions: { isSuperAdmin: true },
      newer: "sub-1",
      older: "sub-3",
    });
    const user = page();
    expect(await screen.findByText("2 of 3")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Older submission" }));
    expect(navigateTo).toHaveBeenLastCalledWith(
      "/admin/collections/form-submissions/sub-3?status=new&form=form-1"
    );
    await user.click(screen.getByRole("button", { name: "Newer submission" }));
    expect(navigateTo).toHaveBeenLastCalledWith(
      "/admin/collections/form-submissions/sub-1?status=new&form=form-1"
    );
  });

  it("saves an internal note with the version it read", async () => {
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
    });
    const user = page();
    const note = await screen.findByRole("textbox", { name: "Internal note" });
    await user.type(note, "Book a call");
    await user.tab();
    await waitFor(() =>
      expect(patches(fetchMock)).toContainEqual({
        notes: "Book a call",
        _rev: "rev-7",
      })
    );
  });
});

describe("the page's helpers", () => {
  it("names a browser and its system", () => {
    expect(
      browserLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
      )
    ).toBe("Safari 18 on macOS");
    expect(
      browserLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0"
      )
    ).toBe("Edge 130 on Windows");
    expect(browserLabel("curl/8.0")).toBe("Unknown browser");
  });

  it("names the sender from a name answer, else an email", () => {
    expect(senderOf(ASKED.fields, DATA)).toBe("Hina Rossi");
    expect(senderOf(ASKED.fields, { email: "a@b.co" })).toBe("a@b.co");
    expect(senderOf(ASKED.fields, {})).toBeUndefined();
  });
});
