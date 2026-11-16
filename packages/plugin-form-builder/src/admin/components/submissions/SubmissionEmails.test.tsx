// @vitest-environment jsdom

/**
 * A submission's Emails box: each recipient state as its chip, Partly sent,
 * a cancel's cause, a send in progress instead of Resend, and Resend offered
 * only to a person who may, sending the recipients ticked.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { RecipientStatus } from "../../../utils/send-status";

import {
  type NotificationSendsView,
  SubmissionEmails,
} from "./SubmissionEmails";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );

const recipient = (
  hint: string,
  state: RecipientStatus["state"],
  more: Partial<RecipientStatus> = {}
): RecipientStatus => ({
  digest: `d-${hint}`,
  hint,
  kind: "to",
  source: "team",
  state,
  retries: 0,
  at: "2026-11-10T14:20:00.000Z",
  ...more,
});

const group = (
  more: Partial<NotificationSendsView>
): NotificationSendsView => ({
  notification: "team",
  name: "Hiring team",
  recipients: [recipient("j•••@acme.test", "sent")],
  inProgress: false,
  sends: [
    {
      queuedId: "q1",
      state: "sent",
      attempts: 1,
      at: "2026-11-10T14:20:00.000Z",
      requestedBy: null,
      retired: false,
    },
  ],
  addressable: [],
  ...more,
});

/**
 * The box, with the route answering `items` (or, as a function, what it
 * holds at each read), and every call it saw.
 */
function draw(
  items: NotificationSendsView[] | (() => NotificationSendsView[]),
  canResend = false,
  status?: string
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === "POST"
        ? json(201, { message: "Sent again.", item: { id: "r1" } })
        : json(200, {
            items: typeof items === "function" ? items() : items,
            meta: { total: 1 },
          });
    })
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SubmissionEmails
        submissionId="s1"
        status={status}
        canResend={canResend}
      />
    </QueryClientProvider>
  );
  return calls;
}

describe("a submission's emails", () => {
  it.each([
    ["waiting", {}, "Waiting"],
    ["retrying", {}, "Retrying"],
    ["sending", {}, "Sending"],
    ["sent", {}, "Sent"],
    ["sent", { retries: 1 }, "Sent after 1 retry"],
    ["failed", {}, "Failed"],
    ["cancelled", { cancel: { by: "spam" as const } }, "Cancelled"],
  ] as const)("shows a recipient %s as %s", async (state, more, label) => {
    draw([group({ recipients: [recipient("j•••@acme.test", state, more)] })]);
    const row = (await screen.findByText("Hiring team")).closest("li")!;
    expect(within(row).getByText(label)).toBeTruthy();
    expect(within(row).getByText("To j•••@acme.test")).toBeTruthy();
  });

  it("says why it was cancelled", async () => {
    draw([
      group({
        recipients: [
          recipient("j•••@acme.test", "cancelled", { cancel: { by: "spam" } }),
        ],
      }),
    ]);
    expect(
      await screen.findByText("Cancelled when the submission was marked Spam")
    ).toBeTruthy();
  });

  it("reads recipients that differ as Partly sent, saying which", async () => {
    draw([
      group({
        recipients: [
          recipient("e•••@acme.test", "sent"),
          recipient("a•••@acme.test", "failed"),
        ],
      }),
    ]);
    expect(await screen.findByText("Partly sent")).toBeTruthy();
    expect(
      screen.getByText("e•••@acme.test sent; a•••@acme.test failed")
    ).toBeTruthy();
  });

  it("says a send is in progress, and offers no Resend, while one is", async () => {
    draw(
      [
        group({
          inProgress: true,
          recipients: [recipient("j•••@acme.test", "retrying")],
          addressable: [
            {
              digest: "d1",
              hint: "j•••@acme.test",
              source: "team",
              reached: false,
            },
          ],
        }),
      ],
      true
    );
    expect(await screen.findByText("A send is in progress.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("reads the emails again while a send is in progress, until it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const addressable = [
        {
          digest: "d1",
          hint: "a•••@acme.test",
          source: "team" as const,
          reached: false,
        },
      ];
      let now = group({
        inProgress: true,
        recipients: [recipient("a•••@acme.test", "retrying")],
        addressable,
      });
      const calls = draw(() => [now], true);
      expect(await screen.findByText("A send is in progress.")).toBeTruthy();

      // The retry fails in the background.
      now = group({
        recipients: [recipient("a•••@acme.test", "failed")],
        addressable,
      });
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(await screen.findByText("Failed")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Resend" })).toBeTruthy();

      // Settled: no more reads.
      const reads = calls.length;
      await act(() => vi.advanceTimersByTimeAsync(20000));
      expect(calls).toHaveLength(reads);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no Resend on a submission marked Spam, and says why", async () => {
    const failed = group({
      recipients: [recipient("a•••@acme.test", "failed")],
      addressable: [
        {
          digest: "d1",
          hint: "a•••@acme.test",
          source: "team",
          reached: false,
        },
      ],
    });
    draw([failed], true, "spam");
    await screen.findByText("Hiring team");
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(
      screen.getByText(
        "Marked Spam: its emails are not sent. Mark it Not spam to send them again."
      )
    ).toBeTruthy();
    cleanup();
    draw([failed], true, "read");
    expect(await screen.findByRole("button", { name: "Resend" })).toBeTruthy();
  });

  it("offers Resend only to a person who may", async () => {
    const failed = group({
      recipients: [recipient("a•••@acme.test", "failed")],
      addressable: [
        {
          digest: "d1",
          hint: "a•••@acme.test",
          source: "team",
          reached: false,
        },
      ],
    });
    draw([failed], false);
    await screen.findByText("Hiring team");
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    cleanup();
    draw([failed], true);
    expect(await screen.findByRole("button", { name: "Resend" })).toBeTruthy();
  });

  it("sends to who missed it, and to a recipient ticked to send again", async () => {
    const user = userEvent.setup();
    const calls = draw(
      [
        group({
          recipients: [
            recipient("e•••@acme.test", "sent"),
            recipient("a•••@acme.test", "failed"),
          ],
          addressable: [
            {
              digest: "d-e",
              hint: "e•••@acme.test",
              source: "team",
              reached: true,
            },
            {
              digest: "d-a",
              hint: "a•••@acme.test",
              source: "team",
              reached: false,
            },
          ],
        }),
      ],
      true
    );
    await user.click(await screen.findByRole("button", { name: "Resend" }));
    const dialog = await screen.findByRole("dialog");
    // Who missed it goes regardless, listed rather than offered as a box;
    // who received it goes only if ticked.
    expect(
      within(
        within(dialog).getByRole("region", { name: "Sends to" })
      ).getByText(/a•••@acme.test/)
    ).toBeTruthy();
    expect(
      within(dialog).queryByRole("checkbox", { name: /a•••@acme.test/ })
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("checkbox", { name: /e•••@acme.test/ })
    );
    await user.click(within(dialog).getByRole("button", { name: "Send" }));

    const sent = calls.find(call => call.init?.method === "POST");
    expect(sent?.url).toBe(
      "/admin/api/plugins/@nextlyhq/plugin-form-builder/submissions/s1/resend"
    );
    expect(JSON.parse(String(sent?.init?.body))).toEqual({
      notification: "team",
      tick: ["d-e"],
    });
  });
});
