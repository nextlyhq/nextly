import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import "../blocks";

import { QueryLoopView } from "./QueryLoopView";
import type { QueryResult } from "./types";

function loopNode() {
  const heading = makeNode("core/heading", { text: "x", level: "h3" });
  heading.bindings = { text: { source: "field", path: "title" } };
  return makeNode("core/query-loop", { collection: "posts" }, undefined, {
    default: [heading],
  });
}

const render = (result: QueryResult) =>
  renderToStaticMarkup(
    <QueryLoopView
      node={loopNode()}
      registry={defaultBlockRegistry}
      className="nx"
      result={result}
      budget={{ n: 5 }}
    />
  );

describe("QueryLoopView", () => {
  it("renders the config state when skipped", () => {
    expect(render({ items: [], skipped: true })).toContain(
      'data-nx-query-loop="config"'
    );
  });

  it("renders the empty state", () => {
    expect(render({ items: [] })).toContain('data-nx-query-loop="empty"');
  });

  it("renders the error state", () => {
    expect(render({ items: [], error: "boom" })).toContain(
      'data-nx-query-loop="error"'
    );
  });

  it("expands the template once per item with bindings resolved", () => {
    const html = render({
      items: [
        { id: "1", title: "First" },
        { id: "2", title: "Second" },
      ],
    });
    expect(html).toContain("First");
    expect(html).toContain("Second");
    expect(html).toContain('data-nx-loop-item="0"');
    expect(html).toContain('data-nx-loop-item="1"');
  });
});
