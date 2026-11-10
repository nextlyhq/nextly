/**
 * Scheduling one document from its editor: the time and zone chosen, the
 * moment read back in words, a time that cannot be scheduled refused before
 * anything is sent, and ONE request that makes the release, holds the
 * document and schedules it together.
 *
 * The request goes through the real hook and API client to a stubbed
 * `fetch`, so what is asserted is what the server would receive.
 *
 * @module components/features/releases/__tests__/ScheduleDocumentDialog.test
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@admin/__tests__/utils";

import { SCHEDULE_OUTCOME_ATTRIBUTE } from "../dialog-opener";
import { instantFor, readerZone, wallTimeIn } from "../release-timezone";
import { defaultScheduleWall } from "../schedule-publish";
import { ScheduleDocumentDialog } from "../ScheduleDocumentDialog";

const NOW = new Date("2026-10-30T12:00:00Z");
const DOCUMENT = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

const fetchMock = vi.fn();

const { grants } = vi.hoisted(() => ({
  grants: { missing: [] as string[] },
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => !grants.missing.includes(slug),
}));

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SCHEDULED = {
  message: "Document scheduled.",
  item: {
    release: {
      id: "r1",
      title: "Spring launch",
      scheduledAt: "2026-10-31T09:00:00.000Z",
      timezone: "UTC",
    },
    members: [],
  },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(answer(201, SCHEDULED));
  grants.missing = [];
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(
  over: {
    onOpenChange?: (open: boolean) => void;
    opener?: HTMLElement | null;
  } = {}
) {
  const onOpenChange = over.onOpenChange ?? vi.fn();
  render(
    <ScheduleDocumentDialog
      open
      onOpenChange={onOpenChange}
      document={DOCUMENT}
      documentTitle="Spring launch"
      savesGoLive={false}
      opener={over.opener ?? null}
    />
  );
  return { onOpenChange };
}

const dateField = () =>
  screen.getByLabelText("Date and time") as HTMLInputElement;
/** The confirm button on its own, which names the moment it schedules for. */
const submit = () =>
  screen.getByRole("button", {
    name: /^Schedule( for .+)?$/,
  }) as HTMLButtonElement;
const setWall = (value: string) =>
  fireEvent.change(dateField(), { target: { value } });

/** The bodies of every request sent, by path. */
function requests(): { path: string; method: string; body: unknown }[] {
  return fetchMock.mock.calls.map(call => {
    const [url, init] = call as [string, RequestInit | undefined];
    return {
      path: new URL(String(url), "http://x").pathname,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
  });
}

async function chooseZone(search: string, name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name: /time zone/i }));
  await userEvent.type(
    await screen.findByPlaceholderText("Search time zones"),
    search
  );
  await userEvent.click(await screen.findByRole("option", { name }));
}

describe("what the dialog opens on", () => {
  it("tomorrow at nine, in the reader's own zone, read back in words", () => {
    open();
    expect(dateField().value).toBe(
      defaultScheduleWall(NOW.getTime(), readerZone())
    );
    expect(
      screen.getByRole("button", { name: /time zone/i }).textContent
    ).toContain(readerZone().replace(/_/g, " "));
    expect(screen.getByTestId("schedule-readback").textContent).toMatch(
      /^Goes live .+ · in \d+ (hours|day)$/
    );
    expect(submit().disabled).toBe(false);
  });

  it("names the release after the document", () => {
    open();
    expect(
      screen.getByRole("heading", { name: "Schedule “Spring launch”" })
    ).toBeTruthy();
  });

  it("puts focus in the date and time", () => {
    open();
    expect(document.activeElement).toBe(dateField());
  });
});

describe("the request", () => {
  it("is one all-or-nothing step: the release, the document and the time together", async () => {
    const { onOpenChange } = open();
    const zone = readerZone();
    setWall("2026-11-02T09:00");
    await userEvent.click(submit());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    // ONE request, to the step that does it all. A create, then an add, then
    // a schedule could leave an empty release behind when the second fails.
    expect(requests()).toEqual([
      {
        path: expect.stringMatching(/\/releases\/schedule-document$/),
        method: "POST",
        body: {
          into: "own",
          document: { ...DOCUMENT, action: "publish" },
          title: "Spring launch",
          at: instantFor("2026-11-02T09:00", zone),
          timezone: zone,
        },
      },
    ]);
  });

  it("reads the time in the zone chosen, and sends that zone", async () => {
    open();
    await chooseZone("Tokyo", /Asia\/Tokyo/);
    setWall("2026-11-02T09:00");
    await userEvent.click(submit());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(requests()[0]?.body).toMatchObject({
      at: "2026-11-02T00:00:00.000Z",
      timezone: "Asia/Tokyo",
    });
  });

  it("says, when the server refuses, why, and that nothing changed", async () => {
    fetchMock.mockResolvedValue(
      answer(409, {
        error: {
          code: "CONFLICT",
          message:
            "This document cannot be scheduled until the problems blocking it are fixed. Nothing was scheduled.",
        },
      })
    );
    const { onOpenChange } = open();
    await userEvent.click(submit());

    expect((await screen.findByRole("alert")).textContent).toBe(
      "This document cannot be scheduled until the problems blocking it are fixed. Nothing was scheduled."
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("says, when no answer came back, where to look before trying again", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    open();
    await userEvent.click(submit());

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /may have been scheduled\. Check the releases listed on this document/
    );
  });

  it("says, to a person who cannot see releases, who can check", async () => {
    // They may schedule, but the Publishing section and the banner both read
    // releases, so neither is drawn for them: pointing there sends them
    // nowhere, and a retry may schedule the document twice.
    grants.missing = ["read-content-releases"];
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    open();
    await userEvent.click(submit());

    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toMatch(/may have been scheduled/);
    expect(alert).not.toMatch(/Publishing section/);
    expect(alert).toMatch(/someone who can see releases/);
  });
});

describe("while the request is on its way", () => {
  it("stays open, so the document cannot be sent twice", async () => {
    // A request that has not answered yet.
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const { onOpenChange } = open();
    await userEvent.click(submit());
    await screen.findByRole("button", { name: "Scheduling…" });

    await userEvent.keyboard("{Escape}");
    const cancel = screen.getByRole("button", {
      name: "Cancel",
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    fireEvent.click(cancel);

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(requests()).toHaveLength(1);
  });
});

describe("a time that cannot be scheduled", () => {
  it("is refused when it has passed, and nothing is sent", async () => {
    open();
    setWall("2026-10-29T09:00");

    expect(screen.getByRole("status").textContent).toBe(
      "That time has already passed. Pick a later one, or use Publish to publish now."
    );
    expect(dateField().getAttribute("aria-invalid")).toBe("true");
    expect(submit().disabled).toBe(true);
    fireEvent.submit(submit().closest("form") as HTMLFormElement);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("schedule-readback")).toBeNull();
  });

  it("is refused where the zone skips it, on a clocks-forward night", async () => {
    open();
    await chooseZone("Berlin", /Europe\/Berlin/);
    setWall("2027-03-28T02:30");

    expect(screen.getByRole("status").textContent).toBe(
      "That time doesn't exist in Europe/Berlin on that date: the clocks go forward past it. Pick a time before or after."
    );
    expect(submit().disabled).toBe(true);
  });

  it("is said, not silently ignored, when it passes between the clock's ticks", async () => {
    // A minute ahead when chosen; two minutes on, with the dialog's own
    // clock not yet moved, it has passed.
    open();
    setWall(wallTimeIn(new Date(NOW.getTime() + 60_000), readerZone()));
    expect(submit().disabled).toBe(false);
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));

    fireEvent.submit(submit().closest("form") as HTMLFormElement);

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "That time has already passed. Pick a later one, or use Publish to publish now."
      )
    );
    expect(submit().disabled).toBe(true);
  });

  it("is asked for when the field is emptied", () => {
    open();
    setWall("");
    expect(screen.getByRole("status").textContent).toBe(
      "Choose a date and time."
    );
    expect(submit().disabled).toBe(true);
  });
});

describe("live regions", () => {
  it("has the problem region in place, and silent, before there is a problem", () => {
    open();
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    // Linked to the field it is about.
    expect(dateField().getAttribute("aria-describedby")).toBe(region.id);
    setWall("2026-10-29T09:00");
    // The same node speaks, rather than a new one appearing with its text.
    expect(screen.getByRole("status")).toBe(region);
    expect(region.textContent).not.toBe("");
  });
});

describe("focus on close", () => {
  it("goes back to the control that opened it", async () => {
    const opener = document.createElement("button");
    opener.textContent = "More ways to publish";
    document.body.append(opener);
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ScheduleDocumentDialog
        open
        onOpenChange={onOpenChange}
        document={DOCUMENT}
        documentTitle="Spring launch"
        savesGoLive={false}
        opener={opener}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <ScheduleDocumentDialog
        open={false}
        onOpenChange={onOpenChange}
        document={DOCUMENT}
        documentTitle="Spring launch"
        savesGoLive={false}
        opener={opener}
      />
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  /** An opener inside the section that shows a schedule's outcome. */
  function openerInOutcome() {
    const section = document.createElement("section");
    section.tabIndex = -1;
    section.setAttribute(SCHEDULE_OUTCOME_ATTRIBUTE, "");
    const opener = document.createElement("button");
    opener.textContent = "Schedule publish…";
    section.append(opener);
    document.body.append(section);
    return { section, opener };
  }

  /** Sends, waits for the failure, then closes the dialog with Cancel. */
  async function failThenClose(
    opener: HTMLElement,
    whileOpen: () => void = () => undefined
  ) {
    const onOpenChange = vi.fn();
    const dialog = (open: boolean) => (
      <ScheduleDocumentDialog
        open={open}
        onOpenChange={onOpenChange}
        document={DOCUMENT}
        documentTitle="Spring launch"
        savesGoLive={false}
        opener={opener}
      />
    );
    const { rerender } = render(dialog(true));
    await userEvent.click(submit());
    await screen.findByRole("alert");
    whileOpen();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(dialog(false));
  }

  it("goes where the outcome shows when no answer came back, as the opener may have gone", async () => {
    // The request may have landed: the releases are read again, and the
    // section's offer goes with "Not scheduled." while the dialog still
    // says what happened.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { section, opener } = openerInOutcome();
    await failThenClose(opener, () => opener.remove());

    await waitFor(() => expect(document.activeElement).toBe(section));
    section.remove();
  });

  it("goes back to the opener after a refusal, which changed nothing", async () => {
    // The control: a refusal leaves the offer where it was, so focus goes
    // back to it for another try, not to the section around it.
    fetchMock.mockResolvedValue(
      answer(409, { error: { code: "CONFLICT", message: "Refused." } })
    );
    const { section, opener } = openerInOutcome();
    await failThenClose(opener);

    await waitFor(() => expect(document.activeElement).toBe(opener));
    section.remove();
  });
});

describe("whether it goes live or comes down", () => {
  const goesLive = () => screen.getByRole("radio", { name: "Goes live" });
  const comesDown = () => screen.getByRole("radio", { name: "Comes down" });

  it("goes live unless the reader chooses otherwise", () => {
    open();
    expect(goesLive()).toBeChecked();
  });

  it("sends Comes down as taking the document down at that moment, and reads it back so", async () => {
    const { onOpenChange } = open();
    setWall("2026-11-02T09:00");
    await userEvent.click(comesDown());
    expect(screen.getByTestId("schedule-readback").textContent).toMatch(
      /^Comes down/
    );
    await userEvent.click(submit());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(requests()[0]?.body).toMatchObject({
      into: "own",
      document: { ...DOCUMENT, action: "unpublish" },
    });
  });

  it("holds each one back, with the reason beside it, without the document's own grant", () => {
    grants.missing = ["publish-posts"];
    open();
    expect(goesLive()).toBeDisabled();
    expect(comesDown()).not.toBeDisabled();
    // Opens on the one the reader may take.
    expect(comesDown()).toBeChecked();
    expect(
      screen.getByText("You do not have permission to publish this document.")
    ).toBeTruthy();
  });
});

describe("the ways out", () => {
  /** A release in the list reads, of this kind and state. */
  const listed = (title: string, kind: string, state: string) => ({
    id: title,
    title,
    description: null,
    kind,
    state,
    scheduledAt: state === "scheduled" ? "2026-11-05T09:00:00.000Z" : null,
    timezone: "UTC",
    publishedAt: null,
    createdBy: "u1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    memberCounts: { total: 3, goLive: 3, comeDown: 0 },
    can: {
      schedule: true,
      cancel: true,
      addMember: true,
      removeMember: true,
      publishNow: true,
      update: true,
      delete: true,
    },
  });

  /** Every list read answers every kind and state; a write answers as given. */
  function serve(write: () => Response = () => answer(201, SCHEDULED)) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") return Promise.resolve(write());
      return Promise.resolve(
        answer(200, {
          items: [
            listed("Autumn launch", "release", "draft"),
            listed("Winter launch", "release", "scheduled"),
            listed("Hello on its own", "single", "draft"),
            listed("Goodbye on its own", "single", "scheduled"),
            listed("Old launch", "release", "cancelled"),
            listed("Stuck launch", "release", "blocked"),
            listed("Past launch", "release", "published"),
          ],
          meta: {
            total: 7,
            page: 1,
            limit: 20,
            totalPages: 1,
            hasNext: false,
            hasPrev: false,
          },
        })
      );
    });
  }

  const writes = () => requests().filter(request => request.method !== "GET");

  it("offers only ordinary releases in draft or scheduled, each with when and how many", async () => {
    // Every read answers every kind, so only a guard on the rows themselves
    // keeps a single, or a release that will never ship, out.
    serve();
    open();
    await userEvent.click(
      screen.getByRole("radio", { name: "With an existing release" })
    );

    expect(
      await screen.findByRole("radio", { name: /Autumn launch/ })
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Winter launch/ })).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /Winter launch/ }).closest("div")
        ?.textContent
    ).toMatch(/3 documents/);
    for (const name of [
      /Hello on its own/,
      /Goodbye on its own/,
      /Old launch/,
      /Stuck launch/,
      /Past launch/,
    ]) {
      expect(screen.queryByRole("radio", { name })).toBeNull();
    }
    // And asked for as such: ordinary releases, from Upcoming and Drafts.
    const reads = fetchMock.mock.calls
      .filter(
        call =>
          ((call[1] as RequestInit | undefined)?.method ?? "GET") === "GET"
      )
      .map(call => new URL(String(call[0]), "http://x"));
    expect(reads.length).toBeGreaterThan(0);
    for (const url of reads) {
      expect(url.searchParams.get("kind")).toBe("release");
      expect(["upcoming", "drafts"]).toContain(url.searchParams.get("tab"));
    }
  });

  it("adds the document to the release chosen, in one step", async () => {
    serve();
    const { onOpenChange } = open();
    await userEvent.click(
      screen.getByRole("radio", { name: "With an existing release" })
    );
    await userEvent.click(
      await screen.findByRole("radio", { name: /Autumn launch/ })
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Add to Autumn launch" })
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(writes()).toEqual([
      {
        path: expect.stringMatching(/\/releases\/schedule-document$/),
        method: "POST",
        body: {
          into: "existing",
          document: { ...DOCUMENT, action: "publish" },
          releaseId: "Autumn launch",
        },
      },
    ]);
  });

  it("makes a new release named here, with its description, and adds the document", async () => {
    serve();
    const { onOpenChange } = open();
    await userEvent.click(
      screen.getByRole("radio", { name: "In a new release" })
    );
    // Refused in place without a name, and nothing is sent.
    await userEvent.click(
      screen.getByRole("button", { name: "Create release and add" })
    );
    expect(screen.getByText("Name the new release.")).toBeTruthy();
    expect(writes()).toEqual([]);

    await userEvent.type(screen.getByLabelText("Name"), "Autumn launch");
    await userEvent.type(
      screen.getByLabelText(/Description/),
      "Everything for autumn"
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create release and add" })
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(writes()[0]?.body).toEqual({
      into: "new",
      document: { ...DOCUMENT, action: "publish" },
      title: "Autumn launch",
      description: "Everything for autumn",
    });
  });

  it("holds On its own, with the reason, for a person who may not schedule releases", () => {
    grants.missing = ["publish-content-releases"];
    serve();
    open();
    expect(
      screen.getByRole("radio", { name: "On its own, at a time" })
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Scheduling on its own needs permission to schedule releases."
      )
    ).toBeTruthy();
  });
});

describe("a refusal for the document's hard problems", () => {
  it("is said in the dialog, one line per problem, and the dialog stays open", async () => {
    fetchMock.mockResolvedValue(
      answer(409, {
        error: {
          code: "CONFLICT",
          message:
            "This document cannot be scheduled until the problems blocking it are fixed. Nothing was scheduled.",
          requestId: "r",
          data: {
            problems: [
              {
                memberId: null,
                code: "REQUIRED_FIELD_MISSING",
                document: DOCUMENT,
              },
            ],
            hidden: [],
          },
        },
      })
    );
    const { onOpenChange } = open();
    setWall("2026-11-02T09:00");
    await userEvent.click(
      screen.getByRole("button", { name: /^Schedule for/ })
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "This document cannot be scheduled until the problems blocking it are fixed."
    );
    expect(alert.textContent).toContain("Missing a required field");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("every language", () => {
  it("is said to move together where the document is translated, and not otherwise", () => {
    const { unmount } = render(
      <ScheduleDocumentDialog
        open
        onOpenChange={vi.fn()}
        document={DOCUMENT}
        documentTitle="Spring launch"
        savesGoLive={false}
        opener={null}
        languages={["English", "Spanish"]}
      />
    );
    expect(
      screen.getByText(
        "Every language moves together: English and Spanish, and the shared fields."
      )
    ).toBeTruthy();
    unmount();
    open();
    expect(screen.queryByText(/Every language moves together/)).toBeNull();
  });
});
