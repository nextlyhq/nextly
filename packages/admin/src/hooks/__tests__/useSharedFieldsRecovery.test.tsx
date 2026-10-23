/**
 * A publish refused over shared values someone else published since offers
 * its way out on the refusal itself: the toast names the fields, stays until
 * acted on or closed, and its action saves the refused values as the pending
 * change before taking the live values, then reloads. Any other error is left
 * to the caller to report.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const take = vi.hoisted(() => vi.fn());
vi.mock("@admin/services/versionApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/versionApi")>()),
  versionApi: { takeLiveSharedValues: take },
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    defaultLocale: "en",
    getLocale: (code: string) =>
      ({ en: { label: "English" }, es: { label: "Spanish" } })[code],
  }),
}));

import {
  takenMessage,
  useSharedFieldsRecovery,
} from "../useSharedFieldsRecovery";

/** A 409 as the API client raises it. */
function refusal(data: Record<string, unknown>) {
  return Object.assign(new Error("Shared values were published"), {
    status: 409,
    code: "CONFLICT",
    requestId: "r1",
    data,
  });
}

function renderRecovery(onTaken = vi.fn()) {
  const { result } = renderHook(() =>
    useSharedFieldsRecovery({
      scope: { kind: "collection", slug: "authors", entryId: "e1" },
      locale: "es",
      fields: [{ name: "articleCount", label: "Article Count" }],
      onTaken,
    })
  );
  return result.current;
}

/** The toast's action, as sonner would call it. */
function actionOf(call: unknown[]): () => void {
  return (call[1] as { action: { onClick: () => void } }).action.onClick;
}

describe("useSharedFieldsRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the out-of-date fields in a toast that stays, with the action", () => {
    const recover = renderRecovery();
    const handled = recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
        hiddenCount: 1,
      }),
      vi.fn()
    );

    expect(handled).toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = toast.error.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(message).toBe(
      "Article Count and 1 field you can't view were published by someone else after this change began."
    );
    expect(options).toMatchObject({
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
      action: { label: "Take the live values" },
    });
  });

  it("saves the refused values first, then takes the live values, then reloads", async () => {
    const order: string[] = [];
    const saveRefused = vi.fn(async () => {
      order.push("save");
    });
    take.mockImplementation(async () => {
      order.push("take");
      return {
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      };
    });
    const onTaken = vi.fn(() => order.push("reload"));
    const recover = renderRecovery(onTaken);
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      saveRefused
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalled());

    expect(order).toEqual(["save", "take", "reload"]);
    expect(take).toHaveBeenCalledWith(
      { kind: "collection", slug: "authors", entryId: "e1" },
      "es"
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History."
    );
  });

  it("doesn't take the live values when saving the refused values fails", async () => {
    const recover = renderRecovery();
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      vi.fn(async () => {
        throw new Error("offline");
      })
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

    expect(take).not.toHaveBeenCalled();
  });

  it("leaves any other error to the caller", () => {
    const recover = renderRecovery();
    expect(
      recover(
        refusal({ reason: "shared-edits-unordered", fields: ["articleCount"] }),
        vi.fn()
      )
    ).toBe(false);
    expect(recover(new Error("network"), vi.fn())).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("takenMessage", () => {
  const label = (name: string) =>
    ({ articleCount: "Article Count", banner: "Banner", score: "Score" })[
      name
    ] ?? name;

  it("says what was taken, what to copy by hand, and what the editor can't change", () => {
    expect(
      takenMessage(
        {
          taken: ["articleCount"],
          outOfDate: ["banner", "score"],
          hiddenOutOfDate: 1,
          copyByHand: { fields: ["banner"], reason: "It is translated." },
        },
        "Spanish",
        label
      )
    ).toBe(
      "Spanish now uses the live Article Count. Its earlier value is in History. " +
        "Copy Banner by hand: It is translated. " +
        "Score and 1 field you can't view can't be changed by you and still need someone who can."
    );
  });

  it("says so when there was nothing to take", () => {
    expect(takenMessage({ taken: [], outOfDate: [] }, "Spanish", label)).toBe(
      "Spanish was already up to date."
    );
  });
});
