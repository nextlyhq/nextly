/**
 * What a page's bindings read, asked of stored documents before anything has
 * repaired them: the scan holds itself to the caps the read pipeline applies.
 * And what an image binding's fallback fills: an image address or a media
 * library id, each said for what it is, so the renderer draws either.
 * And the language and zone a render formats in, which the editor's previews
 * ask of the same rule.
 */
import { describe, expect, it } from "vitest";

import type { BindingSchemaSource } from "./binding-rules";
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import { DEFAULT_LIMITS } from "./limits";
import {
  bindingDemand,
  bindingFormatEnv,
  createBindingRun,
  resolveNodeBindings,
} from "./resolve-bindings";

/** A bound heading under `depth` nested boxes, built without recursion. */
function nestedUnder(depth: number): BlockDocument {
  let node: Record<string, unknown> = {
    id: "deep",
    type: "core/heading",
    version: 1,
    props: {},
    bindings: { text: { $bind: "subtitle" } },
  };
  for (let level = 0; level < depth; level += 1) {
    node = {
      id: `box-${String(level)}`,
      type: "core/box",
      version: 1,
      props: {},
      slots: { children: [node] },
    };
  }
  const top = {
    id: "top",
    type: "core/heading",
    version: 1,
    props: {},
    bindings: { text: { $bind: "title" } },
  };
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [top, node],
  } as unknown as BlockDocument;
}

describe("the fields a page's bindings read", () => {
  it("scans a slot chain deeper than the call stack, and reads nothing past the depth cap", () => {
    const demand = bindingDemand([nestedUnder(50_000)], DEFAULT_LIMITS);
    // The binding at the top is read for; the one past the cap, which the read
    // pipeline drops, is not.
    expect(demand.entry?.fields).toEqual(["title"]);
  });

  it("reads for a binding within the depth cap", () => {
    const demand = bindingDemand(
      [nestedUnder(DEFAULT_LIMITS.maxDepth - 2)],
      DEFAULT_LIMITS
    );
    expect(demand.entry?.fields).toEqual(["title", "subtitle"]);
  });

  it("reads past the stored document's depth cap when given no caps, as for a composed tree", () => {
    // A tree the pipeline already prepared is within its own caps; reapplying
    // the stored document's depth cap would drop a component's binding.
    const demand = bindingDemand([nestedUnder(DEFAULT_LIMITS.maxDepth + 5)]);
    expect(demand.entry?.fields).toEqual(["title", "subtitle"]);
  });

  it("lists what each path follows into a related entry, and whether a date is formatted", () => {
    const document = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "a",
          type: "core/heading",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "author.name" },
            label: {
              $bind: "publishedAt",
              format: { type: "date", options: { dateStyle: "long" } },
            },
          },
        },
      ],
    } as unknown as BlockDocument;
    const demand = bindingDemand([document]);
    expect(demand.entry?.fields).toEqual(["author", "publishedAt"]);
    expect([...(demand.entry?.follows ?? [])]).toEqual([["author", ["name"]]]);
    expect(demand.formatsDates).toBe(true);
  });
});

describe("an image binding's fallback", () => {
  const schema: BindingSchemaSource = {
    fieldsOf: ref =>
      "collection" in ref && ref.collection === "posts"
        ? [{ name: "cover", type: "upload", relationTo: "media" }]
        : undefined,
  };

  /** The page's pass for one entry of `posts`, core/image declared. */
  const runFor = (entry: Record<string, unknown>) =>
    createBindingRun({
      sources: { entry },
      entryRef: { collection: "posts" },
      schema,
      props: {
        get: type =>
          type === "core/image"
            ? {
                props: {
                  mediaId: { type: "media", addressProp: "src" },
                  src: { type: "url" },
                },
              }
            : undefined,
      },
    });

  /** An image whose `mediaId` is bound, its own values distinct from all. */
  const imageBound = (binding: {
    $bind: string;
    fallback: unknown;
  }): BlockNode => ({
    id: "picture",
    type: "core/image",
    version: 1,
    props: { mediaId: "own-media", src: "https://cdn.example/own.jpg" },
    bindings: { mediaId: binding },
  });

  it("fills an empty field with a media-id fallback, drawn as a picked media id is", () => {
    const result = resolveNodeBindings(
      imageBound({ $bind: "cover", fallback: "fallback-media" }),
      runFor({ cover: null }),
      { phase: "page" }
    );
    expect(result.issues).toEqual([]);
    expect(result.props.mediaId).toBe("fallback-media");
    expect(result.bound?.mediaId).toEqual({
      kind: "image",
      holds: "media",
      from: "fallback",
    });
  });

  it("carries a media-id fallback beside a filled value, for a record the host can't find", () => {
    const result = resolveNodeBindings(
      imageBound({ $bind: "cover", fallback: "fallback-media" }),
      runFor({ cover: "bound-media" }),
      { phase: "page" }
    );
    expect(result.props.mediaId).toBe("bound-media");
    expect(result.bound?.mediaId).toEqual({
      kind: "image",
      holds: "media",
      from: "value",
      fallback: { holds: "media", value: "fallback-media" },
    });
  });

  it("still fills an address fallback as an address", () => {
    const result = resolveNodeBindings(
      imageBound({ $bind: "cover", fallback: "/media/fallback.jpg" }),
      runFor({ cover: "" }),
      { phase: "page" }
    );
    expect(result.props.mediaId).toBe("/media/fallback.jpg");
    expect(result.bound?.mediaId).toEqual({
      kind: "image",
      holds: "address",
      from: "fallback",
    });
  });

  it("shows a media-id fallback for a binding that cannot be read", () => {
    // A path no binding may store: the binding is malformed, and its
    // fallback is what a visitor sees.
    const result = resolveNodeBindings(
      imageBound({ $bind: "not a path", fallback: "fallback-media" }),
      runFor({ cover: "bound-media" }),
      { phase: "page" }
    );
    expect(result.issues.map(issue => issue.code)).toEqual([
      "binding-malformed",
    ]);
    expect(result.props.mediaId).toBe("fallback-media");
    expect(result.bound?.mediaId).toEqual({
      kind: "image",
      holds: "media",
      from: "fallback",
    });
  });

  it("refuses a fallback that is neither, and keeps the image's own media", () => {
    const result = resolveNodeBindings(
      imageBound({ $bind: "cover", fallback: "javascript:alert(1)" }),
      runFor({ cover: null }),
      { phase: "page" }
    );
    expect(result.issues.map(issue => issue.code)).toEqual([
      "binding-fallback-invalid",
    ]);
    expect(result.issues[0]?.message).toContain(
      "neither an image address (https://, http:// or a path on the site) nor a media library image"
    );
    expect(result.props.mediaId).toBe("own-media");
    expect(result.bound?.mediaId).toEqual({
      kind: "image",
      holds: "media",
      from: "own",
    });
  });
});

describe("the language and time zone a render formats in", () => {
  it("keeps a language and a zone the runtime knows", () => {
    expect(
      bindingFormatEnv({ locale: "ar-EG", timeZone: "Asia/Karachi" })
    ).toEqual({
      env: { locale: "ar-EG", timeZone: "Asia/Karachi" },
      timeZoneValid: true,
    });
  });

  it("is English and UTC for a page with neither, by intent", () => {
    expect(bindingFormatEnv({})).toEqual({
      env: { locale: "en", timeZone: "UTC" },
      timeZoneValid: true,
    });
  });

  it("is UTC for a zone given and refused, saying so", () => {
    expect(bindingFormatEnv({ timeZone: "Not/AZone" })).toEqual({
      env: { locale: "en", timeZone: "UTC" },
      timeZoneValid: false,
    });
  });

  it("is what a render's pass formats in", () => {
    // Asked of the pass a render starts, not of the rule, so a pass that
    // resolved its language or zone some other way fails here.
    const run = createBindingRun({
      sources: {},
      props: { get: () => undefined },
      locale: "ar-EG",
      timeZone: "Not/AZone",
    });
    expect(run.env).toEqual({ locale: "ar-EG", timeZone: "UTC" });
    expect(run.timeZoneValid).toBe(false);
  });
});
