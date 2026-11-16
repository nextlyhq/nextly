// @vitest-environment jsdom

/**
 * A notification's Recent sends: each send's result as its chip, the
 * submission it was for (a link to its page) and who it went to; nothing
 * for a person the route refuses, and nothing before the form is saved.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipientStatus } from "../../../utils/send-status";

import {
  NotificationRecentSends,
  type RecentSendView,
} from "./NotificationRecentSends";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const recipient = (
  hint: string,
  state: RecipientStatus["state"],
  retries = 0
): RecipientStatus => ({
  digest: `d-${hint}`,
  hint,
  kind: "to",
  source: "team",
  state,
  retries,
  at: "2026-11-10T14:20:00.000Z",
});

function draw(status: number, items: RecentSendView[], formId = "f1") {
  const fetched = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ items, meta: { total: items.length } }), {
        status,
        headers: { "content-type": "application/json" },
      })
    )
  );
  vi.stubGlobal("fetch", fetched);
  const { container } = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <NotificationRecentSends
        formId={formId === "" ? undefined : formId}
        notificationId="team"
        submissionsSlug="form-submissions"
      />
    </QueryClientProvider>
  );
  return { container, fetched };
}

describe("a notification's recent sends", () => {
  it("lists each send with its result, its submission and who it went to", async () => {
    draw(200, [
      {
        submission: "s1",
        title: "Fatima Garcia",
        recipients: [
          recipient("e•••@acme.test", "sent"),
          recipient("a•••@acme.test", "sent"),
        ],
        at: "2026-11-10T09:15:00.000Z",
      },
      {
        submission: "s2",
        title: "Ali Shah",
        recipients: [recipient("e•••@acme.test", "sent", 1)],
        at: "2026-11-08T10:20:00.000Z",
      },
      {
        submission: "s3",
        title: "Hina Rossi",
        recipients: [
          recipient("e•••@acme.test", "sent"),
          recipient("a•••@acme.test", "failed"),
        ],
        at: "2026-11-10T14:15:00.000Z",
      },
    ]);
    expect(await screen.findByText("Sent")).toBeTruthy();
    expect(screen.getByText("Sent after 1 retry")).toBeTruthy();
    expect(screen.getByText("Partly sent")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Fatima Garcia" });
    expect(link.getAttribute("href")).toMatch(
      /^\/admin\/collections\/form-submissions\/s1\?/
    );
    expect(
      screen.getAllByText(/To e•••@acme.test, a•••@acme.test/)
    ).toHaveLength(2);
  });

  it("says nothing was sent yet", async () => {
    draw(200, []);
    expect(await screen.findByText(/Nothing sent yet/)).toBeTruthy();
  });

  it("shows nothing to a person the route refuses", async () => {
    const { container, fetched } = draw(403, []);
    await vi.waitFor(() => expect(fetched).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.textContent).toBe(""));
  });

  it("asks nothing for a form not saved yet", () => {
    const { container, fetched } = draw(200, [], "");
    expect(fetched).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
