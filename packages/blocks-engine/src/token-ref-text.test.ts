/**
 * The spelling of a token reference in stored text: what `tokenRef` writes,
 * found in a document serialized as `JSON.stringify` writes it, with or
 * without a scale, and not in text that only mentions the reference.
 */
import { describe, expect, it } from "vitest";

import { tokenRef, tokenRefText } from "./document";

const stored = (value: unknown): string => JSON.stringify(value);

describe("a token reference in stored text", () => {
  it("is found wherever a document holds the reference, scaled or not", () => {
    const text = tokenRefText("t-accent");
    expect(stored({ color: tokenRef("t-accent") })).toContain(text);
    expect(stored({ padding: tokenRef("t-accent", 0.75) })).toContain(text);
    // A scale written first, as an older writer may have, still holds it.
    expect(stored({ padding: { times: 2, $token: "t-accent" } })).toContain(
      text
    );
  });

  it("is not found for another identity, nor in text that only quotes it", () => {
    const text = tokenRefText("t-accent");
    expect(stored({ color: tokenRef("t-accent-2") })).not.toContain(text);
    expect(stored({ color: tokenRef("x-t-accent") })).not.toContain(text);
    // A heading whose words are the reference's spelling: escaped as text.
    expect(
      stored({ props: { text: JSON.stringify(tokenRef("t-accent")) } })
    ).not.toContain(text);
  });
});
