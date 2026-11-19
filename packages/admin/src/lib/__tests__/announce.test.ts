import { afterEach, describe, expect, it, vi } from "vitest";

import { announcerAt } from "../announce";

/**
 * A live region is heard only once assistive technology has registered it, so it must be in the
 * page, empty, before the first message is written into it: a region created and filled in the
 * same task can stay silent for that first message.
 */
describe("announcerAt", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("puts its region in the page when it is made, before anything is said", () => {
    announcerAt("announce-test-early");

    const region = document.getElementById("announce-test-early");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");
  });

  it("writes into a region it has to create only after the region is in the page", () => {
    vi.useFakeTimers();
    const say = announcerAt("announce-test-late");
    // The region went away (a page that cleared the body), so saying makes it again.
    document.getElementById("announce-test-late")?.remove();

    say("Submitted for review");

    const region = document.getElementById("announce-test-late");
    expect(region?.textContent).toBe("");
    vi.runAllTimers();
    expect(region?.textContent).toBe("Submitted for review");
  });

  it("says a message into a region already in the page at once", () => {
    const say = announcerAt("announce-test-now");

    say("Approved");

    expect(document.getElementById("announce-test-now")?.textContent).toBe(
      "Approved"
    );
  });
});
