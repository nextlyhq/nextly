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
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { Release } from "@admin/types/releases";

import { ScheduledReleaseBanner } from "../ScheduledReleaseBanner";

const { canFor, containing, removeMember } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
  containing: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock("@admin/hooks/useCan", () => ({ useCan: (s: string) => canFor(s) }));
vi.mock("@admin/hooks/queries/useReleases", async importOriginal => ({
  ...(await importOriginal<object>()),
  useReleasesContaining: (
    document: unknown,
    enabled: boolean
  ): { data: { items: Release[] } | undefined; isError: boolean } =>
    containing(document, enabled),
  // Observed where the document is taken out: which release, and which of its
  // documents.
  useRemoveReleaseMember: (releaseId: string) => ({
    mutate: (memberId: string) => removeMember(releaseId, memberId),
    reset: vi.fn(),
    isError: false,
    isPending: false,
    error: null,
  }),
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
  removeMember.mockReset();
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

describe("a release that STOPPED", () => {
  it("is still reported, rather than vanishing from the banner", () => {
    // The gap the banner and the blocked state create together. The document is
    // still in that release and still going nowhere — and a banner that simply
    // disappears reads as RESOLVED: the editor concludes the release already
    // ran or was called off, when the launch has actually failed.
    showing([release({ state: "blocked" })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/has stopped/i);
    expect(text).toMatch(/will not run until somebody fixes it/i);
  });

  it("does not describe it as something that is going to happen", () => {
    // The control on the case above: rendering a blocked release through the
    // scheduled wording would say "This document goes live …", which is the
    // opposite of true and worse than the silence it replaced.
    showing([release({ state: "blocked" })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).not.toMatch(/goes live/i);
  });

  it("does not promise that saved edits are included", () => {
    // Nothing is going to ship them. A stopped release voting on that sentence
    // is how a banner ends up reassuring an editor about a launch that failed.
    showing([release({ state: "blocked" })]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toMatch(/changes you save now are included/i);
    expect(text).toMatch(/nothing is scheduled to happen/i);
  });

  it("badges the STOPPED one even when a scheduled release is also listed", () => {
    // The worst state present is the one that needs somebody. Burying it behind
    // a count of scheduled releases is how it gets missed.
    showing([
      release({ id: "a", state: "scheduled" }),
      release({ id: "b", state: "blocked" }),
    ]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).toMatch(/stopped/i);
  });

  it("still promises inclusion for the scheduled one beside it", () => {
    // The control: a blocked row must not silence a genuine promise about a
    // release that IS still going to publish this document.
    showing([
      release({ id: "a", state: "scheduled", memberAction: "publish" }),
      release({ id: "b", state: "blocked" }),
    ]);
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);
    expect(screen.getByRole("status").textContent).toMatch(
      /changes you save now are included/i
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

/** Every capability off: each case grants the ones it is about. */
const NOTHING: NonNullable<Release["can"]> = {
  schedule: false,
  cancel: false,
  addMember: false,
  removeMember: false,
  publishNow: false,
  update: false,
  delete: false,
};

describe("what the reader can do from the document", () => {
  /** A release this document is in, with its place in it and what the reader may do. */
  const holding = (over: Partial<Release> = {}): Release =>
    release({ memberId: "m1", kind: "release", ...over });

  const banner = () =>
    render(<ScheduledReleaseBanner document={DOC} onDefaultLocale />);

  it("offers Change time on a single-document release the reader may reschedule, and not on an ordinary one", () => {
    // A single is the document's own schedule, so its time is changed from the
    // document; an ordinary release's time belongs to every document in it.
    showing([
      holding({
        id: "single",
        title: "Hello",
        kind: "single",
        can: { ...NOTHING, schedule: true },
      }),
      holding({
        id: "ordinary",
        title: "Autumn",
        scheduledAt: "2026-09-02T07:00:00.000Z",
        can: { ...NOTHING, schedule: true },
      }),
    ]);
    banner();
    const changes = screen.getAllByRole("button", { name: /change time/i });
    expect(changes).toHaveLength(1);
    expect(changes[0].closest("li")?.textContent).toContain("on its own");
  });

  it("offers no Change time where the reader may not reschedule the single", () => {
    showing([
      holding({ kind: "single", can: { ...NOTHING, schedule: false } }),
    ]);
    banner();
    expect(screen.queryByRole("button", { name: /change time/i })).toBeNull();
  });

  it("takes the document out of the release it names, by its place in that release", async () => {
    showing([holding({ can: { ...NOTHING, removeMember: true } })]);
    banner();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove from Spring launch…" })
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain(
      "Remove this document from this release?"
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove" })
    );
    expect(removeMember).toHaveBeenCalledWith("r1", "m1");
  });

  it("says that taking the document out of its single-document release cancels the release", async () => {
    showing([
      holding({
        kind: "single",
        can: { ...NOTHING, removeMember: true, cancel: true },
      }),
    ]);
    banner();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove from Spring launch…" })
    );
    expect(screen.getByRole("alertdialog").textContent).toContain(
      "Remove this document and cancel this release?"
    );
  });

  it("offers no Remove where the reader may not change the release's documents", () => {
    showing([holding({ can: { ...NOTHING, removeMember: false } })]);
    banner();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("names which of two releases at one moment readers get: the one scheduled last", () => {
    // In the server's own order, which is the engine's: the later of two at
    // one instant is the one whose version stands.
    showing([
      holding({ id: "a", title: "Autumn" }),
      holding({ id: "b", title: "Docs refresh", memberId: "m2" }),
    ]);
    banner();
    expect(screen.getByRole("status").textContent).toMatch(
      /Docs refresh was scheduled last, so its version is the one readers get/
    );
  });

  it("says nothing about a winner when the releases act at different moments", () => {
    showing([
      holding({ id: "a", title: "Autumn" }),
      holding({
        id: "b",
        title: "Docs refresh",
        memberId: "m2",
        scheduledAt: "2026-09-02T07:00:00.000Z",
      }),
    ]);
    banner();
    expect(screen.getByRole("status").textContent).not.toMatch(
      /scheduled last/
    );
  });

  it("reads the time on the reader's clock, with the zone it was scheduled in beside it", () => {
    // A zone no reader's clock shares, so the scheduled reading is always shown.
    showing([holding({ timezone: "Pacific/Kiritimati" })]);
    banner();
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("your time");
    expect(text).toMatch(/Pacific\/Kiritimati \(as scheduled\)/);
  });
});
