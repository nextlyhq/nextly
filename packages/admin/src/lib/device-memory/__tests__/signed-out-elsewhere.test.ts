/**
 * A tab told by another that the person signed out forgets them itself: its
 * own session storage, which no other tab can reach, and what it holds in
 * memory for this tab, before its listener moves it to the sign-in page. It
 * tells no one else: the tab that signed out already has.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  onSignedOutElsewhere,
  REMEMBERED_BRANDING_KEY,
  recallTabPreference,
  rememberBranding,
  rememberSignedInHere,
  rememberTabPreference,
  resetDeviceMemoryForTests,
} from "../device-memory";

const CHANNEL = "nextly:admin:device-memory";
const PUT_OFF = "nextly:recovery-not-now:author-1|posts/e1";

let stop = () => {};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetDeviceMemoryForTests();
});

afterEach(() => stop());

/** Another tab's word that the person signed out, and its delivery. */
async function anotherTabSignsOut(): Promise<void> {
  const sender = new BroadcastChannel(CHANNEL);
  sender.postMessage({ type: "signed-out" });
  sender.close();
  await new Promise(resolve => setTimeout(resolve, 50));
}

describe("a tab told another tab signed out", () => {
  it("forgets the person in its own session storage before its listener runs", async () => {
    rememberTabPreference(PUT_OFF, "point-1");
    rememberBranding({ logoText: "Acme" });
    let keysWhenTold: string[] | null = null;
    stop = onSignedOutElsewhere(() => {
      keysWhenTold = Object.keys(window.sessionStorage);
    });

    await anotherTabSignsOut();

    expect(keysWhenTold).toEqual([]);
    expect(recallTabPreference(PUT_OFF)).toBeNull();
    // The site's public branding stays, as on any sign-out.
    expect(window.localStorage.getItem(REMEMBERED_BRANDING_KEY)).not.toBeNull();
  });

  it("tells no other tab in turn", async () => {
    const heard: unknown[] = [];
    const listener = new BroadcastChannel(CHANNEL);
    listener.onmessage = event => heard.push(event.data);
    // A tab that was signed in: one that would tell the others of a session
    // it saw end itself.
    rememberSignedInHere();
    stop = onSignedOutElsewhere(() => {});

    await anotherTabSignsOut();

    // Only the first word: none sent back by the tab that was told.
    expect(heard).toEqual([{ type: "signed-out" }]);
    listener.close();
  });
});
