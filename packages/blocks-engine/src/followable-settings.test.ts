/**
 * The settings of a component one block's prop may follow, as the editor's
 * picker lists them: judged by the rule the save judges a follower by, so a
 * pick it offers is one the save takes, and one it would refuse is not
 * offered.
 */
import { describe, expect, it } from "vitest";

import type { PropSchema } from "./block";
import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
import { bindDocument, createBindingRun } from "./resolve-bindings";
import {
  followableSettingsOf,
  followsSetting,
  settingBindingIssues,
} from "./setting-bindings";

const block = (id: string, type = "core/heading"): BlockNode => ({
  id,
  type,
  version: 1,
  props: { text: id },
});

const setting = (
  id: string,
  nodeId: string,
  propPath: string,
  type: ExposedProperty["type"] = "text",
  options?: ExposedProperty["options"]
): ExposedProperty => ({
  id,
  label: `${id} label`,
  nodeId,
  propPath,
  type,
  ...(options === undefined ? {} : { options }),
});

const component = (
  nodes: BlockNode[],
  exposed: ExposedProperty[]
): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  exposed,
});

const TEXT: PropSchema = { type: "text" };

describe("followableSettingsOf", () => {
  it("lists the settings a text prop may follow, in the component's order", () => {
    const doc = component(
      [block("title"), block("eyebrow"), block("follower"), block("pic")],
      [
        setting("eyebrow", "eyebrow", "text"),
        setting("title", "title", "text"),
        setting("picture", "pic", "media", "image"),
        setting("shown", "title", "hidden", "visibility"),
      ]
    );
    expect(
      followableSettingsOf(doc, "follower", "text", TEXT).map(s => s.id)
    ).toEqual(["eyebrow", "title"]);
  });

  it("lists nothing for a prop that holds a setting's value", () => {
    // Its value is what the setting's followers show, so it follows none.
    const doc = component(
      [block("title"), block("eyebrow")],
      [setting("title", "title", "text"), setting("eyebrow", "eyebrow", "text")]
    );
    expect(followableSettingsOf(doc, "title", "text", TEXT)).toEqual([]);
    expect(
      followableSettingsOf(doc, "title", "level", TEXT).map(s => s.id)
    ).toEqual(["title", "eyebrow"]);
  });

  it("lists an image setting for an image prop and not for text", () => {
    const doc = component(
      [block("pic", "core/image"), block("follower", "core/image")],
      [setting("picture", "pic", "media", "image")]
    );
    expect(
      followableSettingsOf(doc, "follower", "media", { type: "media" }).map(
        s => s.id
      )
    ).toEqual(["picture"]);
    expect(followableSettingsOf(doc, "follower", "text", TEXT)).toEqual([]);
  });

  it("offers a select setting only to a select prop taking all its choices", () => {
    const doc = component(
      [block("source"), block("follower")],
      [
        setting("tone", "source", "tone", "select", [
          { value: "calm", label: "Calm" },
          { value: "loud", label: "Loud" },
        ]),
      ]
    );
    const takesBoth: PropSchema = {
      type: "select",
      options: ["calm", "loud", "quiet"],
    };
    const lacksOne: PropSchema = { type: "select", options: ["calm"] };
    expect(
      followableSettingsOf(doc, "follower", "tone", takesBoth).map(s => s.id)
    ).toEqual(["tone"]);
    expect(followableSettingsOf(doc, "follower", "tone", lacksOne)).toEqual([]);
  });

  it("lists nothing for a prop no setting edits", () => {
    const doc = component(
      [block("title"), block("follower")],
      [setting("title", "title", "text")]
    );
    expect(
      followableSettingsOf(doc, "follower", "count", { type: "number" })
    ).toEqual([]);
    expect(followableSettingsOf(doc, "follower", "text", undefined)).toEqual(
      []
    );
  });

  it("lists nothing outside a component, or for a block it doesn't hold", () => {
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [block("title"), block("follower")],
    };
    expect(followableSettingsOf(page, "follower", "text", TEXT)).toEqual([]);
    const doc = component(
      [block("title")],
      [setting("title", "title", "text")]
    );
    expect(followableSettingsOf(doc, "missing", "text", TEXT)).toEqual([]);
  });

  it("finds a block inside a placement's slot content, as the save walks it", () => {
    const slotted = block("slotted");
    const holder: BlockNode = {
      id: "holder",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: "card" },
      slots: { body: [slotted] },
    };
    const doc = component(
      [block("title"), holder],
      [setting("title", "title", "text")]
    );
    expect(
      followableSettingsOf(doc, "slotted", "text", TEXT).map(s => s.id)
    ).toEqual(["title"]);
  });

  it("offers only settings the save then takes", () => {
    const doc = component(
      [block("title"), block("pic"), block("follower")],
      [
        setting("title", "title", "text"),
        setting("picture", "pic", "media", "image"),
      ]
    );
    const definitions = {
      get: (type: string) =>
        type === "core/heading" ? { props: { text: TEXT } } : undefined,
    };
    const offered = followableSettingsOf(doc, "follower", "text", TEXT);
    expect(offered.length).toBeGreaterThan(0);
    for (const choice of offered) {
      const followed = component(
        [
          block("title"),
          block("pic"),
          {
            ...block("follower"),
            bindings: { text: { $bind: choice.id, source: "setting" } },
          },
        ],
        doc.exposed ?? []
      );
      expect(
        settingBindingIssues(followed, undefined, definitions as never)
      ).toEqual([]);
    }
  });
});

describe("followsSetting", () => {
  it("tells a binding following a setting from every other", () => {
    expect(followsSetting({ $bind: "card-title", source: "setting" })).toBe(
      true
    );
    expect(followsSetting({ $bind: "title", source: "site" })).toBe(false);
    expect(followsSetting({ $bind: "title" })).toBe(false);
    expect(followsSetting({ $bind: "", source: "setting" })).toBe(false);
    expect(followsSetting(undefined)).toBe(false);
  });

  it("is a binding whose fallback is never shown, the setting's default is", () => {
    // Shown alone, the follower shows the setting's default, empty here, and
    // not the fallback it carries.
    const doc = component(
      [
        { ...block("title"), props: {} },
        {
          ...block("follower"),
          bindings: {
            text: { $bind: "title", source: "setting", fallback: "Unseen" },
          },
        },
      ],
      [setting("title", "title", "text")]
    );
    const run = createBindingRun({
      sources: {},
      props: {
        get: type =>
          type === "core/heading" ? { props: { text: TEXT } } : undefined,
      },
    });
    const follower = bindDocument(doc, run).document.nodes.find(
      node => node.id === "follower"
    );
    // The setting's block holds no text, so neither does its follower.
    expect(follower?.props).toEqual({});
  });
});
