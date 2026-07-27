import { describe, expect, it } from "vitest";

import { statusEventsFor } from "../status-events";

describe("statusEventsFor", () => {
  it("create-as-published emits only entry.published", () => {
    expect(
      statusEventsFor({ from: null, to: "published", isCreate: true })
    ).toEqual(["entry.published"]);
  });

  it("create-as-draft emits nothing", () => {
    expect(
      statusEventsFor({ from: null, to: "draft", isCreate: true })
    ).toEqual([]);
  });

  it("update draft->published emits published then status_changed", () => {
    expect(
      statusEventsFor({ from: "draft", to: "published", isCreate: false })
    ).toEqual(["entry.published", "entry.status_changed"]);
  });

  it("update null->published (was unset) emits published then status_changed", () => {
    expect(
      statusEventsFor({ from: null, to: "published", isCreate: false })
    ).toEqual(["entry.published", "entry.status_changed"]);
  });

  it("update published->draft emits unpublished then status_changed", () => {
    expect(
      statusEventsFor({ from: "published", to: "draft", isCreate: false })
    ).toEqual(["entry.unpublished", "entry.status_changed"]);
  });

  it("update draft->archived emits status_changed only", () => {
    expect(
      statusEventsFor({ from: "draft", to: "archived", isCreate: false })
    ).toEqual(["entry.status_changed"]);
  });

  it("no-op (from === to) emits nothing", () => {
    expect(
      statusEventsFor({ from: "published", to: "published", isCreate: false })
    ).toEqual([]);
  });
});
