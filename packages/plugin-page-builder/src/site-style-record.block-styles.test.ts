import type { NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { withCoreLooks } from "./core-looks";
import { checkStoredClasses } from "./site-style-record";
import { classOverrideOf } from "./site-style";

/*
 * The block style marks a site stores: ★ (`starred`, the style a block of its
 * type has until another is picked) and `hidden` (a built-in style not
 * offered to blocks), and the rule that a built-in block style keeps its name.
 */

const policy = { defaults: withCoreLooks(undefined) };
const configured = policy.defaults.classes ?? [];

function builtIn(id: string): NamedClass {
  const found = configured.find(entry => entry.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

const outline = builtIn("look:core/button:outline");
const text = builtIn("look:core/button:text");
const primary = builtIn("look:core/button:primary");

/** A block style the site made. */
const ghost: NamedClass = {
  id: "look-ghost",
  slug: "button-ghost",
  label: "Ghost",
  orderIndex: 10,
  blockType: "core/button",
  styles: { base: { base: { backgroundColor: "transparent" } } },
};

const issuesOf = (stored: readonly unknown[]) =>
  checkStoredClasses(stored, policy).issues;

describe("an override that only moves ★ or hides a built-in", () => {
  it("is kept: a comparison blind to the marks would drop it on save", () => {
    const starred = { ...outline, starred: true as const };
    const hidden = { ...text, hidden: true as const };
    expect(classOverrideOf(configured, [starred])).toEqual([starred]);
    expect(classOverrideOf(configured, [hidden])).toEqual([hidden]);
  });
});

describe("the stored ★ and hidden marks", () => {
  it("are accepted on block styles, built-in or the site's own", () => {
    // The control for every refusal below.
    expect(issuesOf([{ ...outline, starred: true }])).toEqual([]);
    expect(issuesOf([{ ...text, hidden: true }])).toEqual([]);
    expect(issuesOf([{ ...ghost, starred: true }])).toEqual([]);
  });

  it("are true or absent, never false or anything else", () => {
    expect(issuesOf([{ ...outline, starred: false }])).not.toEqual([]);
    expect(issuesOf([{ ...outline, starred: "yes" }])).not.toEqual([]);
    expect(issuesOf([{ ...text, hidden: false }])).not.toEqual([]);
  });

  it("refuse ★ on a block's own style, which is the default already", () => {
    expect(issuesOf([{ ...primary, starred: true }])).not.toEqual([]);
  });

  it("refuse either mark on a shared style, which belongs to no block type", () => {
    const card = { id: "c-card", slug: "card", orderIndex: 0, styles: {} };
    expect(issuesOf([{ ...card, starred: true }])).not.toEqual([]);
    expect(issuesOf([{ ...card, hidden: true }])).not.toEqual([]);
  });

  it("refuse a second ★ for one block type", () => {
    expect(
      issuesOf([
        { ...outline, starred: true },
        { ...ghost, starred: true },
      ])
    ).toEqual([
      'Only one block style per block type can be the default ★: "core/button" has 2.',
    ]);
  });
});

describe("a built-in block style's name", () => {
  it("can't be changed: a block or a plugin names it in code", () => {
    expect(issuesOf([{ ...text, label: "Link" }])).toEqual([
      'classes[0] is a built-in block style, "Text", so it can\'t be renamed.',
    ]);
    expect(issuesOf([{ ...text, slug: "button-link" }])).not.toEqual([]);
  });

  it("is kept while its styles are edited, and a site's own style may be renamed", () => {
    const edited = {
      ...text,
      styles: { base: { base: { color: "#123456" } } },
    };
    expect(issuesOf([edited])).toEqual([]);
    expect(issuesOf([{ ...ghost, label: "Ghost outline" }])).toEqual([]);
  });
});
