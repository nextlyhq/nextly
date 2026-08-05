import { namespacedGlobalName } from "@nextlyhq/blocks-engine";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createBlockRegistry } from "../core/registry";
import { documentScopeClass, nodeClass } from "../core/style-compiler";
import { makeNode } from "../core/tree";
import type { BlockDefinition } from "../core/types";
import { PageRenderer } from "./PageRenderer";

// Minimal in-test blocks so the infra test doesn't depend on the real block set (M3.2).
const heading: BlockDefinition = {
  type: "core/heading",
  version: 1,
  label: "H",
  icon: "",
  category: "basic",
  defaultProps: {},
  render: ({ props, className }) => (
    <h2 className={className}>{String(props.text ?? "")}</h2>
  ),
};
const container: BlockDefinition = {
  type: "core/container",
  version: 1,
  label: "C",
  icon: "",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {},
  render: ({ slots, className }) => (
    <section className={className}>{slots.default}</section>
  ),
};

function registry() {
  const r = createBlockRegistry();
  r.register(heading);
  r.register(container);
  return r;
}

describe("PageRenderer", () => {
  it("renders the page root + one <style> and nests blocks", () => {
    const inner = makeNode("core/heading", { text: "Hello world" });
    const root = makeNode(
      "core/container",
      {},
      { base: { padding: { top: "10px" } } },
      {
        default: [inner],
      }
    );
    const html = renderToStaticMarkup(
      <PageRenderer
        document={{ version: 1, root }}
        registry={registry()}
        customCss=".x{color:red}"
      />
    );
    expect(html).toContain("nx-pb-page");
    expect(html).toContain("Hello world");
    expect(html).toContain("<style");
    expect(html).toContain("padding-top: 10px");
    // Custom CSS is scoped to THIS document's class, and the element carries it
    // alongside the shared `nx-pb-page` a host styles against.
    const scope = documentScopeClass({ version: 1, root });
    expect(html).toContain(`class="nx-pb-page ${scope}"`);
    expect(html).toContain(`.${scope} .x`);
  });

  it("gives two documents on one page separate scopes", () => {
    // `nx-pb-page` is on every document by design, so it cannot also be what
    // separates them. Sharing it means one document's custom CSS applies inside
    // the other, and their `@keyframes` resolve to whichever `<style>` came
    // last — a collision that depends on render order and nothing else.
    const first = { version: 1 as const, root: makeNode("core/container", {}) };
    const second = {
      version: 1 as const,
      root: makeNode("core/container", {}),
    };
    const render = (doc: typeof first, css: string): string =>
      renderToStaticMarkup(
        <PageRenderer document={doc} registry={registry()} customCss={css} />
      );

    const a = render(
      first,
      "@keyframes fade { from { opacity: 0 } } .x{color:red}"
    );
    const b = render(
      second,
      "@keyframes fade { from { opacity: 1 } } .x{color:blue}"
    );

    const scopeA = documentScopeClass(first);
    const scopeB = documentScopeClass(second);
    expect(scopeA).not.toBe(scopeB);
    expect(a).toContain(`.${scopeA} .x`);
    expect(b).toContain(`.${scopeB} .x`);
    // The namespaced animation names have to differ too: they are resolved in
    // one flat space for the whole document, so equal names are one animation.
    expect(a).toContain(namespacedGlobalName("fade", scopeA));
    expect(b).toContain(namespacedGlobalName("fade", scopeB));
    expect(a).not.toContain(namespacedGlobalName("fade", scopeB));
  });

  it("keeps a document's scope stable across renders", () => {
    // The class is written into the markup by one render and into the
    // stylesheet by the same one, so a scope that changed per render would
    // anchor the styles to a class the next render's markup does not carry.
    const doc = { version: 1 as const, root: makeNode("core/container", {}) };
    expect(documentScopeClass(doc)).toBe(documentScopeClass(doc));
  });

  it("applies the scoped class to the block's OWN element (no wrapper div)", () => {
    const inner = makeNode("core/heading", { text: "Hi" });
    const root = makeNode("core/container", {}, undefined, {
      default: [inner],
    });
    const html = renderToStaticMarkup(
      <PageRenderer document={{ version: 1, root }} registry={registry()} />
    );
    // The heading's own <h2> carries the scoped class — not a wrapper <div>.
    expect(html).toContain(`<h2 class="${nodeClass(inner.id)}"`);
    expect(html).toContain(`<section class="${nodeClass(root.id)}"`);
  });

  it("injects sanitized per-block custom CSS into the page style", () => {
    const inner = makeNode("core/heading", { text: "Hi" });
    inner.customCss = "selector { color: tomato; }";
    const root = makeNode("core/container", {}, undefined, {
      default: [inner],
    });
    const html = renderToStaticMarkup(
      <PageRenderer document={{ version: 1, root }} registry={registry()} />
    );
    // Assert the scoped selector and declaration together, so an unscoped
    // `selector{color:tomato}` leak would fail this test (selector isolation).
    expect(html).toMatch(
      new RegExp(`\\.${nodeClass(inner.id)}[^{]*\\{[^}]*color:tomato`)
    );
  });

  it("applies css id + safe custom attributes to the block root, dropping unsafe ones", () => {
    const inner = makeNode("core/heading", { text: "Hi" });
    inner.cssId = "hero";
    inner.attributes = { "data-track": "1", onclick: "alert(1)" };
    const root = makeNode("core/container", {}, undefined, {
      default: [inner],
    });
    const html = renderToStaticMarkup(
      <PageRenderer document={{ version: 1, root }} registry={registry()} />
    );
    expect(html).toContain('id="hero"');
    expect(html).toContain('data-track="1"');
    expect(html).not.toContain("onclick");
  });

  it("renders a safe fallback for unknown block types and keeps rendering the page", () => {
    const unknown = { id: "u1", type: "acme/mystery", props: {} };
    const root = makeNode("core/container", {}, undefined, {
      default: [
        unknown as never,
        makeNode("core/heading", { text: "still here" }),
      ],
    });
    const html = renderToStaticMarkup(
      <PageRenderer document={{ version: 1, root }} registry={registry()} />
    );
    expect(html).toContain("data-nx-unknown");
    expect(html).toContain("still here");
  });
});
