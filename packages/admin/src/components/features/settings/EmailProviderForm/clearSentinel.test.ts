/**
 * The value a select uses to mean "nothing chosen".
 *
 * A select control cannot hold an empty string as an item value, so clearing
 * an optional field needs a stand-in — and that stand-in has to be a string no
 * real choice uses, or picking a real choice is read as clearing the field.
 *
 * The choices it has to avoid are not only the descriptor's. A stored value
 * the descriptor no longer offers is rendered as an item of its own, so it is
 * a choice on screen while being absent from the options list the sentinel is
 * derived from.
 */

import { describe, expect, it } from "vitest";

import { clearSelectionValue } from "./ProviderConfigFields";

describe("the sentinel a select clears with", () => {
  it("avoids a legacy choice that happens to be the default sentinel", () => {
    // A provider that stored `__nextly_none__` under an option it has since
    // dropped. The item rendered for it would carry the same value as "None",
    // so choosing the operator's own stored value clears the field instead —
    // the one option they cannot pick is the one they already have.
    const options = [{ value: "eu" }];
    const legacy = "__nextly_none__";

    expect(clearSelectionValue([...options, { value: legacy }])).not.toBe(
      legacy
    );
  });

  it("still avoids the descriptor's own values", () => {
    // The control for the case above: widening what it avoids must not stop it
    // avoiding what it already did.
    expect(
      clearSelectionValue([{ value: "__nextly_none__" }, { value: "eu" }])
    ).not.toBe("__nextly_none__");
  });

  it("uses the plain sentinel when nothing collides", () => {
    // The other control. A derivation that always appended would still satisfy
    // both assertions above while making the value unrecognisable.
    expect(clearSelectionValue([{ value: "eu" }, { value: "us" }])).toBe(
      "__nextly_none__"
    );
  });
});
