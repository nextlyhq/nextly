/**
 * The control headers a handler uses to talk to the response boundary, and the
 * fact that none of them reaches a client.
 *
 * They are internal by construction — neither is on any published surface — so
 * a leak is not a cosmetic one: it tells a reader about a mechanism they cannot
 * use and cannot rely on.
 */
import { describe, expect, it } from "vitest";

import { SKIP_DATE_FORMATTING_HEADER } from "../response-shapes";
import { SKIP_TIMEZONE_FORMAT_HEADER } from "../../shared/lib/date-formatting";
import { _applyGlobalDateFormattingForTest as atBoundary } from "../../routeHandler";

const iso = { items: [{ props: { heading: "2026-09-08T12:34Z" } }] };

describe("internal markers never reach a client", () => {
  it("strips the timezone marker from a NON-JSON body", async () => {
    // The reachable case: an export or a sitemap route answers with CSV or XML.
    // The content-type check used to return before either marker came off, and
    // `withTimezoneFormatting` — the only other place one is removed — is
    // downstream of it, so the header travelled all the way out.
    const csv = new Response("a,b\n1,2\n", {
      headers: {
        "content-type": "text/csv",
        [SKIP_TIMEZONE_FORMAT_HEADER]: "1",
      },
    });

    const out = await atBoundary(csv);

    expect(out.headers.get(SKIP_TIMEZONE_FORMAT_HEADER)).toBeNull();
    expect(await out.text()).toBe("a,b\n1,2\n");
  });

  it("strips the date marker from a NON-JSON body too", async () => {
    const xml = new Response("<a/>", {
      headers: {
        "content-type": "application/xml",
        [SKIP_DATE_FORMATTING_HEADER]: "1",
      },
    });

    const out = await atBoundary(xml);

    expect(out.headers.get(SKIP_DATE_FORMATTING_HEADER)).toBeNull();
  });

  it("still HONOURS the marker it removed", async () => {
    // The trap this pairs with: removing the marker before reading it turns
    // every opt-out silently back on, and the body is then rewritten by the
    // formatter the marker exists to avoid. Asserted on the body, not on the
    // header, because the header is gone either way.
    const json = new Response(JSON.stringify(iso), {
      headers: {
        "content-type": "application/json",
        [SKIP_TIMEZONE_FORMAT_HEADER]: "1",
      },
    });

    const out = await atBoundary(json);

    expect(out.headers.get(SKIP_TIMEZONE_FORMAT_HEADER)).toBeNull();
    expect(await out.json()).toEqual(iso);
  });

  it("REWRITES an unmarked JSON body, which is what makes the above mean something", async () => {
    // The positive control. Without it every assertion here is satisfied by a
    // boundary that formats nothing at all.
    const json = new Response(JSON.stringify(iso), {
      headers: { "content-type": "application/json" },
    });

    const out = await atBoundary(json);

    expect(await out.json()).not.toEqual(iso);
  });
});
