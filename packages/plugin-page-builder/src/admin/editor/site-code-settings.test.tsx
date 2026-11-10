// @vitest-environment jsdom
/**
 * Settings → Site → Code: what is saved in plain words; every save checked
 * first, with the policy the site sends; what can't be stored named and
 * focused, saving nothing; what a policy blocks saved only once the person
 * says they understand, with what to add to the policy to copy; and no
 * policy said plainly, never shown as a pass.
 *
 * @module admin/editor/site-code-settings.test
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SiteCodeChecked,
  SiteCodeRead,
  SiteCodeSaved,
} from "../../library-contract";

let codeRead: SiteCodeRead;
const refetch = vi.fn();
/** Each write's body, in order: dry runs and saves alike. */
const writes: Record<string, unknown>[] = [];
let checkAnswer: SiteCodeChecked;
/** Whether the read is being refreshed, and how its last refresh failed. */
let refreshing = false;
let readError: Error | null = null;
/** Holds every write until released, to look at the section mid-check. */
let held: Promise<void> | null = null;
let saveAnswer: SiteCodeSaved;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: () => ({
    data: codeRead,
    pending: false,
    error: readError,
    fetching: refreshing,
    refetch,
  }),
  writePluginRoute: async ({ body }: { body: Record<string, unknown> }) => {
    writes.push(body);
    if (held !== null) await held;
    return {
      message: "",
      item: body.dryRun === true ? checkAnswer : saveAnswer,
    };
  },
}));

vi.mock("@nextlyhq/builder/shell", () => ({
  SITE_CODE_POLICY_DOCS_HREF:
    "https://nextlyhq.com/docs/page-builder/site-code#your-content-security-policy",
}));

const { SiteCodeSection } = await import("./site-code-settings");

/** A place with nothing refused, holding `elements`. */
const judged = (elements = 1) => ({ refusals: [], notes: [], elements });

/** A check with no policy known. */
const unchecked: SiteCodeChecked = {
  head: judged(),
  body: judged(0),
  csp: [
    {
      source: "declared",
      check: { checked: false, reason: "No policy." },
      additions: [],
      policies: 0,
    },
  ],
  cspKey: null,
};

/** What the site's home page answers with: its policy header, if any. */
let livePolicy: string | null = null;
const fetched: { url: string; init: RequestInit | undefined }[] = [];

beforeEach(() => {
  codeRead = {
    head: "",
    body: "",
    version: "rev-1",
    policyDeclared: true,
    described: { head: [], body: [] },
    changedAt: null,
    changedBy: null,
  };
  writes.length = 0;
  fetched.length = 0;
  refetch.mockClear();
  livePolicy = null;
  refreshing = false;
  readError = null;
  held = null;
  checkAnswer = unchecked;
  saveAnswer = { ...unchecked, version: "rev-2" };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    fetched.push({ url, init });
    return new Response("", {
      headers:
        livePolicy === null ? {} : { "content-security-policy": livePolicy },
    });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The section, with what it tells the Site tab. */
function show() {
  const told = {
    editing: vi.fn(),
    saving: vi.fn(),
    open: vi.fn(),
  };
  render(
    <SiteCodeSection
      onEditingChange={told.editing}
      onSavingChange={told.saving}
      onOpenChange={told.open}
    />
  );
  return told;
}

/** Open the code and type `head` into the head. */
function editHead(head: string): void {
  fireEvent.click(screen.getByRole("button", { name: /^(Add|Edit) code$/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Head" }), {
    target: { value: head },
  });
}

describe("the site's code in Settings", () => {
  it("says a site with none has nothing yet, and offers to add it", () => {
    show();
    expect(screen.getAllByText("Nothing yet")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add code" })).toBeTruthy();
    // The code itself is shown only once it is opened.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("describes what is saved in plain words, and who changed it", () => {
    codeRead = {
      ...codeRead,
      head: "<script async src=x></script>",
      described: {
        head: ["A script from www.googletagmanager.com", "an inline script"],
        body: [],
      },
      changedAt: `${new Date().getFullYear()}-11-06T09:30:00.000Z`,
      changedBy: "Ada Lovelace",
    };
    show();
    expect(
      screen.getByText(
        "A script from www.googletagmanager.com, an inline script"
      )
    ).toBeTruthy();
    expect(screen.getByText(/^Last changed .* by Ada Lovelace$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit code" })).toBeTruthy();
    expect(screen.queryByText("<script async src=x></script>")).toBeNull();
  });

  it("opens the saved code to edit, with the warning, and says when it changed", () => {
    codeRead = { ...codeRead, head: "<meta name=a content=b>" };
    const told = show();
    fireEvent.click(screen.getByRole("button", { name: "Add code" }));
    expect(
      (screen.getByRole("textbox", { name: "Head" }) as HTMLTextAreaElement)
        .value
    ).toBe("<meta name=a content=b>");
    expect(
      screen.getByText(
        "Code here runs on every page, with the access of whoever views it."
      )
    ).toBeTruthy();
    expect(told.open).toHaveBeenLastCalledWith(true);
    // Open but unchanged, leaving needn't ask.
    expect(told.editing).toHaveBeenLastCalledWith(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Head" }), {
      target: { value: "<meta name=a content=c>" },
    });
    expect(told.editing).toHaveBeenLastCalledWith(true);
  });

  it("checks with the policy the site sends, read as a visitor gets it", async () => {
    livePolicy = "script-src 'self'";
    show();
    editHead("<script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(fetched).toEqual([
      { url: "/", init: { credentials: "omit", cache: "no-store" } },
    ]);
    expect(writes[0]).toEqual({
      head: "<script>a()</script>",
      body: "",
      livePolicy: { policy: "script-src 'self'", reportOnly: false },
      dryRun: true,
    });
  });

  it("names what can't be stored under its place, focuses it, and saves nothing", async () => {
    checkAnswer = {
      ...unchecked,
      head: {
        refusals: [
          "<img> isn't allowed here; a tracking pixel goes in a <noscript> at the end of the body",
          "<base>: <base> isn't allowed.",
        ],
        notes: [],
        elements: 0,
      },
    };
    show();
    editHead("<img src=x><base href=/>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    const first = await screen.findByText(/^<img> isn't allowed here/);
    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(screen.getByText("Nothing was saved.")).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Head" }).getAttribute("aria-invalid")
    ).toBe("true");
    // The dry run only: nothing was saved, and the text is as typed.
    expect(writes).toHaveLength(1);
    expect(
      (screen.getByRole("textbox", { name: "Head" }) as HTMLTextAreaElement)
        .value
    ).toBe("<img src=x><base href=/>");
  });

  it("saves what a policy blocks only once the person says they understand, with its key", async () => {
    checkAnswer = {
      head: judged(2),
      body: judged(0),
      csp: [
        {
          source: "declared",
          check: {
            checked: true,
            findings: [
              {
                slot: "head",
                index: 0,
                directive: "script-src",
                message:
                  "https://www.googletagmanager.com is blocked for scripts",
                level: "error",
              },
            ],
          },
          additions: [
            {
              policy: 0,
              directive: "script-src-elem",
              sources: ["'self'", "https://www.googletagmanager.com/gtag/js"],
            },
          ],
          policies: 1,
        },
        {
          source: "live",
          check: {
            checked: true,
            findings: [
              {
                slot: "head",
                index: 0,
                directive: "script-src",
                message:
                  "https://www.googletagmanager.com is blocked for scripts",
                level: "error",
              },
            ],
          },
          additions: [],
          policies: 1,
        },
      ],
      cspKey: "sha256-findings",
    };
    const clipboard = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboard },
      configurable: true,
    });
    show();
    editHead(
      '<script async src="https://www.googletagmanager.com/gtag/js"></script>'
    );
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await screen.findByText(
      "The site's security policy would block some of this code"
    );
    // One row for the block both policies make, naming both.
    expect(screen.getByText("Head, 1st element")).toBeTruthy();
    expect(screen.getByText("script-src · declared, live")).toBeTruthy();
    const add =
      "script-src-elem 'self' https://www.googletagmanager.com/gtag/js";
    expect(screen.getByText(add)).toBeTruthy();
    expect(
      screen.getByText("add to the policy this site declares:", {
        exact: false,
      })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy what to add to the policy this site declares",
      })
    );
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(add));
    const saveAnyway = screen.getByRole("button", { name: "Save anyway" });
    expect((saveAnyway as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand this code won't run on pages until the policy allows it.",
      })
    );
    expect((saveAnyway as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveAnyway);
    await screen.findByText("Site code saved");
    expect(writes[1]).toEqual({
      head: '<script async src="https://www.googletagmanager.com/gtag/js"></script>',
      body: "",
      version: "rev-1",
      acknowledgeCsp: "sha256-findings",
    });
  });

  it("says plainly that no policy is known before saving, never as a pass", async () => {
    codeRead = { ...codeRead, policyDeclared: false };
    const told = show();
    editHead("<script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await screen.findByText(
      "No security policy is known for this site, so nothing was checked against one"
    );
    expect(writes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await screen.findByText("Site code saved");
    expect(writes[1]).toEqual({
      head: "<script>a()</script>",
      body: "",
      version: "rev-1",
    });
    // Saved, the summary is read again and the section is closed.
    expect(refetch).toHaveBeenCalled();
    expect(told.open).toHaveBeenLastCalledWith(false);
    expect(
      screen.getByText(/1 element in the head, 0 at the end of the body\.$/)
    ).toBeTruthy();
  });

  it("saves at once code a policy is checked against and allows", async () => {
    checkAnswer = {
      ...unchecked,
      csp: [
        {
          source: "declared",
          check: { checked: true, findings: [] },
          additions: [],
          policies: 1,
        },
      ],
    };
    show();
    editHead("<script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await screen.findByText("Site code saved");
    expect(writes.map(write => write.dryRun === true)).toEqual([true, false]);
  });

  it("keeps the text and says why when a save is refused", async () => {
    checkAnswer = {
      ...unchecked,
      csp: [
        {
          source: "declared",
          check: { checked: true, findings: [] },
          additions: [],
          policies: 1,
        },
      ],
    };
    saveAnswer = undefined as unknown as SiteCodeSaved;
    show();
    editHead("<script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(
      await screen.findByText("The site did not answer. Try again.")
    ).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Head" }) as HTMLTextAreaElement)
        .value
    ).toBe("<script>a()</script>");
  });

  it("keeps the text as it was checked while the check is in flight", async () => {
    let release = (): void => undefined;
    held = new Promise(resolve => {
      release = resolve;
    });
    show();
    editHead("<script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    const head = screen.getByRole("textbox", { name: "Head" });
    expect((head as HTMLTextAreaElement).readOnly).toBe(true);
    release();
    await screen.findByText(/^No security policy is known/);
  });

  it("opens the code only once a refreshing read has answered", () => {
    refreshing = true;
    show();
    const add = screen.getByRole("button", { name: "Add code" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps each policy's additions apart, and gives the same advice once", async () => {
    const blocked = (source: "declared" | "live", sources: string[]) => ({
      source,
      check: {
        checked: true as const,
        findings: [
          {
            slot: "head" as const,
            index: 0,
            directive: "script-src",
            message: "https://cdn.example is blocked for scripts",
            level: "error" as const,
          },
        ],
      },
      additions: [{ policy: 0, directive: "script-src-elem", sources }],
      policies: 1,
    });
    checkAnswer = {
      head: judged(1),
      body: judged(0),
      csp: [
        blocked("declared", ["'self'", "https://cdn.example/a.js"]),
        blocked("live", ["https:", "https://cdn.example/a.js"]),
      ],
      cspKey: "sha256-k",
    };
    show();
    editHead('<script src="https://cdn.example/a.js"></script>');
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    // Each policy's line under its own name: never 'self' and https: merged.
    expect(
      await screen.findByText("script-src-elem 'self' https://cdn.example/a.js")
    ).toBeTruthy();
    expect(
      screen.getByText("script-src-elem https: https://cdn.example/a.js")
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Copy what to add to the policy the site sends",
      })
    ).toBeTruthy();
    cleanup();
    checkAnswer = {
      ...checkAnswer,
      csp: [
        blocked("declared", ["https://cdn.example/a.js"]),
        blocked("live", ["https://cdn.example/a.js"]),
      ],
    };
    show();
    editHead('<script src="https://cdn.example/a.js"></script>');
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(
      await screen.findByRole("button", {
        name: "Copy what to add to the site's policy",
      })
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Copy what to add/ })
    ).toHaveLength(1);
  });

  it("shows what won't be kept, and what a report-only policy reports, before saving", async () => {
    checkAnswer = {
      head: {
        refusals: [],
        notes: ["1 HTML comment was left out."],
        elements: 1,
      },
      body: judged(0),
      csp: [
        {
          source: "declared",
          check: {
            checked: true,
            findings: [
              {
                slot: "head",
                index: 0,
                directive: "script-src",
                message: "this inline script is blocked",
                level: "warning",
              },
            ],
          },
          additions: [],
          policies: 1,
        },
      ],
      cspKey: null,
    };
    show();
    editHead("<!-- tag --><script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(
      await screen.findByText("Head: 1 HTML comment was left out.")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "The site's report-only policy would report some of this code"
      )
    ).toBeTruthy();
    expect(
      screen.getByText("This inline script is blocked (reported only)")
    ).toBeTruthy();
    // Nothing saved until the person goes on from what they were shown.
    expect(writes).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await screen.findByText("Site code saved");
    expect(writes[1]).not.toHaveProperty("acknowledgeCsp");
  });

  it("names which of a header's policies needs the addition, even when only one does", async () => {
    checkAnswer = {
      head: judged(1),
      body: judged(0),
      csp: [
        {
          source: "live",
          check: {
            checked: true,
            findings: [
              {
                slot: "head",
                index: 0,
                directive: "script-src",
                message: "https://cdn.example is blocked for scripts",
                level: "error",
              },
            ],
          },
          additions: [
            {
              policy: 1,
              directive: "script-src-elem",
              sources: ["https://cdn.example/a.js"],
            },
          ],
          policies: 2,
        },
      ],
      cspKey: "sha256-k",
    };
    show();
    editHead('<script src="https://cdn.example/a.js"></script>');
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(
      await screen.findByRole("button", {
        name: "Copy what to add to the policy the site sends, the 2nd in its header",
      })
    ).toBeTruthy();
  });

  it("keeps the code closed and offers Retry when a refresh fails", () => {
    readError = new Error("offline");
    show();
    const add = screen.getByRole("button", { name: "Add code" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("calls a block a block when one policy enforces what another only reports", async () => {
    const seen = (source: "declared" | "live", level: "error" | "warning") => ({
      source,
      check: {
        checked: true as const,
        findings: [
          {
            slot: "head" as const,
            index: 0,
            directive: "script-src",
            message: "this inline script is blocked",
            level,
          },
        ],
      },
      additions: [],
      policies: 1,
    });
    checkAnswer = {
      head: judged(1),
      body: judged(0),
      csp: [seen("declared", "warning"), seen("live", "error")],
      cspKey: "sha256-k",
    };
    show();
    editHead("<script>a()</script>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(
      await screen.findByText("This inline script is blocked")
    ).toBeTruthy();
    expect(screen.queryByText(/\(reported only\)/)).toBeNull();
    expect(screen.getByText("script-src · declared, live")).toBeTruthy();
  });
});
