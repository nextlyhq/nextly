/**
 * What the banner says, and when it says nothing.
 *
 * The property that matters is not that a bar appears — it is that the bar
 * answers the question an editable scheduled document raises. Sanity locks
 * those documents, so it never has to; Nextly leaves them editable, so a banner
 * that named the release without saying whether edits are included would be
 * strictly worse than the lock, and it would look completely finished.
 *
 * @module components/features/releases/__tests__/ScheduledReleaseBanner.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { Release } from "@admin/types/releases";

import { ScheduledReleaseBanner } from "../ScheduledReleaseBanner";

const { canFor, containing } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
  containing: vi.fn(),
}));

vi.mock("@admin/hooks/useCan", () => ({ useCan: (s: string) => canFor(s) }));
vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleasesContaining: (
    document: unknown,
    enabled: boolean
  ): { data: { items: Release[] } | undefined; isError: boolean } =>
    containing(document, enabled),
}));

const DOC = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function release(over: Partial<Release> = {}): Release {
  return {
    id: "r1",
    title: "Spring launch",
    description: null,
    scheduledAt: "2026-09-01T07:00:00.000Z",
    timezone: "Europe/Berlin",
    state: "scheduled",
    publishedAt: null,
    createdBy: "u1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    memberAction: "publish",
    ...over,
  };
}

const showing = (items: Release[]) =>
  containing.mockReturnValue({ data: { items }, isError: false });

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
  containing.mockReset();
  containing.mockReturnValue({ data: undefined, isError: false });
});

describe("when the document is in a scheduled release", () => {
  it("answers whether edits saved now are included", () => {
    // The whole reason the banner exists, and the one sentence a reader cannot
    // get anywhere else. It is true because a member points at its document and
    // materialisation promotes the working draft — a property of the engine,
    // not a claim this component is free to make.
    showing([release()]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).toMatch(
      /changes you save now are included/i
    );
  });

  it("names the consequence, the moment and its zone", () => {
    showing([release()]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/goes live/i);
    // The AUTHOR's zone, named. "9am Berlin" survives a daylight-saving
    // boundary where a converted local time does not.
    expect(text).toContain("Europe/Berlin");
    expect(text).toContain("9:00");
  });

  it("says a document COMES DOWN rather than assuming a publish", () => {
    // The control on the case above: a banner that always said "goes live"
    // passes it, and would state the exact opposite of the truth here.
    showing([release({ memberAction: "unpublish" })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/comes down/i);
    expect(text).not.toMatch(/goes live/i);
  });

  it("does not guess at an action it does not recognise", () => {
    // An engine that gained a third action must not be rendered as a publish.
    showing([release({ memberAction: undefined })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/this document changes/i);
    expect(text).not.toMatch(/goes live|comes down/i);
  });

  it("lists several releases in the order they will happen", () => {
    // The ordinary case, not an edge one: "publish on the 1st, take down on the
    // 20th". Summarising to one would hide the second change entirely.
    showing([
      release({ id: "a", title: "Launch", memberAction: "publish" }),
      release({
        id: "b",
        title: "Takedown",
        memberAction: "unpublish",
        scheduledAt: "2026-09-20T07:00:00.000Z",
      }),
    ]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("Launch");
    expect(text).toContain("Takedown");
    expect(text.indexOf("Launch")).toBeLessThan(text.indexOf("Takedown"));
  });

  it("links each release to its own page", () => {
    showing([release()]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(
      screen.getByRole("link", { name: "Spring launch" }).getAttribute("href")
    ).toBe("/admin/releases/r1");
  });
});

describe("the promise about saved edits matches what will happen", () => {
  it("does not claim a publish when the document is being TAKEN DOWN", () => {
    // The sentence is stated once for the whole banner, so it has to be true of
    // every row. "The release publishes this document" above a row reading
    // "comes down" is the opposite lifecycle effect, and an editor reading it
    // believes their work is about to go live when it is about to be withdrawn.
    showing([release({ memberAction: "unpublish" })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/taken down rather than published/i);
    expect(text).not.toMatch(/changes you save now are included/i);
  });

  it("still promises inclusion when a release does publish it", () => {
    // The control: without it the case above is satisfied by a banner that
    // never makes the promise at all, which would remove the point of it.
    showing([release({ memberAction: "publish" })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).toMatch(
      /changes you save now are included/i
    );
  });

  it("qualifies the promise when both a publish and a takedown are listed", () => {
    showing([
      release({ id: "a", memberAction: "publish" }),
      release({ id: "b", memberAction: "unpublish" }),
    ]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).toMatch(
      /whichever of these publishes it/i
    );
  });

  it("does not promise a TRANSLATION will ship", () => {
    // A member is whole-document and materialisation performs the locale-less
    // write, so a draft translation saved here need not become public with the
    // release. Repeating the promise on that screen tells a translator their
    // work ships when it may not.
    showing([release()]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale={false} />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/editing a translation/i);
    expect(text).not.toMatch(/changes you save now are included/i);
  });
});

describe("when the lookup FAILED", () => {
  it("says so rather than looking like nothing is scheduled", () => {
    // The dangerous collapse: `data` is undefined on an error exactly as it is
    // before the first response, so `?? []` turns a failure into "nothing
    // scheduled" and the safety signal disappears at the moment the admin
    // cannot confirm there is nothing to signal.
    containing.mockReturnValue({ data: undefined, isError: true });
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).toMatch(
      /could not be checked/i
    );
  });
});

describe("when it should say nothing at all", () => {
  it("renders no chrome for a document in no release", () => {
    // The common case by far. A bar reading "not in any release" on every
    // document would be noise on precisely the screens where it matters least.
    showing([]);
    const { container } = render(
      <ScheduledReleaseBanner document={DOC} onDefaultLocale />
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing while the answer has not arrived", () => {
    // Absence and "not yet known" are different, and a banner that flashed in
    // after the page settled would read as the document changing under the
    // editor.
    containing.mockReturnValue({ data: undefined, isError: false });
    const { container } = render(
      <ScheduledReleaseBanner document={DOC} onDefaultLocale />
    );
    expect(container.textContent).toBe("");
  });

  it("does not ask at all when the reader may not read releases", () => {
    // `/api/releases` is gated, so an unentitled reader would otherwise produce
    // a 403 under every document they open.
    canFor.mockImplementation(slug => slug !== "read-content-releases");
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(containing).toHaveBeenCalledWith(DOC, false);
  });

  it("asks when the reader may", () => {
    // The control: without it the case above passes against a component that
    // never enables the query at all.
    showing([]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(containing).toHaveBeenCalledWith(DOC, true);
  });
});
