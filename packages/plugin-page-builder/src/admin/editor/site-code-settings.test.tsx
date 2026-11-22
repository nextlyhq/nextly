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
import type { SiteCssRead, SiteCssSaved } from "../../site-css-contract";

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
/** What a save answers; undefined is a route that answered nothing at all. */
let saveAnswer: SiteCodeSaved | undefined;

/** The site's CSS as its read answers, each read in order, and its saves. */
let cssRead: SiteCssRead;
let cssReadError: Error | null = null;
const cssReads: SiteCssRead[] = [];
const cssWrites: Record<string, unknown>[] = [];
/** What a CSS save answers, or the refusal it throws. */
let cssSave: () => SiteCssSaved;

/** A refusal as the admin's transport raises it. */
function refusal(
  status: number,
  message: string,
  errors?: { path: string; code: string; message: string }[]
): Error {
  return Object.assign(new Error(message), {
    status,
    code: status === 409 ? "CONFLICT" : "VALIDATION_ERROR",
    ...(errors === undefined ? {} : { data: { errors } }),
  });
}

/** The canvas's read of the CSS it draws, and each time it was asked again. */
const drawnRefetch = vi.fn();

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: ({ path }: { path: string }) =>
    path === "/site/css/drawn"
      ? {
          data: { css: cssRead.css },
          pending: false,
          error: null,
          fetching: false,
          refetch: drawnRefetch,
        }
      : {
          data: codeRead,
          pending: false,
          error: readError,
          fetching: refreshing,
          refetch,
        },
  readPluginRoute: async ({ path }: { path: string }) => {
    expect(path).toBe("/site/css");
    if (cssReadError !== null) throw cssReadError;
    cssReads.push(cssRead);
    return cssRead;
  },
  isApiError: (reason: unknown) =>
    reason instanceof Error &&
    typeof (reason as { status?: unknown }).status === "number",
  validationIssues: (reason: unknown) =>
    (reason as { data?: { errors?: unknown[] } }).data?.errors ?? [],
  writePluginRoute: async ({
    path,
    body,
  }: {
    path: string;
    body: Record<string, unknown>;
  }) => {
    if (path === "/site/css") {
      cssWrites.push(body);
      return { message: "", item: cssSave() };
    }
    writes.push(body);
    if (held !== null) await held;
    const item = body.dryRun === true ? checkAnswer : saveAnswer;
    return item === undefined ? undefined : { message: "", item };
  },
}));

vi.mock("@nextlyhq/builder/shell", () => ({
  SITE_CODE_POLICY_DOCS_HREF:
    "https://nextlyhq.com/docs/page-builder/site-code#your-content-security-policy",
}));

const { SiteCodeSection } = await import("./site-code-settings");
const { useDrawnSiteCss } = await import("../site-css-read");

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
  cssRead = {
    css: "",
    sha256: "e".repeat(64),
    changedAt: null,
    changedBy: null,
  };
  cssReadError = null;
  cssReads.length = 0;
  cssWrites.length = 0;
  cssSave = () => ({ sha256: "f".repeat(64) });
  drawnRefetch.mockClear();
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
  it("says a site with none has nothing yet, and offers to add it", async () => {
    show();
    // The CSS, the head and the end of the body.
    await waitFor(() =>
      expect(screen.getAllByText("Nothing yet")).toHaveLength(3)
    );
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
    // Saved, the summary is read again and the section is closed. The tab
    // hears of the close from an effect, which React runs in a task of its
    // own after the summary is drawn, so it is waited for, not assumed.
    expect(refetch).toHaveBeenCalled();
    await waitFor(() => expect(told.open).toHaveBeenLastCalledWith(false));
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
    saveAnswer = undefined;
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

/** Open the code, and type `css` into the CSS box once it is read. */
async function editCss(css: string): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByRole("button", { name: /^(Add|Edit) code$/ }));
  const box = (await screen.findByRole("textbox", {
    name: "CSS",
  })) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: css } });
  return box;
}

/** The refusals listed under the CSS box, as written. */
function cssRefusals(): string[] {
  const box = screen.getByRole("textbox", { name: "CSS" });
  const list = document.getElementById(
    (box.getAttribute("aria-describedby") ?? "").split(" ").at(-1) ?? ""
  );
  return [...(list?.querySelectorAll("li") ?? [])].map(
    item => item.textContent ?? ""
  );
}

describe("the site's CSS in Settings → Code", () => {
  it("draws a CSS box above Head, with its line, for whoever may change the site's settings", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Add code" }));
    const box = await screen.findByRole("textbox", { name: "CSS" });
    const line = document.getElementById(
      (box.getAttribute("aria-describedby") ?? "").split(" ")[0] ?? ""
    );
    expect(line?.textContent).toBe(
      "CSS for every page of the site. Write plain CSS; no <style> tags needed."
    );
    // The CSS box comes first, as the page's Code tab has it, then the code.
    const boxes = screen.getAllByRole("textbox");
    expect(boxes.map(each => each.getAttribute("id"))).toEqual(
      ["CSS", "Head", "End of body"].map(name =>
        screen.getByRole("textbox", { name }).getAttribute("id")
      )
    );
  });

  it("shows the saved CSS in the summary in plain words, and opens it to edit", async () => {
    cssRead = { ...cssRead, css: "body {\n  margin: 0;\n}" };
    show();
    expect(await screen.findByText("3 lines of CSS")).toBeTruthy();
    // CSS alone is something saved: the way in edits rather than adds.
    fireEvent.click(screen.getByRole("button", { name: "Edit code" }));
    expect(
      (
        (await screen.findByRole("textbox", {
          name: "CSS",
        })) as HTMLTextAreaElement
      ).value
    ).toBe("body {\n  margin: 0;\n}");
  });

  it("saves an accepted sheet from the CSS it was read at, and says it applies to every published page at once", async () => {
    const told = show();
    await editCss("body { outline: 4px solid red; }");
    expect(told.editing).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(await screen.findByText("Site CSS saved")).toBeTruthy();
    expect(
      screen.getByText("It applies to every published page at once.")
    ).toBeTruthy();
    expect(cssWrites).toEqual([
      { css: "body { outline: 4px solid red; }", sha256: "e".repeat(64) },
    ]);
    // The code was not changed, so it was neither checked nor saved.
    expect(writes).toEqual([]);
    expect(screen.queryByText("Site code saved")).toBeNull();
    // Read again for the summary.
    await waitFor(() => expect(cssReads.length).toBeGreaterThan(1));
  });

  it("refuses an @import, naming its line, and saves nothing", async () => {
    show();
    const box = await editCss(
      "body { color: red; }\n@import url(https://example.com/x.css);"
    );
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() =>
      expect(cssRefusals()).toEqual(["Line 2: @import isn't allowed."])
    );
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Nothing was saved.")).toBeTruthy();
    expect(cssWrites).toEqual([]);
    expect(writes).toEqual([]);
    expect(box.value).toBe(
      "body { color: red; }\n@import url(https://example.com/x.css);"
    );
  });

  it("refuses a url() to another site, naming its line, and saves nothing", async () => {
    show();
    await editCss(
      'a { color: red; }\n\n.hero { background: url("https://cdn.example/a.png"); }'
    );
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() =>
      expect(cssRefusals()).toEqual([
        'Line 3: Only pictures and fonts from this site can be used: "https://cdn.example/a.png" isn\'t a path on this site.',
      ])
    );
    expect(cssWrites).toEqual([]);
  });

  it("refuses a pasted <style> tag with the hint to leave the tags out, rather than stripping them", async () => {
    show();
    const box = await editCss("<style>body{}</style>");
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() =>
      expect(cssRefusals()).toEqual(["Line 1: Leave out the <style> tags."])
    );
    // What the author pasted is what is still there.
    expect(box.value).toBe("<style>body{}</style>");
    expect(cssWrites).toEqual([]);
  });

  it("names each refused line, focuses the first, and saves neither the CSS nor the code beside it", async () => {
    show();
    await editCss('@import "/a.css";\np { behavior: url(/x.htc); }');
    fireEvent.change(screen.getByRole("textbox", { name: "Head" }), {
      target: { value: "<meta name=a content=b>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() =>
      expect(cssRefusals()).toEqual([
        "Line 1: @import isn't allowed.",
        "Line 2: behavior isn't allowed: it can run script.",
      ])
    );
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(
        "Line 1: @import isn't allowed."
      )
    );
    // The code was checked, as every save checks it, and nothing was saved.
    expect(writes.map(write => write.dryRun)).toEqual([true]);
    expect(cssWrites).toEqual([]);
  });

  it("saves the CSS before the code, so a CSS refusal saves neither", async () => {
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
    cssSave = () => {
      throw refusal(400, "Validation failed.", [
        {
          path: "css",
          code: "SITE_CSS_REFUSED",
          message: "Line 1: This CSS can't be read.",
        },
      ]);
    };
    show();
    await editCss("a { color: red; }");
    fireEvent.change(screen.getByRole("textbox", { name: "Head" }), {
      target: { value: "<meta name=a content=b>" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    // The server's own refusal, listed under the box as the browser's is.
    await waitFor(() =>
      expect(cssRefusals()).toEqual(["Line 1: This CSS can't be read."])
    );
    expect(writes.map(write => write.dryRun === true)).toEqual([true]);
  });

  it("keeps the draft when someone else saved the CSS first, says so plainly, and saves over theirs only when asked again", async () => {
    cssSave = () => {
      throw refusal(409, "Someone changed the site CSS; reload to see it");
    };
    show();
    const box = await editCss("main { gap: 1rem; }");
    // Theirs, as the read answers once they have saved.
    cssRead = {
      ...cssRead,
      css: "main { gap: 2rem; }",
      sha256: "a".repeat(64),
    };
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(
      await screen.findByText(
        "Someone else saved the site CSS while you were editing, so nothing was saved. Your CSS is still here: save again to replace theirs, or cancel to see what they saved."
      )
    ).toBeTruthy();
    expect(box.value).toBe("main { gap: 1rem; }");
    expect(screen.queryByText("Site CSS saved")).toBeNull();
    cssSave = () => ({ sha256: "b".repeat(64) });
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    expect(await screen.findByText("Site CSS saved")).toBeTruthy();
    // The second save is made from their CSS, read again after the refusal.
    expect(cssWrites.map(write => write.sha256)).toEqual([
      "e".repeat(64),
      "a".repeat(64),
    ]);
  });

  it("has the canvas read the CSS it draws again once a save stores it, and not before", async () => {
    /** The canvas, as it reads the site's CSS to draw. */
    function Canvas(): null {
      useDrawnSiteCss();
      return null;
    }
    render(<Canvas />);
    show();
    await editCss("body { outline: 4px solid red; }");
    // Refused CSS is not stored, so the canvas has nothing new to draw.
    fireEvent.change(screen.getByRole("textbox", { name: "CSS" }), {
      target: { value: '@import "/a.css";' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await waitFor(() => expect(cssRefusals()).toHaveLength(1));
    expect(drawnRefetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "CSS" }), {
      target: { value: "body { outline: 4px solid red; }" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save code" }));
    await screen.findByText("Site CSS saved");
    expect(drawnRefetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the code editable when the CSS can't be read, and offers Retry", async () => {
    cssReadError = new Error("offline");
    show();
    expect(
      await screen.findByText("The site's CSS could not be loaded.")
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add code" }));
    expect(screen.getByRole("textbox", { name: "Head" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "CSS" })).toBeNull();
    cssReadError = null;
    fireEvent.click(screen.getAllByRole("button", { name: "Retry" })[0]!);
    expect(await screen.findByRole("textbox", { name: "CSS" })).toBeTruthy();
  });
});
