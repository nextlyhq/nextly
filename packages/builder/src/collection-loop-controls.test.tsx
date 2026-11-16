// @vitest-environment jsdom

/**
 * The collections a list or a condition may name, as the inspector's
 * controls ask the host for them on every selection: shown at once when the
 * host hands back an answer it kept, read when it hands a new one, and never
 * shown from another host's answer.
 *
 * The host is stood in for twice: one that keeps its answer (as the page
 * builder keeps it for the signed-in author), and one that reads each time.
 * What is counted is what the host asks the server, and what the controls
 * draw in their first frame, before any answer could arrive.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  useLoopCollections,
  type LoopCollections,
} from "./collection-loop-controls";
import { ShowWhen } from "./condition-controls";
import type { ContentServices, LoopCollection } from "./content-controls";
import { useEditorState } from "./editor-state";

afterEach(cleanup);

const POSTS: LoopCollection = {
  slug: "posts",
  label: "Posts",
  singular: "Post",
  fields: [{ name: "title", label: "Title", kind: "text" }],
  declared: ["id", "title"],
  readable: [{ name: "title", label: "Title", type: "text" }],
};

/** A host that reads once and hands the same read after, counting reads. */
function keepingHost(collections: readonly LoopCollection[] = [POSTS]): {
  list: () => Promise<readonly LoopCollection[]>;
  reads: () => number;
} {
  let reads = 0;
  let kept: Promise<readonly LoopCollection[]> | undefined;
  return {
    list: () => {
      if (kept === undefined) {
        reads += 1;
        kept = Promise.resolve(collections);
      }
      return kept;
    },
    reads: () => reads,
  };
}

/** A host that reads each time it is asked, counting reads. */
function readingHost(): {
  list: () => Promise<readonly LoopCollection[]>;
  reads: () => number;
} {
  let reads = 0;
  return {
    list: () => {
      reads += 1;
      return Promise.resolve([POSTS]);
    },
    reads: () => reads,
  };
}

/** Every answer the controls drew, frame by frame. */
function Probe({
  list,
  drawn,
}: {
  list: () => Promise<readonly LoopCollection[]>;
  drawn: (LoopCollections | undefined)[];
}): null {
  drawn.push(useLoopCollections(list));
  return null;
}

/** Selecting a block: its controls mount, and whatever arrives is drawn. */
async function select(
  list: () => Promise<readonly LoopCollection[]>
): Promise<(LoopCollections | undefined)[]> {
  const drawn: (LoopCollections | undefined)[] = [];
  const { unmount } = render(<Probe list={list} drawn={drawn} />);
  await act(async () => {
    await Promise.resolve();
  });
  unmount();
  return drawn;
}

describe("useLoopCollections", () => {
  it("shows a kept answer in the first frame, with no read of its own", async () => {
    const host = keepingHost();
    const first = await select(host.list);
    expect(first[0]?.kind).toBe("loading");
    expect(first.at(-1)?.kind).toBe("ready");
    const second = await select(host.list);
    expect(second[0]).toEqual({ kind: "ready", collections: [POSTS] });
    expect(second.every(each => each?.kind === "ready")).toBe(true);
    expect(host.reads()).toBe(1);
  });

  it("reads again for a host that hands a new read, and shows it loading", async () => {
    const host = readingHost();
    await select(host.list);
    const second = await select(host.list);
    expect(second[0]?.kind).toBe("loading");
    expect(second.at(-1)?.kind).toBe("ready");
    expect(host.reads()).toBe(2);
  });

  it("never shows one host's answer for another's, as for another author", async () => {
    const first = keepingHost([POSTS]);
    await select(first.list);
    const other = keepingHost([]);
    const drawn = await select(other.list);
    expect(drawn[0]?.kind).toBe("loading");
    expect(drawn.at(-1)).toEqual({ kind: "ready", collections: [] });
  });

  it("shows a failure as such, and asks again on the next selection", async () => {
    let reads = 0;
    const failing = () => {
      reads += 1;
      return Promise.reject(new Error("offline"));
    };
    expect((await select(failing)).at(-1)?.kind).toBe("failed");
    await select(failing);
    expect(reads).toBe(2);
  });
});

describe("Show when across selections", () => {
  const DOCUMENT = {
    formatVersion: 1,
    kind: "page",
    nodes: ["a", "b"].map(id => ({
      id,
      type: "core/heading",
      version: 1,
      props: {},
      visibility: {
        conditions: [[{ field: "title", op: "contains", value: "guide" }]],
      },
    })),
  } as BlockDocument;

  function Host({
    nodeId,
    services,
  }: {
    nodeId: string;
    services: ContentServices;
  }): React.JSX.Element {
    const editor = useEditorState({ initialDocument: DOCUMENT });
    // Keyed by the block, as the inspector draws each selection's controls.
    return (
      <ShowWhen
        key={nodeId}
        editor={editor}
        nodeId={nodeId}
        services={services}
      />
    );
  }

  it("names its fields at once on the next selection, with one read for both", async () => {
    const host = keepingHost();
    const services: ContentServices = {
      listLoopCollections: host.list,
      entryCollection: "posts",
    };
    const { rerender } = render(<Host nodeId="a" services={services} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTitle("Title contains “guide”")).toBeTruthy();
    rerender(<Host nodeId="b" services={services} />);
    // No wait: the field's label is drawn in the selection's first frame.
    expect(screen.getByTitle("Title contains “guide”")).toBeTruthy();
    expect(host.reads()).toBe(1);
  });
});
