/**
 * A publish refused over shared values someone else published since offers
 * its way out on the refusal itself: the toast names the fields, stays until
 * acted on or closed, and its action saves what the form holds when it is
 * taken as the pending change, takes the live values, has the form show them,
 * then reloads. Any other error is left to the caller to report.
 */
import {
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
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

import type { DocumentActionOutcome } from "@admin/components/features/entries/EntryForm/useDocumentActionBindings";
import { RecoverySaveRefused } from "@admin/components/features/entries/EntryForm/useRefusedForm";

import {
  type RefusedForm,
  reloadDocument,
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

function renderRecovery(args: { onTaken?: () => unknown } = {}) {
  const rendered = renderHook(() =>
    useSharedFieldsRecovery({
      scope: { kind: "collection", slug: "authors", entryId: "e1" },
      locale: "es",
      fields: [{ name: "articleCount", label: "Article Count" }],
      // Whatever the stand-in does, answered as a reload is.
      onTaken: async () => args.onTaken?.(),
    })
  );
  return { recover: rendered.result.current, unmount: rendered.unmount };
}

/** What the recovery says when it may no longer take once its Save is done. */
const NOT_TAKEN_MESSAGE =
  "Your changes were saved, but the live values weren't taken: the editor moved to another language or document, or someone else is editing it now. Publish again to be offered them.";

/**
 * A form the recovery stores and holds, recording what it was asked. Its Save
 * answers `saved` (stored, unless a test says otherwise), and the take runs
 * only once that Save has stored, as the editor's own hold does.
 */
function formHolding(
  _values: Record<string, unknown>,
  order: string[] = [],
  saved: () => DocumentActionOutcome = () => ({ ok: true })
): RefusedForm {
  return {
    mayWrite: vi.fn(() => true),
    recover: vi.fn(async (takeAfter: () => Promise<void>) => {
      order.push("hold");
      try {
        const outcome = saved();
        order.push("save");
        if (!outcome.ok) throw new RecoverySaveRefused(outcome);
        await takeAfter();
      } finally {
        order.push("release");
      }
    }),
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

  it("stores the form with the editor's own Save, then takes the live values and reloads, all inside its hold", async () => {
    const order: string[] = [];
    take.mockImplementation(async () => {
      order.push("take");
      return {
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      };
    });
    const onTaken = vi.fn(() => order.push("reload"));
    const { recover } = renderRecovery({ onTaken });
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({}, order)
    );

    // Nothing runs until the action is taken: the form may change first.
    expect(order).toEqual([]);
    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(order).toContain("release"));

    expect(order).toEqual(["hold", "save", "take", "reload", "release"]);
    expect(take).toHaveBeenCalledWith(
      { kind: "collection", slug: "authors", entryId: "e1" },
      "es"
    );
    // The Save says what it stored on its own toast; this one says what
    // was taken.
    expect(toast.success).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History."
    );
  });

  it.each([
    [
      "succeeds",
      () => ({
        message: "ok",
        item: { taken: ["articleCount"], outOfDate: [] },
      }),
      ["hold", "save", "taking", "taken", "reload", "release", "done"],
    ],
    [
      "fails",
      () => Promise.reject(new Error("offline")),
      // The take may have committed before its answer was lost, so the
      // editor reloads, still held, before letting go.
      ["hold", "save", "taking", "failed", "reload", "release", "done"],
    ],
  ])(
    "says the live values are being taken while it takes them, and stops once the take %s",
    async (_outcome, answer, expected) => {
      take.mockImplementation(answer);
      const order: string[] = [];
      toast.loading.mockImplementation(() => order.push("taking"));
      toast.success.mockImplementation(() => order.push("taken"));
      toast.dismiss.mockImplementation(() => order.push("done"));
      const { recover } = renderRecovery({
        onTaken: () => order.push("reload"),
      });
      recover(
        refusal({
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        }),
        formHolding({}, order)
      );
      toast.error.mockImplementation(() => order.push("failed"));

      actionOf(toast.error.mock.calls[0])();
      await vi.waitFor(() => expect(order).toContain("done"));

      expect(order).toEqual(expected);
      const shown = (toast.loading.mock.calls[0] as unknown[])[1] as {
        id: string;
      };
      expect(toast.dismiss).toHaveBeenLastCalledWith(shown.id);
    }
  );

  it("reloads inside its hold when the take's request fails, then lets the form start afresh from what is stored", async () => {
    // The answer is lost after the server took the values: the form still
    // shows the ones the take replaced, which the next Publish would send.
    take.mockRejectedValue(new TypeError("Failed to fetch"));
    const order: string[] = [];
    const { recover } = renderRecovery({
      onTaken: () => order.push("reload"),
    });
    const form = formHolding({}, order);
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(order).toContain("release"));

    expect(order).toEqual(["hold", "save", "reload", "release"]);
    // The hold ends as it does after a take, so the form starts afresh from
    // the reloaded document rather than keeping what it showed.
    await expect(vi.mocked(form.recover).mock.results[0]?.value).resolves.toBe(
      undefined
    );
    // Whether the take committed is unknown, so neither outcome is claimed.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenLastCalledWith(
      "The live values may not have been taken. The editor reloads to show what is stored.",
      { description: "Failed to fetch" }
    );
  });

  it.each([
    ["failed", "The entry couldn't be saved."],
    ["invalid", "Some fields need attention before this can be saved."],
  ] as const)(
    "takes nothing when the Save %s, which says why itself",
    async (reason, message) => {
      const { recover } = renderRecovery();
      const form = formHolding({}, [], () => ({ ok: false, reason, message }));
      recover(
        refusal({
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        }),
        form
      );

      actionOf(toast.error.mock.calls[0])();
      await vi.waitFor(() => expect(form.recover).toHaveBeenCalled());
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(take).not.toHaveBeenCalled();
      // Only the refusal itself: the Save's own message is its to give.
      expect(toast.error).toHaveBeenCalledTimes(1);
    }
  );

  it("says why when the Save was refused before it ran, and takes nothing", async () => {
    const { recover } = renderRecovery();
    const form = formHolding({}, [], () => ({
      ok: false,
      reason: "busy",
      message: "A save is already in progress.",
    }));
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A save is already in progress.")
    );
    expect(take).not.toHaveBeenCalled();
  });

  it("takes nothing once the document changed hands during the Save", async () => {
    const { recover } = renderRecovery();
    // A colleague takes the document over while the Save is in flight.
    const form = formHolding({}, [], () => {
      vi.mocked(form.mayWrite).mockReturnValue(false);
      return { ok: true };
    });
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );

    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(NOT_TAKEN_MESSAGE)
    );
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
          onTaken: async () => undefined,
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

  it("takes into the language it was refused for, even once the editor has moved to another", async () => {
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

    // The take names Spanish, the language it was refused for, and stands;
    // the form then starts afresh from whatever is on screen.
    expect(take).toHaveBeenCalledWith(
      { kind: "collection", slug: "authors", entryId: "e1" },
      "es"
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History."
    );
  });

  it("runs the Save, the take and the reload inside the form's hold, held until the reload finishes", async () => {
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
    const { recover } = renderRecovery({ onTaken });
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
      "save",
      "take",
      "reload",
      "reloaded",
      "release",
    ]);
  });

  it("saves and takes nothing when the form won't run it, its writes being held", async () => {
    const { recover } = renderRecovery();
    const form = formHolding({ articleCount: 3 });
    vi.mocked(form.recover).mockRejectedValue(
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

  it.each([
    ["another language", { entryId: "e1", locale: "en" }],
    ["another document", { entryId: "e2", locale: "es" }],
  ])(
    "takes nothing when the editor moves to %s while the Save runs",
    async (_where, movedTo) => {
      const rendered = renderHook(
        ({ entryId, locale }: { entryId: string; locale: string }) =>
          useSharedFieldsRecovery({
            scope: { kind: "collection", slug: "authors", entryId },
            locale,
            fields: [{ name: "articleCount", label: "Article Count" }],
            onTaken: async () => undefined,
          }),
        { initialProps: { entryId: "e1", locale: "es" } }
      );
      // The editor moves while its Save runs: what is on screen now is the
      // other language or document, not the change this refusal was for.
      const form = formHolding({}, [], () => {
        rendered.rerender(movedTo);
        return { ok: true };
      });
      rendered.result.current(
        refusal({
          reason: "shared-fields-out-of-date",
          fields: ["articleCount"],
        }),
        form
      );

      actionOf(toast.error.mock.calls[0])();
      await vi.waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(NOT_TAKEN_MESSAGE)
      );
      expect(take).not.toHaveBeenCalled();
    }
  );
});

describe("a recovery whose reload fails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** A click on a toast's action, whose default would close the toast. */
  const click = () => ({ preventDefault: vi.fn() });

  /**
   * The toast offering the reload again, once it has been offered: by
   * default the one said once the live values are taken.
   */
  function reloadOffer(
    title = "The live values were taken and saved, but the editor couldn't load them."
  ): { onClick: (event: ReturnType<typeof click>) => void } | undefined {
    const call = toast.error.mock.calls.find(
      ([message]) => message === title
    ) as
      | [
          string,
          {
            action: {
              label: string;
              onClick: (event: ReturnType<typeof click>) => void;
            };
          },
        ]
      | undefined;
    return call?.[1].action;
  }

  it("keeps the form held and offers a reload, then releases it once a reload succeeds", async () => {
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    const order: string[] = [];
    const reload = vi
      .fn<() => unknown>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValue(undefined);
    const { recover } = renderRecovery({
      onTaken: () => {
        order.push("reload");
        return reload();
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
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());
    // Held: the form is not released while it lacks the live values. What did
    // commit is still said.
    expect(order).not.toContain("release");
    expect(toast.success).toHaveBeenCalledWith(
      "Spanish now uses the live Article Count. Its earlier value is in History."
    );

    // A reload that fails again leaves it held, and offers it again.
    const firstOffer = reloadOffer();
    toast.error.mockClear();
    const retry = click();
    firstOffer?.onClick(retry);
    // Kept open, now saying the reload is under way.
    expect(retry.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());
    expect(reload).toHaveBeenCalledTimes(2);
    expect(order).not.toContain("release");

    // One that succeeds releases the form, and the offer goes.
    reloadOffer()?.onClick(click());
    await vi.waitFor(() => expect(order).toContain("release"));
    expect(reload).toHaveBeenCalledTimes(3);
    const shown = (toast.loading.mock.calls[0] as unknown[])[1] as {
      id: string;
    };
    expect(toast.dismiss).toHaveBeenLastCalledWith(shown.id);
  });

  it("keeps the form held behind Reload when the take's request fails and so does the reload, claiming no take", async () => {
    take.mockRejectedValue(new TypeError("Failed to fetch"));
    const order: string[] = [];
    const reload = vi
      .fn<() => unknown>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { recover } = renderRecovery({
      onTaken: () => {
        order.push("reload");
        return reload();
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
    const unsure = "The editor couldn't load what is stored.";
    await vi.waitFor(() => expect(reloadOffer(unsure)).toBeDefined());
    // Held, since the form may still show values the take replaced; and it
    // says nothing was taken no more than that something was.
    expect(order).not.toContain("release");
    expect(reloadOffer()).toBeUndefined();
    expect(toast.success).not.toHaveBeenCalled();

    reloadOffer(unsure)?.onClick(click());
    await vi.waitFor(() => expect(order).toContain("release"));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("offers the reload in a toast that can't be swiped away, kept across a language switch and gone with the editor", async () => {
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    const rendered = renderHook(
      ({ locale }: { locale: string }) =>
        useSharedFieldsRecovery({
          scope: { kind: "collection", slug: "authors", entryId: "e1" },
          locale,
          fields: [{ name: "articleCount", label: "Article Count" }],
          onTaken: () => Promise.reject(new Error("offline")),
        }),
      { initialProps: { locale: "es" } }
    );
    rendered.result.current(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({ articleCount: 3 })
    );
    actionOf(toast.error.mock.calls[0])();
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());

    const [, offered] = toast.error.mock.calls.find(
      ([message]) =>
        message ===
        "The live values were taken and saved, but the editor couldn't load them."
    ) as [string, { id: string; dismissible?: boolean }];
    expect(offered.dismissible).toBe(false);

    // The same form stays held in the other language, so the offer stays.
    rendered.rerender({ locale: "en" });
    expect(toast.dismiss).not.toHaveBeenCalledWith(offered.id);
    // The editor goes, and its hold with it.
    rendered.unmount();
    expect(toast.dismiss).toHaveBeenCalledWith(offered.id);
  });

  /** A recovery on a document the test can move, whose reload fails. */
  function failingRecovery(reload: () => Promise<unknown>) {
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    const order: string[] = [];
    const rendered = renderHook(
      ({ entryId, locale }: { entryId: string | null; locale: string }) =>
        useSharedFieldsRecovery({
          // No id while a document loads.
          scope:
            entryId === null
              ? null
              : { kind: "collection", slug: "authors", entryId },
          locale,
          fields: [{ name: "articleCount", label: "Article Count" }],
          onTaken: reload,
        }),
      {
        initialProps: { entryId: "e1", locale: "es" } as {
          entryId: string | null;
          locale: string;
        },
      }
    );
    rendered.result.current(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      formHolding({ articleCount: 3 }, order)
    );
    actionOf(toast.error.mock.calls[0])();
    return { order, rendered };
  }

  it("runs one reload at a time, however often Reload is clicked", async () => {
    let finish: (ok: boolean) => void = () => {};
    const reload = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = ok => (ok ? resolve(undefined) : reject(new Error("x")));
          })
      );
    const { order } = failingRecovery(reload);
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());

    const offer = reloadOffer();
    offer?.onClick(click());
    offer?.onClick(click());
    expect(reload).toHaveBeenCalledTimes(2);

    finish(true);
    await vi.waitFor(() => expect(order).toContain("release"));
  });

  it("offers nothing more once the editor has gone, if a reload in flight then fails", async () => {
    let fail: () => void = () => {};
    const reload = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            fail = () => reject(new Error("offline"));
          })
      );
    const { rendered } = failingRecovery(reload);
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());
    reloadOffer()?.onClick(click());

    rendered.unmount();
    toast.error.mockClear();
    fail();
    await new Promise(resolve => setTimeout(resolve, 20));

    expect(reloadOffer()).toBeUndefined();
  });

  it("releases the form, and drops the offer, when the editor moves to another document", async () => {
    const { order, rendered } = failingRecovery(() =>
      Promise.reject(new Error("offline"))
    );
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());
    const [, offered] = toast.error.mock.calls.find(
      ([message]) =>
        message ===
        "The live values were taken and saved, but the editor couldn't load them."
    ) as [string, { id: string }];

    // Another language of the same document: the same form, still held.
    rendered.rerender({ entryId: "e1", locale: "en" });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(order).not.toContain("release");
    expect(toast.dismiss).not.toHaveBeenCalledWith(offered.id);

    // Another document: the form shows it afresh, so nothing is held for
    // the one the live values were taken into.
    rendered.rerender({ entryId: "e2", locale: "en" });
    await vi.waitFor(() => expect(order).toContain("release"));
    expect(toast.dismiss).toHaveBeenCalledWith(offered.id);
  });

  it("keeps its hold through a moment with no document, and lets go quietly on a move to another", async () => {
    const { order, rendered } = failingRecovery(() =>
      Promise.reject(new Error("offline"))
    );
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());

    // Another language still loading: no document for a moment.
    rendered.rerender({ entryId: null, locale: "en" });
    rendered.rerender({ entryId: "e1", locale: "en" });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(order).not.toContain("release");

    // Another document: let go, with nothing to report as a failure.
    toast.error.mockClear();
    rendered.rerender({ entryId: "e2", locale: "en" });
    await vi.waitFor(() => expect(order).toContain("release"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("leaves a running take's hold alone when a second take is refused at the gate", async () => {
    take.mockResolvedValue({
      message: "ok",
      item: { taken: ["articleCount"], outOfDate: [] },
    });
    const order: string[] = [];
    let reloads = 0;
    let firstReload: (ok: boolean) => void = () => {};
    const { recover } = renderRecovery({
      onTaken: () => {
        reloads += 1;
        if (reloads > 1) return Promise.resolve();
        return new Promise((resolve, reject) => {
          firstReload = ok =>
            ok ? resolve(undefined) : reject(new Error("x"));
        });
      },
    });
    // A form whose gate admits one recovery at a time, as the editor's does.
    let busy = false;
    const form = formHolding({ articleCount: 3 }, order);
    form.recover = async (takeAfter: () => Promise<void>) => {
      if (busy) throw new Error("A save is already in progress.");
      busy = true;
      order.push("hold");
      try {
        await takeAfter();
      } finally {
        busy = false;
        order.push("release");
      }
    };
    recover(
      refusal({
        reason: "shared-fields-out-of-date",
        fields: ["articleCount"],
      }),
      form
    );
    const takeAction = actionOf(toast.error.mock.calls[0]);

    takeAction();
    await vi.waitFor(() => expect(reloads).toBe(1));
    // A second click while the first is mid-reload: refused at the gate.
    takeAction();
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A save is already in progress.")
    );

    // The first's reload fails: it still holds the form, and offers Reload.
    firstReload(false);
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());
    expect(order.filter(step => step === "release")).toHaveLength(0);
  });

  it("still holds the form when the editor comes back to the document before its reload fails", async () => {
    let failFirst: () => void = () => {};
    const reload = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failFirst = () => reject(new Error("offline"));
          })
      )
      .mockRejectedValue(new Error("offline"));
    const { order, rendered } = failingRecovery(reload);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));

    // Away to another document and back while the reload is in flight.
    rendered.rerender({ entryId: "e2", locale: "es" });
    rendered.rerender({ entryId: "e1", locale: "es" });
    failFirst();

    // Back on the document the live values were taken into, which still
    // lacks them: held, with Reload offered.
    await vi.waitFor(() => expect(reloadOffer()).toBeDefined());
    expect(order).not.toContain("release");
  });
});

describe("reloadDocument", () => {
  function observed(queryFn: () => Promise<unknown>) {
    const client = new QueryClient();
    const observer = new QueryObserver(client, {
      queryKey: ["doc"],
      queryFn,
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    return { client, unsubscribe };
  }

  it("rejects when the document's refetch fails", async () => {
    let fail = false;
    const { client, unsubscribe } = observed(async () => {
      if (fail) throw new Error("offline");
      return { id: "e1" };
    });
    await vi.waitFor(() =>
      expect(client.getQueryData(["doc"])).toEqual({ id: "e1" })
    );
    fail = true;

    await expect(reloadDocument(client, ["doc"])).rejects.toThrow(
      "couldn't be reloaded"
    );
    unsubscribe();
  });

  it("rejects when the refetch is paused offline, which otherwise answers as if it ran", async () => {
    const { client, unsubscribe } = observed(async () => ({ id: "e1" }));
    await vi.waitFor(() =>
      expect(client.getQueryData(["doc"])).toEqual({ id: "e1" })
    );
    onlineManager.setOnline(false);
    try {
      await expect(reloadDocument(client, ["doc"])).rejects.toThrow(
        "couldn't be reloaded"
      );
    } finally {
      onlineManager.setOnline(true);
      unsubscribe();
    }
  });

  it("answers once the document is back", async () => {
    let version = 1;
    const { client, unsubscribe } = observed(async () => ({ version }));
    await vi.waitFor(() =>
      expect(client.getQueryData(["doc"])).toEqual({ version: 1 })
    );
    version = 2;

    await reloadDocument(client, ["doc"]);
    expect(client.getQueryData(["doc"])).toEqual({ version: 2 });
    unsubscribe();
  });
});
