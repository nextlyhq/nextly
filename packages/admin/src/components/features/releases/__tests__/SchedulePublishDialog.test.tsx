/**
 * Scheduling one document from its editor: the time and zone chosen, the
 * moment read back in words, a time that cannot be scheduled refused before
 * anything is sent, and ONE request that makes the release, holds the
 * document and schedules it together.
 *
 * The request goes through the real hook and API client to a stubbed
 * `fetch`, so what is asserted is what the server would receive.
 *
 * @module components/features/releases/__tests__/SchedulePublishDialog.test
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "@admin/__tests__/utils";

import { instantFor, readerZone, wallTimeIn } from "../release-timezone";
import { defaultScheduleWall } from "../schedule-publish";
import { SchedulePublishDialog } from "../SchedulePublishDialog";

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
    <SchedulePublishDialog
      open
      onOpenChange={onOpenChange}
      document={DOCUMENT}
      documentTitle="Spring launch"
      opener={over.opener ?? null}
    />
  );
  return { onOpenChange };
}

const dateField = () =>
  screen.getByLabelText("Date and time") as HTMLInputElement;
const submit = () =>
  screen.getByRole("button", { name: "Schedule publish" }) as HTMLButtonElement;
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
      screen.getByText("Spring launch", { selector: "span" })
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
      /may have been scheduled\. Check the Publishing section/
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
      <SchedulePublishDialog
        open
        onOpenChange={onOpenChange}
        document={DOCUMENT}
        documentTitle="Spring launch"
        opener={opener}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <SchedulePublishDialog
        open={false}
        onOpenChange={onOpenChange}
        document={DOCUMENT}
        documentTitle="Spring launch"
        opener={opener}
      />
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});
