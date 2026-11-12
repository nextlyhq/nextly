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
// What the page last told the admin's leave guard, by key.
const unsavedWork = new Map<string, boolean>();
vi.mock("@nextlyhq/plugin-sdk/admin", async original => ({
  ...(await original<object>()),
  navigateTo: (href: string) => navigateTo(href),
  useReportUnsavedWork: (key: string, dirty: boolean) => {
    unsavedWork.set(key, dirty);
  },
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
  unsavedWork.clear();
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

  it("reads a file stored as an address as a link to it", () => {
    const fetchMock = vi.fn(() => answer(404, {}));
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <SubmissionAnswers
        asked={{
          fields: [{ name: "cv", label: "CV", type: "file" }],
          hidden: [],
        }}
        data={{ cv: "https://cdn.example.com/files/cv%20hina.pdf?v=2" }}
      />
    );
    expect(screen.getByText("cv hina.pdf")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open cv hina.pdf" })
    ).toHaveAttribute(
      "href",
      "https://cdn.example.com/files/cv%20hina.pdf?v=2"
    );
    expect(screen.queryByText("File not found")).toBeNull();
    // Not looked up in the Media library.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an answer the form no longer describes", () => {
    wrap(
      <SubmissionAnswers
        asked={{
          fields: [{ name: "name", label: "Full name", type: "text" }],
          hidden: [],
        }}
        data={{ name: "Hina Rossi", budget: "5k" }}
      />
    );
    expect(screen.getByText("budget")).toBeInTheDocument();
    expect(screen.getByText("5k")).toBeInTheDocument();
    expect(screen.getByText("No longer on the form")).toBeInTheDocument();
    // An answer the snapshot names is not repeated as one it lost.
    expect(screen.getAllByText("Hina Rossi")).toHaveLength(1);
  });
});

interface ServerOptions {
  status: string;
  permissions: Record<string, unknown>;
  newer?: string;
  older?: string;
  /** The forms collection as the install names it; "forms" when absent. */
  formsSlug?: string;
  /** The form's fields as it is now. */
  fields?: unknown[];
  /** What the server stores, for a test to change as another editor would. */
  store?: { data: Record<string, unknown>; notes?: string };
  /** Whether the server refuses a save as made from an old version. */
  refuse?: (sent: Record<string, unknown>) => boolean;
  /** Awaited before the server answers a save, to keep one on its way. */
  hold?: () => Promise<void>;
  /** The connection fails for every save. */
  offline?: boolean;
}

/** The list's answer to one of the page's place queries. */
function listAnswer(url: string, options: ServerOptions) {
  const where = JSON.parse(
    new URL(url, "http://x").searchParams.get("where")!
  ) as {
    or?: Array<{ submittedAt?: { greater_than?: string; less_than?: string } }>;
  };
  const one = (id: string | undefined) =>
    answer(200, { items: id ? [{ id }] : [], meta: { total: id ? 1 : 0 } });
  const side = where.or?.[0]?.submittedAt;
  if (side?.greater_than) return one(options.newer);
  if (side?.less_than) return one(options.older);
  return answer(200, { items: [{ id: "sub-1" }], meta: { total: 3 } });
}

/** A server holding one submission of the "Jobs" form, and its list. */
function server(options: ServerOptions) {
  // The submission as stored, changed by what the page saves: each save
  // moves its version on, as revision checking does.
  let status = options.status;
  let rev = 7;
  const store = options.store ?? { data: DATA };
  const formsSlug = options.formsSlug ?? "forms";
  const routes: Array<
    [match: string, reply: (url: string) => Promise<Response>]
  > = [
    ["/me/permissions", () => answer(200, options.permissions)],
    [
      "/builder-config",
      () =>
        answer(200, {
          slugs: { forms: formsSlug, submissions: "form-submissions" },
        }),
    ],
    [
      `/collections/${formsSlug}/entries/`,
      () =>
        answer(200, {
          id: "form-1",
          name: "Jobs",
          fields: options.fields ?? [],
        }),
    ],
    [
      "/form-submissions/entries/sub-2",
      () =>
        answer(200, {
          id: "sub-2",
          form: "form-1",
          data: store.data,
          notes: store.notes,
          asked: ASKED,
          status,
          submittedAt: "2026-11-10T14:15:00.000Z",
          _rev: `rev-${rev}`,
        }),
    ],
    ["/form-submissions/entries?", url => listAnswer(url, options)],
    ["/media/", () => answer(404, {})],
  ];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH" && options.offline) {
      throw new TypeError("Failed to fetch");
    }
    if (init?.method === "PATCH") {
      await options.hold?.();
      const sent = JSON.parse(String(init.body)) as {
        status?: string;
        notes?: string;
        data?: Record<string, unknown>;
      };
      if (options.refuse?.(sent)) {
        return answer(409, {
          error: { code: "STALE_VERSION", message: "Stale" },
        });
      }
      if (sent.status) status = sent.status;
      if (sent.notes !== undefined) store.notes = sent.notes;
      if (sent.data) store.data = sent.data;
      rev += 1;
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

function page(
  props: Partial<React.ComponentProps<typeof SubmissionPage>> = {}
) {
  wrap(
    <SubmissionPage
      entryId="sub-2"
      collectionSlug="form-submissions"
      {...props}
    />
  );
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

describe("a submission's page, writing", () => {
  it("sends nothing while a colleague holds the submission", async () => {
    const fetchMock = server({
      status: "new",
      permissions: { isSuperAdmin: true },
    });
    page({ documentLock: { readOnly: true, actionsDisabled: true } });
    const details = await screen.findByRole("complementary", {
      name: "Submission details",
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("/me/permissions")
        )
      ).toBe(true)
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    // Not even the automatic Read.
    expect(patches(fetchMock)).toEqual([]);
    expect(screen.queryByRole("button", { name: "Edit answers" })).toBeNull();
    expect(
      within(details).getByRole("button", { name: "Read" })
    ).toBeDisabled();
    expect(
      within(details).getByRole("textbox", { name: "Internal note" })
    ).toBeDisabled();
  });

  it("saves untouched answers without writing them", async () => {
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
      fields: [{ name: "name", label: "Full name", type: "text" }],
    });
    const user = page();
    await user.click(
      await screen.findByRole("button", { name: "Edit answers" })
    );
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    expect(
      await screen.findByRole("button", { name: "Edit answers" })
    ).toBeInTheDocument();
    expect(patches(fetchMock)).toEqual([]);

    // A real change is written.
    await user.click(screen.getByRole("button", { name: "Edit answers" }));
    const name = screen.getByRole("textbox", { name: "Full name" });
    await user.clear(name);
    await user.type(name, "Hina R.");
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { data: { ...DATA, name: "Hina R." }, _rev: "rev-7" },
      ])
    );
  });

  it("saves a note and then a status, each with the version before it left", async () => {
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
    });
    const user = page();
    const details = await screen.findByRole("complementary", {
      name: "Submission details",
    });
    const note = within(details).getByRole("textbox", {
      name: "Internal note",
    });
    await waitFor(() => expect(note).toBeEnabled());
    await user.type(note, "Book a call");
    // The click blurs the note, which saves it, then asks for the status.
    await user.click(within(details).getByRole("button", { name: "Archived" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { notes: "Book a call", _rev: "rev-7" },
        { status: "archived", _rev: "rev-8" },
      ])
    );
  });

  it("drops the answers queued behind a refused note", async () => {
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
      fields: [{ name: "name", label: "Full name", type: "text" }],
      refuse: sent => sent.notes !== undefined,
    });
    const user = page();
    await user.click(
      await screen.findByRole("button", { name: "Edit answers" })
    );
    const name = screen.getByRole("textbox", { name: "Full name" });
    await user.clear(name);
    await user.type(name, "Hina R.");
    await user.type(
      screen.getByRole("textbox", { name: "Internal note" }),
      "Book a call"
    );
    // The click blurs the note, whose save is refused, then asks to save
    // the answers.
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    expect(
      await screen.findByText(/Someone changed this submission/)
    ).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(patches(fetchMock)).toEqual([
      { notes: "Book a call", _rev: "rev-7" },
    ]);
    expect(screen.getByText(/Someone changed this submission/)).toBeVisible();
  });

  it("refuses an answer draft whose answers someone else changed", async () => {
    const store = { data: { ...DATA } as Record<string, unknown> };
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
      fields: [{ name: "name", label: "Full name", type: "text" }],
      store,
    });
    const user = page();
    await user.click(
      await screen.findByRole("button", { name: "Edit answers" })
    );
    // Another editor changes the answers; this page's own status change
    // then reads the newer version.
    store.data = { ...DATA, email: "hina.rossi@example.com" };
    const details = screen.getByRole("complementary", {
      name: "Submission details",
    });
    await user.click(within(details).getByRole("button", { name: "Archived" }));
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { status: "archived", _rev: "rev-7" },
      ])
    );
    const name = screen.getByRole("textbox", { name: "Full name" });
    await user.clear(name);
    await user.type(name, "Hina R.");
    await user.click(screen.getByRole("button", { name: "Save answers" }));
    expect(
      await screen.findByText(/Someone changed this submission/)
    ).toBeInTheDocument();
    // Their email is not written over with the draft's.
    expect(patches(fetchMock)).toHaveLength(1);
    expect(store.data.email).toBe("hina.rossi@example.com");
  });

  it("keeps a note typed while the last one is being saved", async () => {
    let release = () => undefined as void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
      hold: () => held,
    });
    const user = page();
    const note = await screen.findByRole("textbox", { name: "Internal note" });
    await waitFor(() => expect(note).toBeEnabled());
    await user.type(note, "Book");
    await user.tab();
    // While that save is on its way, the person goes on typing.
    await user.type(note, " a call");
    release();
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ notes: "Book", _rev: "rev-7" }])
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(note).toHaveValue("Book a call");
    expect(screen.queryByText(/Saved\./)).toBeNull();
    // Leaving it saves the rest, after the save before it.
    await user.tab();
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { notes: "Book", _rev: "rev-7" },
        { notes: "Book a call", _rev: "rev-8" },
      ])
    );
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });

  it("saves a note again once a failed save can be sent", async () => {
    const options: ServerOptions = {
      status: "read",
      permissions: { isSuperAdmin: true },
      offline: true,
    };
    const fetchMock = server(options);
    const user = page();
    const note = await screen.findByRole("textbox", { name: "Internal note" });
    await waitFor(() => expect(note).toBeEnabled());
    await user.type(note, "Book a call");
    await user.tab();
    expect(await screen.findByText(/could not be sent/)).toBeInTheDocument();
    // Back online: leaving the unchanged note sends it again.
    options.offline = false;
    await user.click(note);
    await user.tab();
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { notes: "Book a call", _rev: "rev-7" },
        { notes: "Book a call", _rev: "rev-7" },
      ])
    );
    expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
  });

  it("tells the leave guard while a changed answer is not saved", async () => {
    server({
      status: "read",
      permissions: { isSuperAdmin: true },
      fields: [{ name: "name", label: "Full name", type: "text" }],
    });
    const user = page();
    await user.click(
      await screen.findByRole("button", { name: "Edit answers" })
    );
    // Editing, nothing changed yet.
    expect(unsavedWork.get("forms.submission-answers")).toBe(false);
    await user.type(screen.getByRole("textbox", { name: "Full name" }), "!");
    expect(unsavedWork.get("forms.submission-answers")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(unsavedWork.get("forms.submission-answers")).toBe(false);
  });

  it("saves a note after one was cleared", async () => {
    const store = { data: DATA, notes: "Call back" as string | undefined };
    const fetchMock = server({
      status: "read",
      permissions: { isSuperAdmin: true },
      store,
    });
    const user = page();
    const note = await screen.findByRole("textbox", { name: "Internal note" });
    await waitFor(() => expect(note).toHaveValue("Call back"));
    await user.clear(note);
    await user.tab();
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([{ notes: "", _rev: "rev-7" }])
    );
    await user.type(note, "Booked");
    await user.tab();
    await waitFor(() =>
      expect(patches(fetchMock)).toEqual([
        { notes: "", _rev: "rev-7" },
        { notes: "Booked", _rev: "rev-8" },
      ])
    );
    expect(screen.queryByText(/Someone changed this submission/)).toBeNull();
  });

  it("says when a change could not be sent", async () => {
    server({
      status: "read",
      permissions: { isSuperAdmin: true },
      offline: true,
    });
    const user = page();
    const details = await screen.findByRole("complementary", {
      name: "Submission details",
    });
    const archived = within(details).getByRole("button", { name: "Archived" });
    await waitFor(() => expect(archived).toBeEnabled());
    await user.click(archived);
    expect(await screen.findByText(/could not be sent/)).toBeInTheDocument();
  });

  it("links the form under the forms collection as the install names it", async () => {
    server({
      status: "read",
      permissions: { isSuperAdmin: true },
      formsSlug: "contact-forms",
    });
    page();
    expect(await screen.findByRole("link", { name: "Jobs" })).toHaveAttribute(
      "href",
      "/admin/collections/contact-forms/form-1"
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
