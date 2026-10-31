/**
 * Scheduling from the panel's Publishing section, end to end inside the
 * admin: "Not scheduled." with Schedule publish…, the dialog, the one
 * request, and then the new release shown where the editor looks for it, in
 * the scheduled-release banner and in the Publishing section.
 *
 * The requests go through the real hooks and API client to a stubbed
 * `fetch`, which answers as the releases API does: the document is in no
 * release until the schedule lands, and in one after.
 *
 * @module components/features/entries/EntryForm/panels/__tests__/PublishingSection.schedule.test
 */
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { ScheduledReleaseBanner } from "@admin/components/features/releases/ScheduledReleaseBanner";
import {
  useSchedulePublishAction,
  type SchedulePublishProps,
} from "@admin/components/features/releases/SchedulePublishAction";

import { acceptContributions } from "../../DocumentActionBar";
import type { DocumentActionBindings } from "../../useDocumentActionBindings";
import { PublishingSection } from "../PublishingSection";

const { grants, hosted } = vi.hoisted(() => ({
  grants: { missing: [] as string[] },
  hosted: { current: null as Partial<DocumentActionBindings> | null },
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => !grants.missing.includes(slug),
}));

// The editor's action model, as the page's contribution reaches it: the
// section reads the action from there and runs it as the split's row does.
vi.mock("../../DocumentActionsContext", () => ({
  useDocumentActionsContext: () => hosted.current,
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

/** The page's contribution, handed to the section as the editor hands it. */
function Editor(props: { children: ReactNode }) {
  const PROPS: SchedulePublishProps = {
    ...DOCUMENT,
    lifecycleEnabled: true,
    onDefaultLocale: true,
    documentTitle: () => "Spring launch",
    savesGoLive: false,
  };
  const schedule = useSchedulePublishAction(PROPS);
  const contributed = schedule.contributed;
  // Folded in as the editor folds a page's contribution, so the section
  // runs the same control the split's row runs.
  const offered =
    contributed === null ? null : acceptContributions([], {}, [contributed]);
  hosted.current =
    contributed === null || offered === null
      ? null
      : {
          ...offered,
          run: async () => {
            offered.bindings[contributed.action.id]?.onSelect();
            return { ok: true } as never;
          },
        };
  return (
    <>
      {props.children}
      {schedule.dialog}
    </>
  );
}

function showEditor() {
  render(
    <Editor>
      <ScheduledReleaseBanner document={DOCUMENT} onDefaultLocale />
      <PublishingSection document={DOCUMENT} />
    </Editor>
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
  hosted.current = null;
});

const publishing = () =>
  screen.getByRole("heading", { name: "Publishing" }).closest("section") ??
  screen.getByRole("heading", { name: "Publishing" }).parentElement!;

describe("scheduling from the Publishing section", () => {
  it("offers Schedule publish… under Not scheduled", async () => {
    showEditor();
    expect(await screen.findByText("Not scheduled.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Schedule publish…" })
    ).toBeTruthy();
  });

  it("shows the new release in the banner and the section once it lands", async () => {
    showEditor();
    await userEvent.click(
      await screen.findByRole("button", { name: "Schedule publish…" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Schedule publish",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Schedule publish" })
    );

    // The banner, which says the document now changes on its own.
    const banner = await screen.findByText(/This document/, {
      selector: "li",
    });
    expect(banner.textContent).toMatch(/goes live .+, with Spring launch\./);
    // The section, which names the release and when, in place of the offer.
    await waitFor(() =>
      expect(screen.queryByText("Not scheduled.")).toBeNull()
    );
    const section = publishing();
    expect(
      within(section).getByRole("link", { name: "Spring launch" })
    ).toBeTruthy();
    expect(within(section).getByText(/^Goes live /)).toBeTruthy();
    expect(
      within(section).queryByRole("button", { name: "Schedule publish…" })
    ).toBeNull();
    // The dialog closed.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves focus in the section, not on the page, once the offer it came from is gone", async () => {
    showEditor();
    await userEvent.click(
      await screen.findByRole("button", { name: "Schedule publish…" })
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Schedule publish",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Schedule publish" })
    );
    await waitFor(() =>
      expect(screen.queryByText("Not scheduled.")).toBeNull()
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // The button that opened the dialog went with "Not scheduled.", so
    // focus is handed to the section, which names the new release next.
    await waitFor(() => expect(document.activeElement).toBe(publishing()));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("shows where focus landed, with the focus ring the editor's controls use", async () => {
    // The section draws no outline of its own, so without a ring a keyboard
    // user handed focus here cannot see where it went. Inset, so the panel's
    // edges do not clip it.
    showEditor();
    await screen.findByText("Not scheduled.");
    const ring = publishing().className.split(/\s+/);
    expect(ring).toEqual(
      expect.arrayContaining([
        "focus-visible:ring-2",
        "focus-visible:ring-inset",
        "focus-visible:ring-ring",
      ])
    );
  });

  it("holds the offer, saying why, from a person who may not create releases", async () => {
    grants.missing = ["create-content-releases"];
    showEditor();
    const button = (await screen.findByRole("button", {
      name: "Schedule publish…",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reason = "You do not have permission to schedule releases.";
    expect(screen.getByText(reason)).toBeTruthy();
    // Said to a screen reader with the button, not only beside it.
    expect(
      document.getElementById(button.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe(reason);
  });
});
