/**
 * What the editor's Publish runs: the one-click publish, or the form stored without publishing it
 * and the choice of what goes live opened.
 *
 * The plausible broken versions: the form published before the choice is made, the choice opened
 * over unsaved work it does not include, an answer from before the press, a press that goes on
 * into another language's form after the editor moved, a save that failed and still opens the
 * choice, and a press that asks being reported as published.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { submitFailed, submitMoved } from "../../EntryForm/submit-outcome";
import {
  useSmartPublish,
  type SmartPublish,
  type SmartPublishHost,
  type UseSmartPublishOptions,
} from "../useSmartPublish";

const api = vi.hoisted(() => ({ publishParts: vi.fn() }));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: { ...actual.entryApi, publishParts: api.publishParts },
  };
});

const STORED = { ok: true as const, item: { id: "post-1" } };

function describedAs(languages: PartsLanguageOutcome[]): PublishPartsResult {
  return { id: "post-1", languages, shared: { changes: false, added: false } };
}

/** English holds a change; Spanish and French are live with nothing new. */
const ENGLISH_ALONE = describedAs([
  { locale: "en", outcome: "goes-live-with-pending-change" },
  { locale: "es", outcome: "stays-published" },
  { locale: "fr", outcome: "stays-published" },
]);
/** Spanish holds a change too. */
const SPANISH_TOO = describedAs([
  { locale: "en", outcome: "goes-live-with-pending-change" },
  { locale: "es", outcome: "goes-live-with-pending-change" },
  { locale: "fr", outcome: "stays-published" },
]);

const open = vi.fn();
const onPublished = vi.fn();

function options(
  over: Partial<UseSmartPublishOptions> = {}
): UseSmartPublishOptions {
  return {
    target: { kind: "collection", slug: "posts", id: "post-1" },
    languages: ["en", "es", "fr"],
    currentLocale: "en",
    sharedPending: false,
    live: true,
    open,
    onPublished,
    ...over,
  };
}

function host(over: Partial<SmartPublishHost> = {}) {
  return {
    publish: vi.fn(() => Promise.resolve(STORED)),
    save: vi.fn(() => Promise.resolve(STORED)),
    unsaved: () => false,
    sharedEdited: () => false,
    ...over,
  };
}

function smartPublish(over: Partial<UseSmartPublishOptions> = {}) {
  return renderHook((props: UseSmartPublishOptions) => useSmartPublish(props), {
    initialProps: options(over),
  });
}

/** The press, where the document has one to make. */
function press(
  publish: SmartPublish | undefined,
  editor: SmartPublishHost
): ReturnType<SmartPublish> {
  if (publish === undefined) {
    throw new Error("the document has no smart Publish");
  }
  return publish(editor);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.publishParts.mockResolvedValue(ENGLISH_ALONE);
});

describe("the editor's Publish", () => {
  it("publishes in one click, and says so, when only the language on screen changes", async () => {
    const { result } = smartPublish();
    const editor = host({ unsaved: () => true });

    await expect(press(result.current, editor)).resolves.toEqual(STORED);

    expect(editor.publish).toHaveBeenCalledTimes(1);
    expect(editor.save).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(onPublished).toHaveBeenCalledWith({ published: ["en"] });
  });

  it("asks the server on the press what publishing every language would do, changing nothing", async () => {
    const { result } = smartPublish();
    expect(api.publishParts).not.toHaveBeenCalled();

    await press(result.current, host());

    expect(api.publishParts).toHaveBeenCalledTimes(1);
    expect(api.publishParts).toHaveBeenCalledWith(
      "posts",
      "post-1",
      "publish",
      expect.objectContaining({ locales: "all", describe: true })
    );
  });

  it("does not say it published when the publish failed", async () => {
    const { result } = smartPublish();
    const failed = submitFailed(new Error("offline"));

    await expect(
      press(result.current, host({ publish: () => Promise.resolve(failed) }))
    ).resolves.toEqual(failed);

    expect(onPublished).not.toHaveBeenCalled();
  });

  it("says nothing over the language moved to while it published", async () => {
    const { result, rerender } = smartPublish();

    await press(
      result.current,
      host({
        publish: () => {
          rerender(options({ currentLocale: "es" }));
          return Promise.resolve(STORED);
        },
      })
    );

    expect(onPublished).not.toHaveBeenCalled();
  });

  it("opens the choice, publishing nothing, when another language holds changes", async () => {
    api.publishParts.mockResolvedValue(SPANISH_TOO);
    const { result } = smartPublish();
    const editor = host();

    await expect(press(result.current, editor)).resolves.toEqual({
      ok: false,
      reason: "cancelled",
      message: "Choose what to publish.",
    });

    expect(editor.publish).not.toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      { locales: ["en"], shared: false },
      "publish",
      { sharedPending: false }
    );
  });

  it("stores the form without publishing it before it opens the choice", async () => {
    api.publishParts.mockResolvedValue(SPANISH_TOO);
    const { result } = smartPublish();
    const order: string[] = [];
    open.mockImplementation(() => order.push("open"));
    const editor = host({
      unsaved: () => true,
      save: () => {
        order.push("save");
        return Promise.resolve(STORED);
      },
    });

    await expect(press(result.current, editor)).resolves.toEqual({
      ok: false,
      reason: "cancelled",
      message: "Choose what to publish.",
      stored: true,
    });

    expect(order).toEqual(["save", "open"]);
    expect(editor.publish).not.toHaveBeenCalled();
  });

  it("does not open the choice when the form could not be stored", async () => {
    api.publishParts.mockResolvedValue(SPANISH_TOO);
    const { result } = smartPublish();
    const failed = submitFailed(new Error("offline"));

    await expect(
      press(
        result.current,
        host({ unsaved: () => true, save: () => Promise.resolve(failed) })
      )
    ).resolves.toEqual(failed);

    expect(open).not.toHaveBeenCalled();
  });

  it("opens the choice with the shared fields chosen when they hold stored changes", async () => {
    const { result } = smartPublish({ sharedPending: true });

    await press(result.current, host());

    expect(open).toHaveBeenCalledWith(
      { locales: ["en"], shared: true },
      "publish",
      { sharedPending: true }
    );
  });

  it("counts unsaved edits to the shared fields, which the editor's read does not hold yet", async () => {
    const { result } = smartPublish();
    const editor = host({ unsaved: () => true, sharedEdited: () => true });

    await press(result.current, editor);

    expect(editor.save).toHaveBeenCalledTimes(1);
    expect(editor.publish).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      { locales: ["en"], shared: true },
      "publish",
      { sharedPending: true }
    );
  });

  it("publishes a document nobody reads yet in one click, whatever its shared fields hold", async () => {
    const { result } = smartPublish({ live: false });
    const editor = host({ unsaved: () => true, sharedEdited: () => true });

    await press(result.current, editor);

    expect(editor.publish).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the choice when the server cannot say what publishing every language would do", async () => {
    api.publishParts.mockRejectedValue(new Error("offline"));
    const { result } = smartPublish();
    const editor = host();

    await press(result.current, editor);

    expect(editor.publish).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("publishes as always where unsaved work can only be stored by publishing it", async () => {
    api.publishParts.mockResolvedValue(SPANISH_TOO);
    const { result } = smartPublish();
    const editor = host({ unsaved: () => true, save: undefined });

    await press(result.current, editor);

    expect(editor.publish).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("stores and publishes nothing when the editor moved while the server answered, coming back included", async () => {
    let answer: (result: PublishPartsResult) => void = () => {};
    api.publishParts.mockReturnValue(
      new Promise<PublishPartsResult>(resolve => {
        answer = resolve;
      })
    );
    const { result, rerender } = smartPublish();
    const editor = host({ unsaved: () => true });
    const pressed = press(result.current, editor);

    rerender(options({ currentLocale: "es" }));
    rerender(options());
    answer(ENGLISH_ALONE);

    await expect(pressed).resolves.toEqual(submitMoved);
    expect(editor.publish).not.toHaveBeenCalled();
    expect(editor.save).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not open the choice over the language moved to while the form was stored", async () => {
    api.publishParts.mockResolvedValue(SPANISH_TOO);
    const { result, rerender } = smartPublish();

    await press(
      result.current,
      host({
        unsaved: () => true,
        save: () => {
          rerender(options({ currentLocale: "es" }));
          return Promise.resolve(STORED);
        },
      })
    );

    expect(open).not.toHaveBeenCalled();
  });

  it("is not offered for a document in one language, or before the page has read it", () => {
    expect(smartPublish({ languages: ["en"] }).result.current).toBeUndefined();
    expect(smartPublish({ languages: [] }).result.current).toBeUndefined();
    expect(smartPublish({ target: undefined }).result.current).toBeUndefined();
  });
});
