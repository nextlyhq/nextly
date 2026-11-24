/**
 * What an editor's Publish stores and publishes through. The plausible broken versions: the save
 * before the choice publishes (a live document re-asserted as published), takes a live language
 * down (saved as a draft), or is offered where every save goes live; and a page with no smart
 * Publish losing its Publish.
 */
import { describe, expect, it, vi } from "vitest";

import {
  smartPublishHandler,
  type SmartPublishEditor,
} from "../smart-publish-handler";
import type { SmartPublishHost } from "../useSmartPublish";

const STORED = { ok: true as const, item: { id: "post-1" } };

/** A form that started from a title and a price, and holds `current` now. */
function formHolding(current: Record<string, unknown>) {
  return {
    getValues: () => current,
    formState: { defaultValues: { title: "Hello", price: 10 } },
  };
}

function editor(over: Partial<SmartPublishEditor> = {}) {
  return {
    submit: vi.fn(() => Promise.resolve(STORED)),
    published: true,
    draftsEnabled: true,
    unsaved: () => true,
    form: formHolding({ title: "Hello", price: 10 }),
    fields: [
      { type: "text", name: "title", localized: true },
      { type: "number", name: "price" },
    ],
    localized: true,
    ...over,
  };
}

/** What the page's smart Publish is given when Publish runs. */
async function hostGiven(with_: SmartPublishEditor): Promise<SmartPublishHost> {
  const given: SmartPublishHost[] = [];
  const { onPublish } = smartPublishHandler(host => {
    given.push(host);
    return Promise.resolve({ ok: true });
  }, with_);
  await onPublish?.();
  expect(given).toHaveLength(1);
  return given[0];
}

describe("the editor's Publish, handed to the document's actions", () => {
  it("publishes through the editor's own submit", async () => {
    const form = editor();
    const host = await hostGiven(form);

    await host.publish();

    expect(form.submit).toHaveBeenCalledWith(undefined, "publish");
  });

  it("stores a live language's work as its working draft", async () => {
    const form = editor();
    const host = await hostGiven(form);

    await host.save?.();

    expect(form.submit).toHaveBeenCalledWith(undefined, "save-working-draft");
  });

  it("stores a language that is not live as a draft", async () => {
    const form = editor({ published: false });
    const host = await hostGiven(form);

    await host.save?.();

    expect(form.submit).toHaveBeenCalledWith(undefined, "save-draft");
  });

  it("has no save that leaves a live document alone where it keeps no drafts", async () => {
    const host = await hostGiven(editor({ draftsEnabled: false }));

    expect(host.save).toBeUndefined();
  });

  it("says whether the unsaved work changes a shared field, as the form stands at the press", async () => {
    const values = { title: "Hello again", price: 10 };
    const host = await hostGiven(editor({ form: formHolding(values) }));

    expect(host.sharedEdited()).toBe(false);
    values.price = 12;
    expect(host.sharedEdited()).toBe(true);
  });

  it("leaves Publish as it is where the page has no smart one", () => {
    expect(smartPublishHandler(undefined, editor())).toEqual({});
  });
});
