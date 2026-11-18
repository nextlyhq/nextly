/**
 * A stored tokens section without some variables, what each removal took
 * out, and the section with them put back: the halves of a clean-up's step.
 */
import { describe, expect, it } from "vitest";

import {
  takenFrom,
  withoutVariables,
  withTakenBack,
} from "./variables-without";

const entry = (id: string, light = "#123456") => ({
  id,
  name: `color.${id.slice(2)}`,
  kind: "color",
  values: { light },
});

const SECTION = {
  prefix: "site",
  tokens: [entry("t-a"), entry("t-b"), { name: 42 }, entry("t-c")],
  order: ["t-c", "t-b", "t-a"],
};

describe("what a removal takes out, and putting it back", () => {
  it("says each entry taken, as stored, with its place in the list and in the order", () => {
    expect(takenFrom(SECTION, new Set(["t-b", "t-c"]))).toEqual([
      { id: "t-b", entry: entry("t-b"), at: 1, orderAt: 1 },
      { id: "t-c", entry: entry("t-c"), at: 3, orderAt: 0 },
    ]);
  });

  it("says a colour the order does not name has no place in it", () => {
    expect(
      takenFrom({ tokens: [entry("t-a")] }, new Set(["t-a"]))
    ).toEqual([{ id: "t-a", entry: entry("t-a"), at: 0, orderAt: null }]);
  });

  it("puts back removals made one at a time, latest first, exactly where they were", () => {
    const first = new Set(["t-c"]);
    const second = new Set(["t-a"]);
    const taken = [
      ...takenFrom(SECTION, first),
      ...takenFrom(withoutVariables(SECTION, first), second),
    ];
    const after = withoutVariables(withoutVariables(SECTION, first), second);
    expect(after).toEqual({
      prefix: "site",
      tokens: [entry("t-b"), { name: 42 }],
      order: ["t-b"],
    });
    expect(withTakenBack(after, taken)).toEqual(SECTION);
  });

  it("puts back the entry as the server took it, not an older copy", () => {
    const now = { tokens: [entry("t-a", "#0000ff")], order: ["t-a"] };
    const taken = takenFrom(now, new Set(["t-a"]));
    expect(
      withTakenBack(withoutVariables(now, new Set(["t-a"])), taken)
    ).toEqual(now);
  });

  it("leaves a variable that is back already where it is", () => {
    const taken = takenFrom(SECTION, new Set(["t-b"]));
    expect(withTakenBack(SECTION, taken)).toEqual(SECTION);
  });
});
