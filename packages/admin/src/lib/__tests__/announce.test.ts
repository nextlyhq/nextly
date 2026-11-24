import { afterEach, describe, expect, it } from "vitest";

import { announcerAt, mountAnnouncerRegion } from "../announce";

/**
 * A live region is heard only once assistive technology has registered it, so a screen that will
 * announce puts its region in the page, empty, before the first message is written into it: a
 * region created and filled in the same task can stay silent for that first message.
 */
describe("announcer regions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("mounts a region in the page, empty, before anything is said", () => {
    mountAnnouncerRegion("announce-test-early");

    const region = document.getElementById("announce-test-early");
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");
  });

  it("says a message into the region it mounted, at once", () => {
    mountAnnouncerRegion("announce-test-now");
    const say = announcerAt("announce-test-now");

    say("Approved");

    expect(document.getElementById("announce-test-now")?.textContent).toBe(
      "Approved"
    );
  });
});
