// @vitest-environment jsdom
/**
 * Page settings' Code tab: code for this page only, checked and explained as
 * Site code is. Each check outcome: what can't be stored is named and
 * nothing is kept; what the site's policy blocks is kept only once the
 * person says they understand, with the declared policy's key; a check with
 * something to see is shown first; a clean one is kept at once. Kept means
 * one edit of the page, saved with it.
 *
 * And its CSS box, above them: checked by the one custom CSS checker, each
 * refused line named and nothing kept; accepted CSS kept as one edit.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteCodeChecked } from "../../library-contract";

/** Each dry run's body, in order. */
const writes: Record<string, unknown>[] = [];
/** What a dry run answers: with the live policy, and without it. */
let withLive: SiteCodeChecked;
let declaredOnly: SiteCodeChecked;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: async ({ body }: { body: Record<string, unknown> }) => {
    writes.push(body);
    const item = body.livePolicy === undefined ? declaredOnly : withLive;
    return { message: "", item };
  },
}));
vi.mock("@nextlyhq/builder/shell", () => ({
  SITE_CODE_POLICY_DOCS_HREF:
    "https://nextlyhq.com/docs/page-builder/site-code#your-content-security-policy",
}));

const { PageCodeTab } = await import("./settings-code");

const judged = (refusals: string[] = []) => ({
  refusals,
  notes: [],
  elements: 1,
});

/** A check against a declared policy that blocks nothing. */
const clean: SiteCodeChecked = {
  head: judged(),
  body: judged(),
  csp: [
    {
      source: "declared",
      check: { checked: true, findings: [] },
      additions: [],
      policies: 1,
    },
  ],
  cspKey: null,
};

/** A check whose declared and live policies both block the code. */
function blocked(key: string, live: boolean): SiteCodeChecked {
  const finding = {
    slot: "head" as const,
    index: 0,
    directive: "script-src",
    message: "inline scripts are blocked",
    level: "error" as const,
  };
  const policy = (source: "declared" | "live") => ({
    source,
    check: { checked: true as const, findings: [finding] },
    additions: [],
    policies: 1,
  });
  return {
    head: judged(),
    body: judged(),
    csp: live ? [policy("declared"), policy("live")] : [policy("declared")],
    cspKey: key,
  };
}

const set = vi.fn((_next: unknown) => true);
const setCss = vi.fn((_next: string | null) => true);

beforeEach(() => {
  writes.length = 0;
  set.mockClear();
  setCss.mockClear();
  withLive = clean;
  declaredOnly = clean;
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("", {
        headers: { "content-security-policy": "script-src 'self'" },
      })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(value?: { head?: string; body?: string }, css?: string) {
  render(
    <PageCodeTab
      value={value}
      set={set}
      css={{ value: css, set: setCss }}
      writable
    />
  );
}

const head = () => screen.getByRole("textbox", { name: "Head" });
const keep = () => screen.getByRole("button", { name: "Check and keep" });

describe("the Code tab", () => {
  it("says what it is for, with a Head and an End of body box holding the page's code", () => {
    show({ head: "<meta name=a content=b>" });
    expect(
      screen.getByText(
        "Code added to this page only. Site-wide code lives in Site settings."
      )
    ).toBeTruthy();
    expect((head() as HTMLTextAreaElement).value).toBe(
      "<meta name=a content=b>"
    );
    expect(screen.getByRole("textbox", { name: "End of body" })).toBeTruthy();
    // Nothing to keep until it changes.
    expect((keep() as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps clean code at once, as one edit of the page, checked with the live policy first", async () => {
    show();
    fireEvent.change(head(), { target: { value: "<script>a()</script>" } });
    fireEvent.click(keep());
    await screen.findByText("Kept with the page. Save or Publish to store it.");
    expect(writes[0]).toMatchObject({
      head: "<script>a()</script>",
      dryRun: true,
      livePolicy: { policy: "script-src 'self'" },
    });
    expect(set).toHaveBeenCalledWith({
      head: "<script>a()</script>",
      body: "",
    });
  });

  it("names what can't be stored and keeps nothing", async () => {
    withLive = { ...clean, head: judged(["<div> can't be stored here."]) };
    show();
    fireEvent.change(head(), { target: { value: "<div>x</div>" } });
    fireEvent.click(keep());
    await screen.findByText("<div> can't be stored here.");
    expect(screen.getByText("Nothing was kept.")).toBeTruthy();
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps what the policy blocks only once the person understands, with the declared policy's key", async () => {
    withLive = blocked("key-with-live", true);
    declaredOnly = blocked("key-declared", false);
    show();
    fireEvent.change(head(), { target: { value: "<script>a()</script>" } });
    fireEvent.click(keep());
    await screen.findByText(
      "The site's security policy would block some of this code"
    );
    const anyway = screen.getByRole("button", { name: "Keep anyway" });
    expect((anyway as HTMLButtonElement).disabled).toBe(true);
    expect(set).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand this code won't run on pages until the policy allows it.",
      })
    );
    fireEvent.click(anyway);
    await screen.findByText("Kept with the page. Save or Publish to store it.");
    // The key the server judges by: the declared policy's, asked without
    // the live one.
    expect(writes.at(-1)).not.toHaveProperty("livePolicy");
    expect(set).toHaveBeenCalledWith({
      head: "<script>a()</script>",
      body: "",
      acknowledgedCsp: "key-declared",
    });
  });

  it("removes the page's code when both boxes are emptied", async () => {
    show({ head: "<script>a()</script>" });
    fireEvent.change(head(), { target: { value: "" } });
    fireEvent.click(keep());
    await screen.findByText("Kept with the page. Save or Publish to store it.");
    expect(set).toHaveBeenCalledWith(null);
  });
});

describe("the Code tab's CSS box", () => {
  const cssBox = () => screen.getByRole("textbox", { name: "CSS" });
  const keepCss = () =>
    screen.getByRole("button", { name: "Check and keep CSS" });
  const typed = (css: string) => {
    fireEvent.change(cssBox(), { target: { value: css } });
    fireEvent.click(keepCss());
  };

  it("sits above Head and End of body, says what it is for, and holds the page's CSS", () => {
    show(undefined, "h1 { color: teal; }");
    expect(
      screen.getByText(
        "CSS for this page only. Site-wide CSS lives in Site settings."
      )
    ).toBeTruthy();
    expect((cssBox() as HTMLTextAreaElement).value).toBe("h1 { color: teal; }");
    const boxes = screen.getAllByRole("textbox");
    expect(boxes.indexOf(cssBox())).toBeLessThan(boxes.indexOf(head()));
    // Nothing to keep until it changes.
    expect((keepCss() as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps accepted CSS as one edit of the page", async () => {
    show();
    typed("h1 { color: rebeccapurple; }");
    expect(setCss).toHaveBeenCalledWith("h1 { color: rebeccapurple; }");
    expect(
      await screen.findByText(
        "Kept with the page. Save or Publish to store it."
      )
    ).toBeTruthy();
    // The page code's boxes are left alone.
    expect(set).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an @import",
      "@import url(https://example.com/x.css);",
      ["Line 1: @import isn't allowed."],
    ],
    [
      "a url() to another site",
      "body {\n  background: url(https://example.com/a.png);\n}",
      [
        'Line 2: Only pictures and fonts from this site can be used: "https://example.com/a.png" isn\'t a path on this site.',
      ],
    ],
    [
      "a pasted <style> tag",
      "<style>p { color: red; }</style>",
      ["Line 1: Paste the CSS without the <style> tags."],
    ],
    [
      "two refused lines",
      "p { color: red; }\n@import url(/a.css);\np { behavior: url(/x.htc); }",
      [
        "Line 2: @import isn't allowed.",
        "Line 3: behavior isn't allowed: it can run script.",
      ],
    ],
  ])(
    "names each line it refuses in %s, and keeps nothing",
    (_case, css, lines) => {
      show();
      typed(css);
      for (const line of lines) expect(screen.getByText(line)).toBeTruthy();
      expect(screen.getAllByText("Nothing was kept.")).toHaveLength(1);
      expect(setCss).not.toHaveBeenCalled();
    }
  );

  it("removes the page's CSS when the box is emptied", () => {
    show(undefined, "h1 { color: teal; }");
    typed("");
    expect(setCss).toHaveBeenCalledWith(null);
  });
});
