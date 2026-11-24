/**
 * The panel's Publishing section around a schedule, end to end inside the
 * admin: no section while the document is in no release; then a schedule
 * made from the main button's menu row, the one request, and the new release
 * shown where the editor looks for it, in the scheduled-release banner and in
 * the Publishing section.
 *
 * The section no longer offers Schedule… itself (it is a row of the main
 * button's menu, `ScheduleDocumentAction`'s own tests), so the cases about
 * that offer's focus and the place it held while loading went with it.
 *
 * The requests go through the real hooks and API client to a stubbed
 * `fetch`, which answers as the releases API does: the document is in no
 * release until the schedule lands, and in one after.
 *
 * @module components/features/entries/EntryForm/panels/__tests__/PublishingSection.schedule.test
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { ScheduledReleaseBanner } from "@admin/components/features/releases/ScheduledReleaseBanner";
import {
  useScheduleDocumentAction,
  type ScheduleDocumentProps,
} from "@admin/components/features/releases/ScheduleDocumentAction";

import { PublishingSection } from "../PublishingSection";

const { grants } = vi.hoisted(() => ({
  grants: { missing: [] as string[] },
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => !grants.missing.includes(slug),
}));

const DOCUMENT = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

const RELEASE = {
  id: "r1",
  title: "Spring launch",
  description: null,
  kind: "single",
  state: "scheduled",
  scheduledAt: "2026-11-02T09:00:00.000Z",
  timezone: "UTC",
  publishedAt: null,
  memberAction: "publish",
  memberId: "m1",
};

let scheduled = false;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const path = new URL(String(url), "http://x").pathname;
  if (init?.method === "POST" && path.endsWith("/releases/schedule-document")) {
    scheduled = true;
    return json(201, {
      message: "Document scheduled.",
      item: { release: RELEASE, members: [] },
    });
  }
  if (path.endsWith("/releases")) {
    const items = scheduled ? [RELEASE] : [];
    return json(200, {
      items,
      meta: { total: items.length, hasNext: false },
    });
  }
  return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The editor with the page's Schedule contribution, and a stand-in for the
 * main button's menu row that runs it, as the header's row does.
 */
function Editor() {
  const PROPS: ScheduleDocumentProps = {
    ...DOCUMENT,
    lifecycleEnabled: true,
    onDefaultLocale: true,
    documentTitle: () => "Spring launch",
    savesGoLive: false,
  };
  const schedule = useScheduleDocumentAction(PROPS);
  const contributed = schedule.contributed;
  return (
    <>
      {contributed === null ? null : (
        <button
          type="button"
          // A contribution is handed the document as edited, as the
          // header's row hands it; this one holds no unsaved edits.
          onClick={() => contributed.binding.onSelect({ values: {} })}
        >
          {contributed.action.label}
        </button>
      )}
      <ScheduledReleaseBanner document={DOCUMENT} onDefaultLocale />
      <PublishingSection document={DOCUMENT} />
      {schedule.dialog}
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
  scheduled = false;
  grants.missing = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const releasesRead = () =>
  fetchMock.mock.calls.some(([url]) =>
    new URL(String(url), "http://x").pathname.endsWith("/releases")
  );

describe("the Publishing section around a schedule", () => {
  it("draws no section while the document is in no release", async () => {
    render(<Editor />);
    await waitFor(() => expect(releasesRead()).toBe(true));
    // The control: the read answered, and the page still offers scheduling,
    // from its menu row rather than from a card in the panel.
    expect(screen.getByRole("button", { name: "Schedule…" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Publishing" })).toBeNull();
    expect(screen.queryByText(/Not scheduled/)).toBeNull();
  });

  it("shows the new release in the banner and the section once it lands", async () => {
    render(<Editor />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Schedule…" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: /^Schedule “/,
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: /^Schedule for/ })
    );

    // The banner, which says the document now changes on its own.
    // A single-document release is said as the document's own schedule.
    const banner = await waitFor(() => {
      const line = screen
        .getAllByRole("listitem")
        .find(item => /This document/.test(item.textContent ?? ""));
      expect(line).toBeDefined();
      return line as HTMLElement;
    });
    expect(banner.textContent).toMatch(
      /goes live .+ on its own, as Spring launch\./
    );
    // The section, which appears with the release and when.
    const section = await screen.findByRole("region", { name: "Publishing" });
    expect(
      within(section).getByRole("link", { name: "Spring launch" })
    ).toBeTruthy();
    expect(within(section).getByText(/^Goes live /)).toBeTruthy();
    // The dialog closed.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
