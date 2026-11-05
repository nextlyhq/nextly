/**
 * The Content tab's prop groups, found by one list of finders: each group's
 * lead and the props it draws, in finder order.
 */
import { describe, expect, it } from "vitest";

import type { EditableProp } from "./inspector";
import { propGroupsOf } from "./prop-groups";

/** A prop as the inspector reads it, of a type and nothing else. */
const prop = (name: string, type: string): EditableProp => ({
  name,
  schema: { type },
  value: undefined,
  supported: true,
  options: [],
  offered: true,
  readOnly: false,
});

describe("the prop groups of a block", () => {
  it("finds a link and an image's source and alt text, each led by its first prop", () => {
    const groups = propGroupsOf([
      prop("mediaId", "media"),
      prop("src", "url"),
      prop("alt", "text"),
      prop("decorative", "checkbox"),
      prop("href", "url"),
      prop("caption", "text"),
    ]);
    expect(groups.map(group => [group.lead, [...group.drawn]])).toEqual([
      ["href", ["href"]],
      ["mediaId", ["mediaId", "src"]],
      ["alt", ["alt", "decorative"]],
    ]);
  });

  it("finds none for props no group names", () => {
    expect(propGroupsOf([prop("caption", "text"), prop("src", "url")])).toEqual(
      []
    );
  });
});
