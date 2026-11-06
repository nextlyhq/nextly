import { describe, expect, it } from "vitest";

import { translationStaysOn } from "./fields-leaving-on-reload";

// A reload that stops after its apply publishes nothing, so the runtime keeps the fields it had
// until it is reloaded: the message says how.
describe("translationStaysOn", () => {
  it("names the entities and says to restart the dev server or save again", () => {
    const message = translationStaysOn(["posts", "pages"]);
    expect(message).toContain("Translation stays on for posts, pages");
    expect(message).toContain(
      "Restart the dev server (or save the collection again) to reload its fields"
    );
    expect(message).toContain("the content is intact where it is");
  });
});
