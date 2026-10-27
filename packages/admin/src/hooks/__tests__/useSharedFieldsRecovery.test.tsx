/**
 * A publish refused over shared values someone else published since offers
 * its way out on the refusal itself: the toast names the fields, stays until
 * acted on or closed, and its action saves what the form holds when it is
 * taken as the pending change, takes the live values, has the form show them,
 * then reloads. Any other error is left to the caller to report.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
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

import type { HookWarning } from "@admin/lib/mutation-warnings";

import {
  type RefusedForm,
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

function renderRecovery(
  args: {
    onTaken?: () => unknown;
    save?: (values: unknown) => unknown;
  } = {}
) {
  const rendered = renderHook(() =>
    useSharedFieldsRecovery({
      scope: { kind: "collection", slug: "authors", entryId: "e1" },
      locale: "es",
      fields: [{ name: "articleCount", label: "Article Count" }],
      // Whatever the stand-in answers, read as a save's result is.
      save: async values =>
        (await args.save?.(values)) as
          | { warnings?: readonly HookWarning[] }
          | undefined,
      onTaken: args.onTaken ?? vi.fn(),
    })
  );
  return { recover: rendered.result.current, unmount: rendered.unmount };
}

/** A form the recovery reads and updates, recording what it was asked. */
function formHolding(
  values: Record<string, unknown>,
  order: string[] = []
): RefusedForm {
  return {
    pendingChangeNow: vi.fn(async () => {
      order.push("read");
      return values;
    }),
    adoptTaken: vi.fn((fields: readonly string[]) => {
      order.push(`adopt ${fields.join(",")}`);
    }),
    // A mock of the generic gate, typed as the port's: the mock itself only
    // sees `unknown`, which is all the recovery hands back through it.
    run: vi.fn(async (work: () => Promise<unknown>) => {
      order.push("hold");
      try {
        return await work();
      } finally {
        order.push("release");
      }
    }) as unknown as RefusedForm["run"],
  };
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
    const { recover } = renderRecovery();
    const handled = recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
        hiddenCount: 1,
      }),
      formHolding({})
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

  it("saves what the form holds when the action is taken, then takes the live values, shows them, and reloads", async () => {
    const order: string[] = [];
    const save = vi.fn((values: unknown) => {
      order.push("save");
      return values;
    });
    take.mockImplementation(async () => {
      order.push("take");
      return {
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      };
    });
    const onTaken = vi.fn(() => order.push("reload"));
    const { recover } = renderRecovery({ onTaken, save });
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({ articleCount: 3, bio: "Typed after the refusal" }, order)
    );

    // Nothing is read until the action is taken: the form may change first.
    expect(order).toEqual([]);
    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalled());

    expect(order).toEqual([
      "hold",
      "read",
      "save",
      "take",
      "adopt articleCount",
      "reload",
      "release",
    ]);
    expect(save).toHaveBeenCalledWith({
      articleCount: 3,
      bio: "Typed after the refusal",
    });
    expect(take).toHaveBeenCalledWith(
      { kind: "collection", slug: "authors", entryId: "e1" },
      "es"
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History."
    );
  });

  it("says on the success toast when a hook after the recovery's save failed", async () => {
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    const onTaken = vi.fn();
    const failed: HookWarning = {
      severity: "failure",
      phase: "afterUpdate",
      collection: "authors",
      code: "INTERNAL_ERROR",
      message: "The search index wasn't updated.",
    };
    const { recover } = renderRecovery({
      onTaken,
      save: () => ({ item: { id: "e1" }, warnings: [failed] }),
    });
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({ articleCount: 3 })
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalled());

    // The take is reported, and so is what failed after the save, on the
    // one toast rather than as a plain success.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History, but 1 follow-up action failed",
      expect.objectContaining({ duration: 10_000 })
    );
  });

  it.each([
    [
      "succeeds",
      () => undefined,
      [
        "hold",
        "taking",
        "read",
        "adopt articleCount",
        "taken",
        "reload",
        "release",
        "done",
      ],
    ],
    [
      "fails",
      () => Promise.reject(new Error("offline")),
      ["hold", "taking", "read", "release", "failed", "done"],
    ],
  ])(
    "says the live values are being taken while the editor is held, and stops once it %s",
    async (_outcome, save, expected) => {
      take.mockResolvedValue({
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      });
      const order: string[] = [];
      toast.loading.mockImplementation(() => order.push("taking"));
      toast.success.mockImplementation(() => order.push("taken"));
      toast.dismiss.mockImplementation(() => order.push("done"));
      const { recover } = renderRecovery({
        onTaken: () => order.push("reload"),
        save,
      });
      recover(
        refusal({
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        }),
        formHolding({ articleCount: 3 }, order)
      );
      toast.error.mockImplementation(() => order.push("failed"));

      actionOf(toast.error.mock.calls[0])();
      await vi.waitFor(() => expect(order).toContain("done"));

      // Said from the moment the editor is held, and told once the save and
      // the take have committed; taken down once the hold is released,
      // however it ended.
      expect(order).toEqual(expected);
      const shown = (toast.loading.mock.calls[0] as unknown[])[1] as {
        id: string;
      };
      expect(toast.dismiss).toHaveBeenLastCalledWith(shown.id);
    }
  );

  it("doesn't take the live values when the form's values can't be saved", async () => {
    const { recover } = renderRecovery({
      save: () => Promise.reject(new Error("offline")),
    });
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({ articleCount: 3 })
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

    expect(take).not.toHaveBeenCalled();
  });

  it("doesn't save or take when the form fails its own checks", async () => {
    const save = vi.fn();
    const { recover } = renderRecovery({ save });
    const form = formHolding({});
    vi.mocked(form.pendingChangeNow).mockRejectedValue(
      new Error("Some fields need attention before this can be saved.")
    );
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

    expect(save).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it("keeps one refusal toast per document and language, and closes it when the editor leaves", () => {
    const { recover, unmount } = renderRecovery();
    const stale = refusal({
      reason: "shared-fields-out-of-date",
      fields: ["articleCount"],
    });
    recover(stale, formHolding({}));
    recover(stale, formHolding({}));

    const ids = toast.error.mock.calls.map(
      call => (call[1] as { id?: unknown }).id
    );
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);

    unmount();
    expect(toast.dismiss).toHaveBeenCalledWith(ids[0]);
  });

  it("closes the toast when the editor moves to another language in place, and gives the next refusal its own", () => {
    const { result, rerender } = renderHook(
      ({ locale }: { locale: string }) =>
        useSharedFieldsRecovery({
          scope: { kind: "collection", slug: "authors", entryId: "e1" },
          locale,
          fields: [{ name: "articleCount", label: "Article Count" }],
          save: async () => undefined,
          onTaken: vi.fn(),
        }),
      { initialProps: { locale: "es" } }
    );
    const stale = refusal({
      reason: "shared-fields-out-of-date",
      fields: ["articleCount"],
    });
    result.current(stale, formHolding({}));
    const spanish = (toast.error.mock.calls[0]?.[1] as { id?: unknown }).id;

    // The same editor, still mounted, switched to English.
    rerender({ locale: "en" });
    expect(toast.dismiss).toHaveBeenCalledWith(spanish);

    result.current(stale, formHolding({}));
    const english = (toast.error.mock.calls[1]?.[1] as { id?: unknown }).id;
    expect(english).toEqual(expect.any(String));
    expect(english).not.toBe(spanish);
  });

  it("doesn't show the live values in a form the editor has moved to another language", async () => {
    let arrive: (answer: unknown) => void = () => {};
    take.mockImplementation(
      () =>
        new Promise(resolve => {
          arrive = resolve;
        })
    );
    const onTaken = vi.fn();
    const rendered = renderHook(
      ({ locale }: { locale: string }) =>
        useSharedFieldsRecovery({
          scope: { kind: "collection", slug: "authors", entryId: "e1" },
          locale,
          fields: [{ name: "articleCount", label: "Article Count" }],
          save: async () => undefined,
          onTaken,
        }),
      { initialProps: { locale: "es" } }
    );
    const form = formHolding({ articleCount: 3 });
    rendered.result.current(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(take).toHaveBeenCalled());
    // The author moves to a language already loaded while the take is in
    // flight. The editor keeps the one form, now showing that language.
    rendered.rerender({ locale: "en" });
    arrive({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalled());

    // Spanish's live values are not written into the English form.
    expect(form.adoptTaken).not.toHaveBeenCalled();
    // The take itself named Spanish and stands; the reload shows it.
    expect(take).toHaveBeenCalledWith(
      { kind: "collection", slug: "authors", entryId: "e1" },
      "es"
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History."
    );
  });

  it("runs the save, the take and the reload inside the form's write gate, held until the reload finishes", async () => {
    const order: string[] = [];
    take.mockImplementation(async () => {
      order.push("take");
      return {
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      };
    });
    let reloaded: () => void = () => {};
    const onTaken = vi.fn(
      () =>
        new Promise<void>(resolve => {
          order.push("reload");
          reloaded = () => {
            order.push("reloaded");
            resolve();
          };
        })
    );
    const { recover } = renderRecovery({
      onTaken,
      save: values => {
        order.push("save");
        return values;
      },
    });
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({ articleCount: 3 }, order)
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(onTaken).toHaveBeenCalled());
    // Still held while the reloaded document is on its way: a Publish now
    // would send the value the take just replaced.
    expect(order).not.toContain("release");
    reloaded();
    await vi.waitFor(() => expect(order).toContain("release"));

    expect(order).toEqual([
      "hold",
      "read",
      "save",
      "take",
      "adopt articleCount",
      "reload",
      "reloaded",
      "release",
    ]);
  });

  it("saves and takes nothing when the form won't run it, its writes being held", async () => {
    const save = vi.fn();
    const { recover } = renderRecovery({ save });
    const form = formHolding({ articleCount: 3 });
    vi.mocked(form.run).mockRejectedValue(
      new Error("This document can't be saved right now.")
    );
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

    expect(save).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
  });

  it("leaves any other error to the caller", () => {
    const { recover } = renderRecovery();
    expect(
      recover(
        refusal({ reason: "shared-edits-unordered", fields: ["articleCount"] }),
        formHolding({})
      )
    ).toBe(false);
    expect(recover(new Error("network"), formHolding({}))).toBe(false);
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
