import { describe, expect, it } from "vitest";

import { MAX_NAMED_CLASSES } from "@nextlyhq/blocks-engine";

import {
  checkStoredBreakpoints,
  checkStoredClasses,
  checkStoredFonts,
  checkStoredTokens,
  readSiteStyleRecord,
  unreadableStoredFonts,
} from "./site-style-record";

/** One shape-valid stored token. */
function token(name: string, light: string, dark?: string) {
  return {
    name,
    kind: "color",
    values: { light, ...(dark === undefined ? {} : { dark }) },
  };
}

/** A host no site in these tests allows. */
const TRACKER = "https://tracker.example/p.png";

describe("checkStoredTokens", () => {
  it("reports nothing for an absent section", () => {
    expect(checkStoredTokens(undefined)).toEqual({ issues: [] });
    expect(checkStoredTokens(null)).toEqual({ issues: [] });
  });

  it("refuses a section that is not a token set at all", () => {
    const result = checkStoredTokens([token("color.primary", "#111111")]);
    expect(result.value).toBeUndefined();
    expect(result.issues).toHaveLength(1);
  });

  it("accepts a well-formed set, dark values included", () => {
    const result = checkStoredTokens({
      tokens: [token("color.primary", "#111111", "#eeeeee")],
      darkMode: "media",
    });
    expect(result.issues).toEqual([]);
    expect(result.value?.tokens[0]?.values.dark).toBe("#eeeeee");
    expect(result.value?.darkMode).toBe("media");
  });

  it("carries both extension records through, because this shape is a WHITELIST", () => {
    /*
     * The narrowed token is rebuilt field by field, so a field this list omits
     * is dropped by a save that reports success — the quietest way to lose
     * data there is. `extensions` holds what another tool wrote and
     * `unreadExtension` what a newer build of this one did, and both exist for
     * the same reason: an export has to carry what this build cannot read.
     *
     * Shape only, as the rest of this list is: what is inside came from a
     * design-token file and this layer has no opinion on it.
     */
    const result = checkStoredTokens({
      tokens: [
        {
          ...token("color.primary", "#111111"),
          extensions: { "com.figma": { anything: "at all" } },
          unreadExtension: { future: "keep-me" },
        },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.value?.tokens[0]?.extensions).toEqual({
      "com.figma": { anything: "at all" },
    });
    expect(result.value?.tokens[0]?.unreadExtension).toEqual({
      future: "keep-me",
    });
  });

  it("REFUSES a malformed extension record rather than narrowing it away", () => {
    /*
     * Both fields hold data that exists to survive a round trip, and storage
     * accepts a write whenever this reports no issues. Dropping a malformed one
     * quietly would answer the author with a successful save that discarded
     * exactly what they were trying to keep — the loudest possible failure
     * reported as the quietest.
     *
     * Both fields, because the branch is the same one: a fix naming only the
     * field a report happened to arrive about leaves the other saying nothing.
     */
    for (const field of ["extensions", "unreadExtension"]) {
      const result = checkStoredTokens({
        tokens: [
          { ...token("color.primary", "#111111"), [field]: "not-a-record" },
        ],
      });
      expect(result.issues, field).toHaveLength(1);
      expect(result.value?.tokens ?? [], field).toEqual([]);
    }
  });

  it("reports a shape-broken entry AND excludes it from the narrowed value", () => {
    const result = checkStoredTokens({
      tokens: [token("color.primary", "#111111"), { name: "color.broken" }],
    });
    expect(result.issues).toHaveLength(1);
    expect(result.value?.tokens.map(t => t.name)).toEqual(["color.primary"]);
  });

  // A token's identity is what a document's `$token` and the emitted custom
  // property key off, so a save that does not carry it forward undoes the
  // guarantee the field exists for — silently, and in the worst direction: the
  // rename appears to have worked.
  describe("a token's stable identity", () => {
    it("carries an id through the write", () => {
      const result = checkStoredTokens({
        tokens: [{ ...token("color.brand", "#111111"), id: "color.primary" }],
      });

      expect(result.issues).toEqual([]);
      expect(result.value?.tokens[0]?.id).toBe("color.primary");
    });

    it("REFUSES an id that is not a string rather than dropping it", () => {
      // Dropping is what the allowlist did to every unrecognised field, and it
      // is the shape of the defect this repairs: the write succeeds, the author
      // is told nothing, and the identity is gone.
      const result = checkStoredTokens({
        tokens: [{ ...token("color.brand", "#111111"), id: 42 }],
      });

      expect(result.issues).toHaveLength(1);
      expect(result.value?.tokens).toEqual([]);
    });

    it("reports the ENGINE's refusal of an id that cannot become a property", () => {
      // Grammar is not re-checked here. The emitter already holds an id to the
      // token-name grammar because it reaches CSS by the same route, and this
      // gate refuses on the emitter's whole report — so carrying the field is
      // what makes that check reachable, and a second one here would be a
      // second answer to the same question.
      //
      // Reported, not excluded, and that is this module's stated split: a
      // shape the checker cannot type is dropped from `value`, while a
      // VALUE-level refusal is reported and left in place, because the engine
      // already drops that entry per-token at compile time. The issue is what
      // matters — `refusing` in site-style-storage turns any issue into a
      // rejected write, so this never reaches storage.
      const result = checkStoredTokens({
        tokens: [{ ...token("color.brand", "#111111"), id: "not a name!" }],
      });

      expect(result.issues.join(" ")).toContain("id that is not a token name");
    });

    it("REFUSES a new token that takes a renamed token's identity", () => {
      // The identity a rename freezes stays claimed, and the name it freed does
      // not carry the claim with it. So a new token named `color.primary` and a
      // renamed token still holding `color.primary` as its id both key off one
      // custom property, and one of them silently loses — the value every
      // document referencing that identity resolves to.
      //
      // The engine anticipates this and cannot see it from here: the gate emits
      // through `resolveSiteTokens`, which is a Map on identity, so the pair is
      // deduplicated before `emitTokenBlocks` is handed the set. Judging the set
      // AS AUTHORED is what puts the two in front of the check at once.
      const result = checkStoredTokens({
        tokens: [
          { ...token("color.brand", "#111111"), id: "color.primary" },
          token("color.primary", "#222222"),
        ],
      });

      expect(result.issues.join(" ")).toContain(
        'both become "--site-color-primary"'
      );
    });

    it("still judges an entry SHADOWED by a later one sharing its identity", () => {
      // The same inertness as the case above, reached from the other side: here
      // both entries are shape-valid and the FIRST is malformed at the value
      // level, so resolving keeps only the second and the first's bad name is
      // never put to the emitter. The two differ in which entry is lost and in
      // which message goes missing, so the shadowed case is pinned separately
      // rather than left implied by the collision one.
      const result = checkStoredTokens({
        tokens: [
          { ...token("not a name!", "#111111"), id: "color.primary" },
          { ...token("color.brand", "#222222"), id: "color.primary" },
        ],
      });

      expect(result.issues.join(" ")).toContain("is not a token name");
    });

    it("leaves a token with no id exactly as it was", () => {
      // Every token stored before the field existed relies on the name BEING
      // the identity, so an absent id must stay absent rather than becoming one.
      const result = checkStoredTokens({
        tokens: [token("color.primary", "#111111")],
      });

      expect(result.issues).toEqual([]);
      expect(result.value?.tokens[0]).not.toHaveProperty("id");
    });
  });

  it("reports what the engine's emitter refuses: a value that would fetch", () => {
    const result = checkStoredTokens({
      tokens: [token("color.primary", "url(https://evil.example/a.png)")],
    });
    // The message is the engine's own — the emitter is the validator.
    expect(result.issues.join(" ")).toContain("would load a file");
  });

  it("reports a name that cannot become a custom property", () => {
    const result = checkStoredTokens({
      tokens: [token("color}body{", "#111111")],
    });
    expect(result.issues.join(" ")).toContain("is not a token name");
  });
});

describe("checkStoredFonts", () => {
  it("accepts a self-hosted face", () => {
    const result = checkStoredFonts([
      {
        family: "Geist",
        src: [{ url: "/fonts/geist.woff2", format: "woff2" }],
      },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.value).toHaveLength(1);
  });

  it("carries the engine's refusal of a remote source to the writer", () => {
    const result = checkStoredFonts([
      { family: "Sneaky", src: [{ url: "https://cdn.example/f.woff2" }] },
    ]);
    expect(result.issues.join(" ")).toContain("another server");
  });

  it("refuses an entry that is not a face shape", () => {
    const result = checkStoredFonts([{ family: "NoSrc" }]);
    expect(result.issues).toHaveLength(1);
    expect(result.value).toEqual([]);
  });
});

describe("unreadableStoredFonts", () => {
  it("names the row the reader drops, which the read value cannot report", () => {
    /*
     * A narrowed list and a complete one are the same shape, so a writer
     * appending to `readSiteStyleRecord`'s value has no way to see that a row
     * is missing from the list it is about to save back over.
     */
    const doc = {
      fonts: [
        { family: "Geist", src: [{ url: "/fonts/geist.woff2" }] },
        { family: "Legacy", source: "/fonts/legacy.woff" },
      ],
    };

    expect(unreadableStoredFonts(doc)).toEqual(["fonts[1]"]);
    // The reader's own value, for the contrast this exists to supply.
    expect(readSiteStyleRecord(doc).fonts).toHaveLength(1);
  });

  it("says nothing about a row the reader KEEPS but the engine refuses", () => {
    /*
     * The discriminating case. A remote `src` is a value-level refusal: the row
     * is typed, kept, and reported by the checker — so it blocks a save without
     * ever being dropped, and a writer that treated every issue as a reason to
     * refuse would stop an author fixing exactly this.
     */
    const doc = {
      fonts: [
        { family: "Sneaky", src: [{ url: "https://cdn.example/f.woff2" }] },
      ],
    };

    expect(unreadableStoredFonts(doc)).toEqual([]);
    expect(checkStoredFonts(doc.fonts).issues.length).toBeGreaterThan(0);
  });

  it("reports nothing for a document with no fonts section at all", () => {
    expect(unreadableStoredFonts({})).toEqual([]);
    expect(unreadableStoredFonts(undefined)).toEqual([]);
  });
});

describe("checkStoredClasses", () => {
  const usable = {
    id: "c1",
    slug: "card",
    orderIndex: 0,
    styles: { base: { base: { color: "#111111" } } },
  };

  it("accepts a usable class", () => {
    const result = checkStoredClasses([usable]);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual([usable]);
  });

  it("refuses a slug CSS cannot carry, with the engine's own predicate", () => {
    const result = checkStoredClasses([{ ...usable, slug: "Card Title" }]);
    expect(result.issues).toHaveLength(1);
    expect(result.value).toEqual([]);
  });

  it("refuses a repeated slug: two rule sets on one selector", () => {
    const result = checkStoredClasses([
      usable,
      { ...usable, id: "c2", orderIndex: 1 },
    ]);
    expect(result.issues.join(" ")).toContain('repeats the slug "card"');
  });

  it("refuses a repeated id: a node's reference would be ambiguous", () => {
    const result = checkStoredClasses([
      usable,
      { ...usable, slug: "card-b", orderIndex: 1 },
    ]);
    expect(result.issues.join(" ")).toContain('repeats the id "c1"');
  });

  it("refuses a class with no numeric orderIndex", () => {
    const result = checkStoredClasses([{ ...usable, orderIndex: "first" }]);
    expect(result.issues).toHaveLength(1);
  });

  // A named class is emitted VERBATIM into the sheet of every public page, so
  // a url() stored in one is a request every visitor makes. Unlike a token,
  // which reaches the page as a var() substitution, there is no later
  // substitution step where a policy could still see it.
  const REFUSING = { mayFetchUrl: () => false };
  const ALLOWING = { mayFetchUrl: () => true };
  const tracker = (styles: unknown) => [{ ...usable, styles }];
  const AT_BASE = { base: { base: { background: { url: TRACKER } } } };

  it("refuses a url() the site's host policy does not allow", () => {
    const result = checkStoredClasses(tracker(AT_BASE), REFUSING);
    expect(result.issues.join(" ")).toContain("does not allow");
  });

  it("accepts the same url() when the policy allows the host", () => {
    // The control that separates "the policy refused it" from "the walk
    // refuses every url()". Without this the test above passes on a gate that
    // rejects the shape and never consults the predicate at all.
    expect(checkStoredClasses(tracker(AT_BASE), ALLOWING).issues).toEqual([]);
  });

  it("accepts it when NO policy is configured, which the engine calls unasked", () => {
    // Deliberate and worth pinning: absent is not the same as an empty
    // allowlist. A site that configured no remotePatterns keeps exactly the
    // behaviour it has, and the engine's scheme allowlist stays the only
    // limit. Closing that is the renderer's half, not this gate's.
    expect(checkStoredClasses(tracker(AT_BASE)).issues).toEqual([]);
  });

  it("reaches a state and a breakpoint the compiler would emit nothing for", () => {
    // The property a compiler-as-validator gate could not have. A breakpoint
    // this site has not defined compiles to no rule TODAY and to a real rule
    // the moment someone defines it, so a gate that only judged what compiles
    // now would let the value through and serve it later.
    const result = checkStoredClasses(
      tracker({
        hover: { "not-a-defined-breakpoint": { background: { url: TRACKER } } },
      }),
      REFUSING
    );
    expect(result.issues.join(" ")).toContain("does not allow");
  });

  it("does not refuse an unknown property when NO policy is configured", () => {
    // Forgiving there, and errors only everywhere: a property this engine has
    // not learned is a warning, a document written by a newer engine is not
    // something the author can fix, and there is no host rule to enforce.
    const result = checkStoredClasses(
      tracker({ base: { base: { notAProperty: "x" } } })
    );
    expect(result.issues).toEqual([]);
  });

  it("refuses an unknown property once a policy IS configured", () => {
    // Strict there, because the validator never looks INSIDE an unknown
    // property. A gate that cannot judge a value must not pass it.
    const result = checkStoredClasses(
      tracker({ base: { base: { notAProperty: "x" } } }),
      REFUSING
    );
    // The property NAME, not merely a non-empty array: a fixture typo trips the
    // shape check and produces an issue too, which would keep this green while
    // the rule it names stopped working.
    expect(result.issues.join(" ")).toContain("notAProperty");
  });

  it("refuses a url() hidden under a property this engine has not learned", () => {
    // Why the mode follows the policy rather than being fixed. Measured:
    // `{ futureBackground: { url: ... } }` yields `unknown-style-property`
    // ALONE — the value is never inspected — so a forgiving read would store
    // the URL, and it becomes live the moment an engine learns that property,
    // with no further validating write to stop it.
    const result = checkStoredClasses(
      tracker({ base: { base: { futureBackground: { url: TRACKER } } } }),
      REFUSING
    );
    expect(result.issues.join(" ")).toContain("futureBackground");
  });

  it("bounds the whole section, not each map inside it", () => {
    // The single-map test below cannot see this. A budget created per map
    // bounds each map and nothing else, and the number of maps is limited only
    // by the document's byte cap — measured, the same payload spread over 200
    // maps produced 40,200 diagnostics that way against 201 with one budget for
    // the section. The write is refused either way; what differs is how much
    // work refusing it costs.
    const byState: Record<string, unknown> = {};
    for (let m = 0; m < 200; m += 1) {
      const values: Record<string, unknown> = {};
      for (let k = 0; k < 300; k += 1) values[`bad${k}`] = "x";
      byState[`state${m}`] = { base: values };
    }

    const result = checkStoredClasses(tracker(byState), REFUSING);

    expect(result.issues.join(" ")).toContain("not checked");
    expect(result.issues.length).toBeLessThan(1000);
  });

  it("stops reading states once the section budget is spent", () => {
    // The bound above is visible in the issue COUNT; stopping the walk is not,
    // because the budget caps the issues either way. So the states are
    // accessors and the test counts how many were read: what the early stop
    // buys is work not done, and work not done is only observable if something
    // records the doing.
    let statesRead = 0;
    const byState: Record<string, unknown> = {};
    for (let m = 0; m < 200; m += 1) {
      Object.defineProperty(byState, `state${m}`, {
        enumerable: true,
        get() {
          statesRead += 1;
          const values: Record<string, unknown> = {};
          for (let k = 0; k < 300; k += 1) values[`bad${k}`] = "x";
          return { base: values };
        },
      });
    }

    const result = checkStoredClasses(tracker(byState), REFUSING);

    expect(result.issues.join(" ")).toContain("not checked");
    expect(statesRead).toBeLessThan(5);
  });

  it("enumerates state keys lazily, so stopping stops the enumeration too", () => {
    // The accessor test above counts VALUE reads, and key enumeration reads no
    // values — so it cannot see a walk that materialises every key before the
    // budget has a chance to stop it. A proxy counting descriptor lookups can:
    // measured, breaking after the first entry costs one lookup in total with
    // `for...in` and one PER KEY with `Object.keys`.
    let descriptorLookups = 0;
    const target: Record<string, unknown> = {};
    const exhausting: Record<string, unknown> = {};
    for (let k = 0; k < 300; k += 1) exhausting[`bad${k}`] = "x";
    target.state0 = { base: exhausting };
    for (let m = 1; m < 2000; m += 1) {
      target[`state${m}`] = { base: { color: "#111111" } };
    }
    const styles = new Proxy(target, {
      getOwnPropertyDescriptor(t, key) {
        descriptorLookups += 1;
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
    });

    const result = checkStoredClasses(tracker(styles), REFUSING);

    expect(result.issues.join(" ")).toContain("not checked");
    expect(descriptorLookups).toBeLessThan(10);
  });

  it("stops judging later classes once the section budget is spent", () => {
    // The stop inside one class does not imply the stop between classes, and
    // neither is visible in the issue count. `MAX_NAMED_CLASSES` is 2000 and
    // the count check reports without stopping the walk, so without this the
    // cost of refusing scales with the array a caller sends.
    let laterRead = 0;
    const exhausting: Record<string, unknown> = {};
    for (let m = 0; m < 200; m += 1) {
      const values: Record<string, unknown> = {};
      for (let k = 0; k < 300; k += 1) values[`bad${k}`] = "x";
      exhausting[`state${m}`] = { base: values };
    }
    const later: Record<string, unknown> = {};
    Object.defineProperty(later, "base", {
      enumerable: true,
      get() {
        laterRead += 1;
        return { base: { color: "#111111" } };
      },
    });

    const result = checkStoredClasses(
      [
        { id: "a", slug: "a", orderIndex: 0, styles: exhausting },
        { id: "b", slug: "b", orderIndex: 1, styles: later },
      ],
      REFUSING
    );

    expect(result.issues.join(" ")).toContain("not checked");
    expect(laterRead).toBe(0);
  });

  it("refuses a property map too large to check through", () => {
    // A budget per entry. Given none, the validator walks an unbounded map and
    // allocates a diagnostic per key. Truncation needs no handling of its own:
    // `style-issues-truncated` is itself an error, so a map the gate could not
    // read to the end refuses rather than passing on a partial read.
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 5000; i += 1) huge[`p${i}`] = "x";
    const result = checkStoredClasses(
      tracker({ base: { base: huge } }),
      REFUSING
    );
    expect(result.issues.join(" ")).toContain("not checked");
  });

  it("still returns the entry it reported on, so a READ narrows rather than drops", () => {
    // The module's two postures: the write refuses the section on any issue,
    // the read keeps what the compiler can narrow for itself.
    const result = checkStoredClasses(tracker(AT_BASE), REFUSING);
    // The host refusal specifically. Any issue at all would satisfy a
    // non-empty check, including one from the shape gate, which reports AND
    // excludes the entry — so the two assertions would then contradict each
    // other while both passed.
    expect(result.issues.join(" ")).toContain("does not allow");
    expect(result.value).toHaveLength(1);
  });
});

describe("checkStoredBreakpoints", () => {
  it("accepts a set, reading an absent axis as empty", () => {
    const result = checkStoredBreakpoints({
      viewport: [
        { id: "base", label: "Base" },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
    });
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual({
      viewport: [
        { id: "base", label: "Base" },
        { id: "mobile", label: "Mobile", maxWidth: 640 },
      ],
      container: [],
    });
  });

  it("refuses an id repeated ACROSS axes: a style key carries no axis", () => {
    const result = checkStoredBreakpoints({
      viewport: [{ id: "base", label: "Base" }],
      container: [{ id: "base", label: "Base" }],
    });
    expect(result.issues.join(" ")).toContain('repeats the id "base"');
  });

  it("refuses a non-positive maxWidth", () => {
    const result = checkStoredBreakpoints({
      viewport: [{ id: "mobile", label: "Mobile", maxWidth: 0 }],
    });
    expect(result.issues).toHaveLength(1);
    expect(result.value?.viewport).toEqual([]);
  });
});

describe("readSiteStyleRecord", () => {
  it("reads the empty style from anything that is not a document", () => {
    expect(readSiteStyleRecord(null)).toEqual({});
    expect(readSiteStyleRecord("nonsense")).toEqual({});
  });

  it("keeps what it can type and drops what it cannot, silently", () => {
    // The read posture: a legacy or hand-corrupted row must cost the broken
    // entry, not every page on the site. The engine re-reports value-level
    // problems at compile, so nothing is lost by not refusing here.
    const style = readSiteStyleRecord({
      tokens: {
        tokens: [token("color.primary", "#123456"), { broken: true }],
      },
      classes: "not-an-array",
      breakpoints: { viewport: [{ id: "base", label: "Base" }] },
    });
    expect(style.tokens?.tokens.map(t => t.name)).toEqual(["color.primary"]);
    expect(style.classes).toBeUndefined();
    expect(style.breakpoints?.viewport).toHaveLength(1);
  });
});

describe("judging the write against the tier it will be merged with", () => {
  // A checker seeing only the stored array judges something no consumer ever
  // compiles. What it must NOT do is model the merge as a concatenation:
  // `resolveSiteStyle` merges classes keyed by ID, so a stored class sharing an
  // id with a config one REPLACES it.
  const stored = {
    id: "stored-1",
    slug: "hero",
    orderIndex: 0,
    styles: { base: { base: { color: "#111111" } } },
  };

  const CONFIG_CLASS = {
    id: "config-1",
    slug: "hero",
    orderIndex: 0,
    styles: { base: { base: { color: "#222222" } } },
  };

  it("refuses a slug two different classes would hold once merged", () => {
    // Survives the merge and still breaks: two ids on one selector means the
    // compiler keeps the first and the node referencing the other gets no rule.
    const result = checkStoredClasses([stored], {
      defaults: { classes: [CONFIG_CLASS] as never },
    });

    expect(result.issues.join(" ")).toContain("merged");
  });

  it("accepts the same class when the caller states no config tier", () => {
    // The separating control. Without it the refusal above passes just as well
    // on a checker that rejects the slug for some reason of its own.
    expect(checkStoredClasses([stored]).issues).toEqual([]);
  });

  it("ACCEPTS a stored class that overrides a config one by id", () => {
    // The case a concatenation model gets wrong. Sharing an id is how an
    // override is expressed — `mergeByKey(defaults, stored, c => c.id)` — so
    // refusing it as a duplicate refuses the feature.
    const result = checkStoredClasses([{ ...stored, id: "config-1" }], {
      defaults: { classes: [CONFIG_CLASS] as never },
    });

    expect(result.issues).toEqual([]);
  });

  it("counts the cap over the MERGED library, replacements included", () => {
    // The compiler truncates the merged library by array PREFIX. Counting the
    // two tiers added together would refuse a write that only replaces.
    const many = Array.from({ length: MAX_NAMED_CLASSES }, (_, i) => ({
      ...stored,
      id: `config-${i}`,
      slug: `config-${i}`,
    }));

    const overflowing = checkStoredClasses([stored], {
      defaults: { classes: many as never },
    });
    expect(overflowing.issues.join(" ")).toContain("merged");

    // And a pure replacement of one of them does not overflow, because the
    // merge is the same length it was.
    const replacing = checkStoredClasses(
      [{ ...stored, id: "config-0", slug: "config-0" }],
      { defaults: { classes: many as never } }
    );
    expect(replacing.issues).toEqual([]);
  });

  it("still caps the library when there is no config tier at all", () => {
    // The merge of nothing and the stored array is the stored array, so the cap
    // applies either way. A site on the plain `pageBuilder()` configuration
    // states no defaults, which is the common case — skipping the merged checks
    // for it would let the compiler silently drop everything past the cap.
    const tooMany = Array.from({ length: MAX_NAMED_CLASSES + 1 }, (_, i) => ({
      ...stored,
      id: `c-${i}`,
      slug: `c-${i}`,
    }));

    // Named by the id that will not render, which is what a node references and
    // the only thing the author can act on.
    expect(checkStoredClasses(tooMany).issues.join(" ")).toContain(
      `"c-${MAX_NAMED_CLASSES}"`
    );
  });

  it("does not charge the writer for a class problem the CONFIG tier already had", () => {
    // The merge only ever adds to or replaces within the config tier, never
    // removes from it — so a config tier that already exceeds the cap, or
    // already holds one slug on two ids, is a problem the writer cannot reach
    // from the admin. Charging it to their save leaves them unable to store
    // anything at all, including an empty library.
    const brokenConfig = [
      { ...stored, id: "x", slug: "dup" },
      { ...stored, id: "y", slug: "dup" },
    ];

    expect(
      checkStoredClasses([], { defaults: { classes: brokenConfig as never } })
        .issues
    ).toEqual([]);
  });

  it("reports a NEW collision on a slug the config tier already collided on", () => {
    // Two different collisions on one slug read identically, so a filter keyed
    // on the rendered message accepts the second as though it were the first.
    // Config holds `x` and `y` both on `dup`. The write moves `x` off it and
    // adds `z` onto it: the merge now drops `z` rather than `y`, which is a
    // different pair and a class the author just wrote that will never render.
    const config = [
      { ...stored, id: "x", slug: "dup" },
      { ...stored, id: "y", slug: "dup" },
    ];
    const write = [
      { ...stored, id: "x", slug: "moved" },
      { ...stored, id: "z", slug: "dup" },
    ];

    const result = checkStoredClasses(write, {
      defaults: { classes: config as never },
    });

    // `z` is the class that will not render, and naming it is the whole point:
    // the pre-existing collision dropped `y`, this one drops `z`, and a check
    // that could not tell those apart accepted the write.
    expect(result.issues.join(" ")).toContain('"z"');
  });

  it("reports a class the write pushes past the cap, over an already-full config", () => {
    // Config alone is over the cap, which the writer cannot fix. Adding one
    // more is still their doing, and the class they just added is guaranteed
    // not to render — so the overflow being inherited must not suppress it.
    const overfull = Array.from({ length: MAX_NAMED_CLASSES + 1 }, (_, i) => ({
      ...stored,
      id: `cfg-${i}`,
      slug: `cfg-${i}`,
    }));

    const result = checkStoredClasses([{ ...stored, id: "new", slug: "new" }], {
      defaults: { classes: overfull as never },
    });

    expect(result.issues.join(" ")).toContain('"new"');
  });

  it("reports a config class the write reorders out of rendering", () => {
    // The compiler claims slugs AFTER sorting by orderIndex, so a write that
    // only changes precedence changes which of two colliding classes survives.
    // Config renders `a` and drops `b`; moving `b` in front makes it render and
    // drops `a`, which used to be on the page.
    const config = [
      { ...stored, id: "a", slug: "same", orderIndex: 0 },
      { ...stored, id: "b", slug: "same", orderIndex: 1 },
    ];

    const result = checkStoredClasses(
      [{ ...stored, id: "b", slug: "same", orderIndex: -1 }],
      { defaults: { classes: config as never } }
    );

    expect(result.issues.join(" ")).toContain('"a"');
  });

  it("refuses a stored token colliding with a config one on a custom property", () => {
    // Names the engine does not define, so the collision under test is between
    // the two SITE tiers rather than with a default. `color.primary` is itself
    // an engine default, which would attribute the clash a level lower.
    const result = checkStoredTokens(
      { tokens: [token("brand.accent-hover", "#111111")] },
      {
        defaults: {
          tokens: { tokens: [token("brand-accent.hover", "#222222")] },
        },
      }
    );

    expect(result.issues).not.toEqual([]);
  });

  it("reports the stored set's OWN issue even when config emits the same message", () => {
    // A token issue names the token and not the offending value, so a config
    // token that already emits one and a stored override that emits a
    // different one produce identical strings. Comparing merged against config
    // then accepts a value the compiler drops. What the writer wrote is theirs
    // whatever the config tier says.
    const fetching = (name: string, url: string) => ({
      name,
      kind: "color" as const,
      values: { light: `url(${url})` },
    });

    const result = checkStoredTokens(
      { tokens: [fetching("brand.image", "https://b.example/2.png")] },
      {
        defaults: {
          tokens: {
            tokens: [fetching("brand.image", "https://a.example/1.png")],
          },
        },
      }
    );

    expect(result.issues).not.toEqual([]);
  });

  it("accepts a write that only changes the prefix over a colliding config tier", () => {
    // A collision message renders the custom property the two names both
    // become, so the prefix is inside the string. Emitting the baseline under
    // its own prefix makes a prefix change look like a brand new collision and
    // refuses a write for a clash it did not cause and cannot reach — the
    // stored tier holds no tokens here at all.
    const colliding = {
      tokens: [
        token("color.primary-dark", "#111111"),
        token("color-primary.dark", "#222222"),
      ],
    };

    const result = checkStoredTokens(
      { tokens: [], prefix: "--brand-" },
      { defaults: { tokens: colliding } }
    );

    expect(result.issues).toEqual([]);
  });

  it("refuses a stored token that collides with an ENGINE default", () => {
    // A page layers the site's tokens over the engine's defaults before
    // compiling, so the tier stack a write is judged against has three levels
    // and not two. `color-primary` emits nothing on its own and collides with
    // the guaranteed default `color.primary` on `--site-color-primary`, where
    // the emitter keeps the default and silently drops the saved value.
    const result = checkStoredTokens({
      tokens: [token("color-primary", "#111111")],
    });

    expect(result.issues.join(" ")).toContain("--site-color-primary");
  });

  it("does not report a problem the CONFIG tier already had on its own", () => {
    // Reported as a difference. A site whose own config emits an issue has a
    // problem, but it is not one this write introduced and not one the writer
    // can fix from here — refusing their save for it tells them about somebody
    // else's mistake.
    const brokenConfig = {
      tokens: [
        token("brand.accent-hover", "#111111"),
        token("brand-accent.hover", "#222222"),
      ],
    };

    const result = checkStoredTokens(
      { tokens: [token("brand.other", "#333333")] },
      { defaults: { tokens: brokenConfig } }
    );

    expect(result.issues).toEqual([]);
  });
});
