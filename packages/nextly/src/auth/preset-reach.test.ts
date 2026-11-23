/**
 * Which presets a collection and a declared permission reach: the
 * configuration's word, then the grandfather record, then none.
 */
import { describe, expect, it } from "vitest";

import {
  formatPresetReachNotice,
  presetDeclarationsOf,
  presetReachNotice,
  presetReachOf,
  unknownPresetSlugs,
  type PresetReachInputs,
} from "./preset-reach";
import {
  ROLE_PRESETS,
  resolvePreset,
  type PresetPermission,
} from "./role-presets";

const perm = (
  action: string,
  resource: string,
  owner: string | null = null
): PresetPermission => ({ action, resource, owner });

const presetsOf = (inputs: PresetReachInputs, permission: PresetPermission) => {
  const reached = presetReachOf(inputs).presetsFor(permission);
  return reached === undefined ? undefined : [...reached].sort();
};

const none = new Map<string, readonly string[]>();

describe("a collection", () => {
  it("reaches no preset when nothing opens it and the record does not keep it", () => {
    const inputs = {
      collectionSlugs: ["private-notes"],
      declarations: presetDeclarationsOf({}),
      grandfathered: none,
    };
    expect(presetsOf(inputs, perm("read", "private-notes"))).toEqual([]);
    // Every preset's rule asked through it grants nothing of the collection.
    const reach = presetReachOf(inputs);
    for (const preset of ROLE_PRESETS) {
      expect(
        resolvePreset(
          preset,
          [perm("read", "private-notes"), perm("update", "private-notes")],
          reach
        )
      ).toEqual([]);
    }
  });

  it("reaches exactly the presets its own grants name", () => {
    const inputs = {
      collectionSlugs: ["team"],
      declarations: presetDeclarationsOf({
        collections: [{ slug: "team", grants: { presets: ["viewer"] } }],
      }),
      grandfathered: none,
    };
    expect(presetsOf(inputs, perm("read", "team"))).toEqual(["viewer"]);
    const reach = presetReachOf(inputs);
    const viewer = ROLE_PRESETS.find(p => p.slug === "viewer")!;
    const editor = ROLE_PRESETS.find(p => p.slug === "editor")!;
    const permissions = [perm("read", "team"), perm("update", "team")];
    // The viewer reads and changes nothing; the editor, not opened to, nothing.
    expect(
      resolvePreset(viewer, permissions, reach).map(p => p.action)
    ).toEqual(["read"]);
    expect(resolvePreset(editor, permissions, reach)).toEqual([]);
  });

  it("is opened by a plugin's collection declaration as by the app's", () => {
    const inputs = {
      collectionSlugs: ["forms"],
      declarations: presetDeclarationsOf({
        plugins: [
          {
            contributes: {
              collections: [{ slug: "forms", grants: { presets: ["admin"] } }],
            },
          },
        ],
      }),
      grandfathered: none,
    };
    expect(presetsOf(inputs, perm("read", "forms"))).toEqual(["admin"]);
  });

  it("follows the app's presetGrants over its own grants", () => {
    const inputs = {
      collectionSlugs: ["pages"],
      declarations: presetDeclarationsOf({
        collections: [{ slug: "pages", grants: { presets: ["viewer"] } }],
        presetGrants: { pages: ["editor", "author"] },
      }),
      grandfathered: none,
    };
    expect(presetsOf(inputs, perm("read", "pages"))).toEqual([
      "author",
      "editor",
    ]);
  });

  it("keeps the presets the grandfather record holds for it until the configuration speaks", () => {
    const grandfathered = new Map([["posts", ["admin", "editor"]]]);
    const kept = {
      collectionSlugs: ["posts"],
      declarations: presetDeclarationsOf({}),
      grandfathered,
    };
    expect(presetsOf(kept, perm("read", "posts"))).toEqual(["admin", "editor"]);
    // `[]` closes it, record or not.
    const closed = {
      ...kept,
      declarations: presetDeclarationsOf({
        collections: [{ slug: "posts", grants: { presets: [] } }],
      }),
    };
    expect(presetsOf(closed, perm("read", "posts"))).toEqual([]);
  });
});

describe("everything that is not a collection", () => {
  it("reaches every preset by its own rule: system resources and Singles", () => {
    const inputs = {
      collectionSlugs: ["posts"],
      declarations: presetDeclarationsOf({}),
      grandfathered: none,
    };
    expect(presetsOf(inputs, perm("read", "media"))).toBeUndefined();
    expect(presetsOf(inputs, perm("read", "site-settings"))).toBeUndefined();
  });

  it("reaches a declared permission's named presets, and every preset where it names none", () => {
    const inputs = {
      collectionSlugs: [],
      declarations: presetDeclarationsOf({
        plugins: [
          {
            contributes: {
              permissions: [
                { action: "access", resource: "private-records", presets: [] },
                { action: "export", resource: "submissions" },
              ],
            },
          },
        ],
      }),
      grandfathered: none,
    };
    expect(
      presetsOf(inputs, perm("access", "private-records", "acme-records"))
    ).toEqual([]);
    expect(
      presetsOf(inputs, perm("export", "submissions", "acme-forms"))
    ).toBeUndefined();
    // Admin, which takes a plugin's permission by its own rule, does not take
    // one declared for no preset.
    const admin = ROLE_PRESETS.find(p => p.slug === "admin")!;
    expect(
      resolvePreset(
        admin,
        [perm("access", "private-records", "acme-records")],
        presetReachOf(inputs)
      )
    ).toEqual([]);
  });
});

describe("the start's notice", () => {
  it("names the collections the record alone keeps open, and those nothing opens", () => {
    const notice = presetReachNotice({
      collectionSlugs: ["posts", "private-notes", "team", "private"],
      declarations: presetDeclarationsOf({
        collections: [
          { slug: "team", grants: { presets: ["viewer"] } },
          { slug: "private", grants: { presets: [] } },
        ],
      }),
      grandfathered: new Map([["posts", ["editor"]]]),
    });
    expect(notice).toEqual({
      grandfathered: [{ slug: "posts", presets: ["editor"] }],
      closed: ["private-notes"],
    });
    const { kept, closed } = formatPresetReachNotice(notice);
    expect(kept).toMatch(/"posts": editor/);
    expect(kept).not.toMatch(/"private-notes"/);
    expect(closed).toMatch(/"private-notes"/);
    expect(`${kept}\n${closed}`).not.toMatch(/"team"|"private"/);
  });

  it("says nothing where the configuration speaks for every collection", () => {
    const notice = presetReachNotice({
      collectionSlugs: ["posts"],
      declarations: presetDeclarationsOf({ presetGrants: { posts: [] } }),
      grandfathered: none,
    });
    expect(formatPresetReachNotice(notice)).toEqual({
      kept: null,
      closed: null,
    });
  });
});

describe("a preset list", () => {
  it("names what is not a preset", () => {
    expect(unknownPresetSlugs(["editor", "editors", "super-admin"])).toEqual([
      "editors",
      "super-admin",
    ]);
  });
});
