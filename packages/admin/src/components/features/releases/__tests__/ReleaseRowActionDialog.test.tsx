/**
 * What the row menu's confirmations say when their request fails.
 *
 * A refusal the server answered is definite: nothing changed, and its reason
 * can be shown. A request whose answer never arrived is not: the action may
 * have happened, so the dialog asks the server what is true now and says
 * that, or says it cannot tell.
 *
 * @module components/features/releases/__tests__/ReleaseRowActionDialog.test
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const api = vi.hoisted(() => ({
  publishReleaseNow: vi.fn(),
  cancelRelease: vi.fn(),
  deleteRelease: vi.fn(),
  fetchRelease: vi.fn(),
}));

vi.mock("@admin/services/releaseApi", () => api);

import { ReleaseRowActionDialog } from "../ReleaseRowActionDialog";

const RELEASE = {
  id: "r1",
  title: "Spring launch",
  description: null,
  scheduledAt: "2026-10-17T02:00:00.000Z",
  timezone: "UTC",
  state: "scheduled" as const,
  publishedAt: null,
  createdBy: null,
  createdAt: "2026-10-01T09:00:00.000Z",
  updatedAt: "2026-10-01T09:00:00.000Z",
};

/** A refusal the server answered, in its error envelope. */
function refusal(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}

async function confirm(action: "publish" | "cancel" | "delete") {
  const user = userEvent.setup();
  render(
    <ReleaseRowActionDialog
      release={RELEASE}
      action={action}
      open
      onOpenChange={() => {}}
    />
  );
  const button = {
    publish: "Publish now",
    cancel: "Cancel release",
    delete: "Delete release",
  }[action];
  await user.click(screen.getByRole("button", { name: button }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a confirmation whose request failed", () => {
  it("says nothing changed when the server refused", async () => {
    api.publishReleaseNow.mockRejectedValue(
      refusal(409, "CONFLICT", "Two documents are not ready.")
    );
    await confirm("publish");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Two documents are not ready."
    );
    // A definite answer needs no second question.
    expect(api.fetchRelease).not.toHaveBeenCalled();
  });

  it("asks what is true now when the answer was lost, and says the publish went through", async () => {
    api.publishReleaseNow.mockRejectedValue(new TypeError("Failed to fetch"));
    api.fetchRelease.mockResolvedValue({ ...RELEASE, state: "published" });
    await confirm("publish");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/connection was lost/i);
    expect(alert).toHaveTextContent(/it is published/i);
    expect(alert).not.toHaveTextContent(/nothing/i);
  });

  it("treats a server error with no answer as lost, not as a refusal", async () => {
    api.cancelRelease.mockRejectedValue(
      refusal(502, "UNKNOWN", "Unexpected response from server.")
    );
    api.fetchRelease.mockResolvedValue({ ...RELEASE, state: "scheduled" });
    await confirm("cancel");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/it is still scheduled/i);
    expect(api.fetchRelease).toHaveBeenCalledWith("r1");
  });

  it("reads a release that is gone as deleted", async () => {
    api.deleteRelease.mockRejectedValue(new TypeError("Failed to fetch"));
    api.fetchRelease.mockRejectedValue(refusal(404, "NOT_FOUND", "Not found."));
    await confirm("delete");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /it was deleted/i
    );
  });

  it("says the outcome is unknown when the check fails too", async () => {
    api.publishReleaseNow.mockRejectedValue(new TypeError("Failed to fetch"));
    api.fetchRelease.mockRejectedValue(new TypeError("Failed to fetch"));
    await confirm("publish");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not tell whether/i);
    expect(alert).toHaveTextContent(/check the release before trying again/i);
  });
});
