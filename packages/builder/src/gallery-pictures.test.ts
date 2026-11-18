/**
 * A Gallery's pictures, as the editor adds and names them: what adding
 * several library files stores, and how a picture inside a gallery is
 * placed and read.
 *
 * @module gallery-pictures.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addPicturesOps,
  galleryPictureOf,
  isGallery,
} from "./gallery-pictures";
import { applyOps } from "./op-vocabulary";

beforeEach(() => registerBlocks(coreBlocks as never, { source: "core" }));
afterEach(() => clearBlocks());

const picture = (id: string, mediaId: string): BlockNode => ({
  id,
  type: "core/image",
  version: 1,
  props: { mediaId },
});

function page(...nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes };
}

function gallery(
  id: string,
  children: BlockNode[],
  extra: Partial<BlockNode> = {}
): BlockNode {
  return {
    id,
    type: "core/gallery",
    version: 1,
    props: { as: "div" },
    slots: { children },
    ...extra,
  };
}

describe("adding pictures to a gallery", () => {
  it("stores one Image per file, in pick order, after the pictures it holds, with the file's id and the Image's own defaults only", () => {
    const document = page(gallery("g", [picture("p1", "m0")]));
    const ops = addPicturesOps(document, "g", ["m1", "m2", "m3"]);
    expect(ops).not.toBeNull();
    const after = applyOps(document, ops ?? []).document;
    const children = after.nodes[0]?.slots?.children ?? [];
    expect(children.map(child => child.props.mediaId)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
    ]);
    // What a new Image is placed with, and the file: nothing else.
    const image = coreBlocks.find(each => each.name === "core/image");
    for (const added of children.slice(1)) {
      expect(added.type).toBe("core/image");
      expect(added.version).toBe(image?.version);
      expect(added.props).toEqual({
        ...(image?.defaultProps as Record<string, unknown>),
        mediaId: added.props.mediaId,
      });
      expect(Object.keys(added).sort()).toEqual(
        ["id", "props", "type", "version"].sort()
      );
    }
    // Each with an id of its own.
    expect(new Set(children.map(child => child.id)).size).toBe(4);
  });

  it("adds nothing for no files, and refuses a node that is not a gallery", () => {
    const document = page(gallery("g", []), picture("lone", "m0"));
    expect(addPicturesOps(document, "g", [])).toEqual([]);
    expect(addPicturesOps(document, "lone", ["m1"])).toBeNull();
    expect(addPicturesOps(document, "missing", ["m1"])).toBeNull();
  });
});

describe("a picture inside a gallery", () => {
  it("is numbered from one among the gallery's pictures, in a gallery named as the author named it", () => {
    const document = page(
      gallery("g", [picture("p1", "m1"), picture("p2", "m2")], {
        name: "Team photos",
        props: { as: "div", whenClicked: "enlarge" },
      })
    );
    expect(galleryPictureOf(document, "p2")).toEqual({
      galleryId: "g",
      position: 2,
      galleryName: "Team photos",
      galleryChoice: "enlarge",
    });
  });

  it("is in a gallery called Gallery while the gallery has no name, which reads as Nothing while it says nothing", () => {
    const document = page(gallery("g", [picture("p1", "m1")]));
    expect(galleryPictureOf(document, "p1")).toEqual({
      galleryId: "g",
      position: 1,
      galleryName: "Gallery",
      galleryChoice: "nothing",
    });
  });

  it("is no gallery's picture outside one", () => {
    const document = page(picture("lone", "m0"), gallery("g", []));
    expect(galleryPictureOf(document, "lone")).toBeUndefined();
    expect(galleryPictureOf(document, "g")).toBeUndefined();
    expect(isGallery(document.nodes[1])).toBe(true);
    expect(isGallery(document.nodes[0])).toBe(false);
  });
});
