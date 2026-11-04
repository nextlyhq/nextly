/**
 * The link group's rules, without a panel.
 *
 * - Which props make up a block's link: found by name and type, so an image's
 *   `src` is no link, and a sibling joins only in the type its control writes.
 * - What kind of address typed text is, and what "Use as a URL" stores.
 * - The `rel` flags: each added or taken out with every other token kept.
 * - What a pick and a clear write: an address clears an entry reference and
 *   an entry clears the address, and clearing takes the target and rel too.
 */
import type { PropSchema } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  addressFor,
  clearChanges,
  linkGroupOf,
  linkKindOf,
  linkValueOf,
  pickChanges,
  relOthers,
  relWith,
  withChanges,
} from "./link-group";

/** A block's props as the inspector lists them, from a schema record. */
function propsOf(
  schema: Record<string, PropSchema>
): Array<{ name: string; schema: PropSchema }> {
  return Object.entries(schema).map(([name, each]) => ({
    name,
    schema: each,
  }));
}

const TARGET: PropSchema = {
  type: "select",
  options: ["_self", "_blank"],
};

// The core blocks' link props, as `blocks-react` declares them.
const HEADING = propsOf({
  text: { type: "text" },
  href: { type: "url" },
  target: TARGET,
  rel: { type: "text" },
});
const BUTTON = propsOf({
  label: { type: "text" },
  href: { type: "url" },
  entryCollection: { type: "text" },
  entryId: { type: "text" },
  target: TARGET,
  rel: { type: "text" },
  type: { type: "select", options: ["button", "submit", "reset"] },
});
const BOX = propsOf({
  as: { type: "select", options: ["div"] },
  link: { type: "url" },
});

describe("linkGroupOf", () => {
  it("groups a heading's link with its target and rel", () => {
    const group = linkGroupOf(HEADING);
    expect(group).toMatchObject({ link: "href", target: "target", rel: "rel" });
    expect(group?.entry).toBeUndefined();
    expect([...(group?.drawn ?? [])].sort()).toEqual(["href", "rel", "target"]);
  });

  it("groups a button's entry reference too, and leaves its other props out", () => {
    const group = linkGroupOf(BUTTON);
    expect(group?.entry).toEqual({
      collection: "entryCollection",
      id: "entryId",
    });
    expect([...(group?.drawn ?? [])].sort()).toEqual([
      "entryCollection",
      "entryId",
      "href",
      "rel",
      "target",
    ]);
  });

  it("finds a box's link by the name `link`", () => {
    const group = linkGroupOf(BOX);
    expect(group?.link).toBe("link");
    expect([...(group?.drawn ?? [])]).toEqual(["link"]);
  });

  it("finds no link in a url prop under another name", () => {
    expect(
      linkGroupOf(propsOf({ src: { type: "url" }, alt: { type: "text" } }))
    ).toBeUndefined();
    // Named `href` but not a url: not a link either.
    expect(linkGroupOf(propsOf({ href: { type: "text" } }))).toBeUndefined();
  });

  it("folds a target into the switch only when it is exactly this tab or a new tab", () => {
    const withTarget = (options: string[]) =>
      linkGroupOf(
        propsOf({
          href: { type: "url" },
          target: { type: "select", options },
        })
      )?.target;
    expect(withTarget(["_self", "_blank"])).toBe("target");
    expect(withTarget(["_blank", "_self"])).toBe("target");
    // A choice the switch could not show keeps the target's own menu.
    expect(withTarget(["_self", "_blank", "_parent"])).toBeUndefined();
    expect(withTarget(["_blank", "preview"])).toBeUndefined();
    expect(withTarget(["_blank"])).toBeUndefined();
  });

  it("leaves a sibling out when its type is not one the group writes", () => {
    const group = linkGroupOf(
      propsOf({
        href: { type: "url" },
        // A target that can never be `_blank` is not a new-tab switch.
        target: { type: "select", options: ["_self", "_parent"] },
        rel: { type: "select", options: ["nofollow"] },
        // Half an entry reference cannot be completed by a pick.
        entryCollection: { type: "text" },
      })
    );
    expect([...(group?.drawn ?? [])]).toEqual(["href"]);
  });
});

describe("linkKindOf", () => {
  it("recognises each kind of address by its shape", () => {
    expect(linkKindOf("https://example.com")).toBe("web");
    expect(linkKindOf("HTTP://example.com")).toBe("web");
    expect(linkKindOf("//cdn.example.com/x")).toBe("web");
    expect(linkKindOf("/pricing")).toBe("path");
    expect(linkKindOf("mailto:hi@example.com")).toBe("mail");
    expect(linkKindOf("tel:+1555")).toBe("phone");
    expect(linkKindOf("#faq")).toBe("anchor");
    expect(linkKindOf("  /about  ")).toBe("path");
  });

  it("reads a word as a search, not an address", () => {
    expect(linkKindOf("pricing")).toBeUndefined();
    expect(linkKindOf("example.com")).toBeUndefined();
    expect(linkKindOf("https://")).toBeUndefined();
    expect(linkKindOf("#")).toBeUndefined();
    expect(linkKindOf("mailto:")).toBeUndefined();
  });
});

describe("addressFor", () => {
  it("stores typed text as typed, and a bare host as a web address", () => {
    expect(addressFor(" /pricing ")).toBe("/pricing");
    expect(addressFor("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(addressFor("example.com/docs")).toBe("https://example.com/docs");
    expect(addressFor("pric")).toBe("pric");
  });

  it("offers nothing for empty text or an address the page refuses", () => {
    expect(addressFor("   ")).toBeUndefined();
    expect(addressFor("javascript:alert(1)")).toBeUndefined();
  });
});

describe("rel flags", () => {
  it("adds a flag after the stored tokens, keeping the ones it does not name", () => {
    expect(relWith("me noopener", "nofollow", true)).toBe(
      "me noopener nofollow"
    );
    expect(relWith(undefined, "ugc", true)).toBe("ugc");
    // Already there, in another case: kept once.
    expect(relWith("NoFollow me", "nofollow", true)).toBe("me nofollow");
  });

  it("takes a flag out, keeping every other token, and empties to nothing", () => {
    expect(relWith("me nofollow sponsored", "nofollow", false)).toBe(
      "me sponsored"
    );
    expect(relWith("nofollow", "nofollow", false)).toBeUndefined();
  });

  it("lists the stored tokens none of the checkboxes names", () => {
    expect(relOthers("nofollow me  external UGC")).toEqual(["me", "external"]);
    expect(relOthers(undefined)).toEqual([]);
  });
});

describe("what a pick writes", () => {
  const heading = linkGroupOf(HEADING);
  const button = linkGroupOf(BUTTON);
  if (heading === undefined || button === undefined) {
    throw new Error("the fixtures declare links");
  }

  it("stores an address on a heading, and refuses an entry it cannot hold", () => {
    expect(pickChanges(heading, { kind: "address", href: "/pricing" })).toEqual(
      { href: "/pricing" }
    );
    expect(
      pickChanges(heading, { kind: "entry", collection: "pages", id: "1" })
    ).toBeUndefined();
  });

  it("stores an entry on a button and clears its address", () => {
    const changes = pickChanges(button, {
      kind: "entry",
      collection: "landing",
      id: "e-1",
    });
    expect(
      withChanges({ label: "Go", href: "/old", rel: "me" }, changes ?? {})
    ).toEqual({
      label: "Go",
      entryCollection: "landing",
      entryId: "e-1",
      rel: "me",
    });
  });

  it("stores an address on a button and clears its entry", () => {
    const changes = pickChanges(button, { kind: "address", href: "/pricing" });
    expect(
      withChanges(
        { label: "Go", entryCollection: "landing", entryId: "e-1" },
        changes ?? {}
      )
    ).toEqual({ label: "Go", href: "/pricing" });
  });

  it("clears the target and rel with the link", () => {
    expect(
      withChanges(
        {
          label: "Go",
          href: "/x",
          target: "_blank",
          rel: "nofollow",
          entryCollection: "landing",
          entryId: "e-1",
          type: "button",
        },
        clearChanges(button)
      )
    ).toEqual({ label: "Go", type: "button" });
  });
});

describe("linkValueOf", () => {
  const button = linkGroupOf(BUTTON);
  if (button === undefined) throw new Error("the fixture declares a link");

  it("reads an entry reference before an address, as the button renders", () => {
    expect(
      linkValueOf(button, {
        href: "/x",
        entryCollection: "landing",
        entryId: "e-1",
      })
    ).toEqual({ kind: "entry", collection: "landing", id: "e-1" });
    expect(linkValueOf(button, { href: " /x " })).toEqual({
      kind: "address",
      href: "/x",
    });
    // An address the page would never follow is no link, by the same rule
    // the renderer and the inspector's `onlyWithout` read.
    expect(linkValueOf(button, { href: "javascript:alert(1)" })).toEqual({
      kind: "none",
    });
    // Half a reference is no entry; a blank address is no link.
    expect(
      linkValueOf(button, { entryCollection: "landing", href: "  " })
    ).toEqual({ kind: "none" });
  });
});
