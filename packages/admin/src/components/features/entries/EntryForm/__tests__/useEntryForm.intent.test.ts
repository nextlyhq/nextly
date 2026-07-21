/**
 *
 * The intent → payload mapping is the core behavioural change in PR-3:
 * each named intent (Save Draft / Publish / Save changes / Unpublish)
 * maps to a deterministic wire payload. This locks the contract so the
 * EntrySystemHeader buttons keep emitting the right shape.
 */
import { describe, it, expect } from "vitest";

import { mapIntentToPayload } from "../useEntryForm";

const RAW = { title: "Hello", body: "Body content", customField: 42 };

describe("mapIntentToPayload", () => {
  it("save-draft → spreads rawData and forces status=draft", () => {
    expect(mapIntentToPayload(RAW, "save-draft")).toEqual({
      ...RAW,
      status: "draft",
    });
  });

  it("publish → spreads rawData and forces status=published", () => {
    expect(mapIntentToPayload(RAW, "publish")).toEqual({
      ...RAW,
      status: "published",
    });
  });

  it("save-changes → spreads rawData and re-asserts status=published", () => {
    // Why: save-changes is for an already-published entry; we still
    // include status so a partial PATCH writer can't accidentally drop
    // the lifecycle column on a sparse update path.
    expect(mapIntentToPayload(RAW, "save-changes")).toEqual({
      ...RAW,
      status: "published",
    });
  });

  it("unpublish → status only, no other fields", () => {
    // Why: confirm-modal misclick safety. Unpublish removes the entry
    // from the public site immediately; we don't want pending dirty
    // edits to ride along. Matches Payload's unpublish pattern.
    expect(mapIntentToPayload(RAW, "unpublish")).toEqual({
      status: "draft",
    });
  });

  it("undefined intent → passes rawData through unchanged", () => {
    // Why: collections without drafts use a single Save button that
    // submits with whatever status the server already has. The mapping
    // must not inject a status field in that case.
    expect(mapIntentToPayload(RAW, undefined)).toEqual(RAW);
  });

  it("does not mutate the input rawData object", () => {
    const input = { ...RAW };
    mapIntentToPayload(input, "publish");
    expect(input).toEqual(RAW);
  });

  // A blank optional field submits as "". Storing that literal would make an
  // optional unique column reject the second blank entry, and would split
  // "empty" into two representations the API and migrations never produce.
  it("sends a blank optional field as null rather than an empty string", () => {
    expect(
      mapIntentToPayload({ title: "Hi", subtitle: "" }, undefined)
    ).toEqual({ title: "Hi", subtitle: null });
  });

  // Falsy values that are not "" are real user input and must survive intact.
  it("leaves 0, false and [] alone", () => {
    const input = { count: 0, featured: false, tags: [], note: "" };
    expect(mapIntentToPayload(input, undefined)).toEqual({
      count: 0,
      featured: false,
      tags: [],
      note: null,
    });
  });
});
