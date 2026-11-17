// @vitest-environment jsdom

/**
 * The canvas states its document and window to the blocks it draws, on a page
 * that also holds a frame from another origin.
 *
 * A page with an Embed block has one: the embed's iframe is sandboxed without
 * `allow-same-origin`, so whatever it loads runs in an opaque origin, and the
 * admin window exposes it as its own indexed property, `window[0]`. Reading
 * anything off that object from the admin throws a `SecurityError`.
 *
 * Nothing in the canvas reads it. React's development build did: it describes
 * a re-rendered component's changed props for the browser's performance panel
 * by walking their own keys a few levels deep, and the canvas handed the
 * environment provider a plain `{ document, window }`. The walk went into the
 * admin window, reached `window[0]` and threw, in the middle of running the
 * commit's effects, so the effects after it never ran.
 *
 * Two things a browser has are modelled here, because jsdom and vitest have
 * neither:
 *
 * - a cross-origin frame: an object every read of which throws the error a
 *   browser throws, installed where a browser puts a child frame;
 * - `console.timeStamp`, which React checks for once, as it loads, before it
 *   describes anything. Vitest's console has none, and the shared DOM setup
 *   has already loaded React by the time this file runs, so a fresh copy of
 *   React is loaded after the console has it, and the modules under test are
 *   imported against that copy.
 *
 * The first case shows the model reproduces the throw through React itself.
 * Without it the canvas case could pass only because nothing walks the props.
 *
 * @module canvas-environment.test
 */
import { createRequire } from "node:module";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as ReactModule from "react";
import type * as ReactDomClient from "react-dom/client";

import type * as CanvasModule from "./canvas";

/** The copy of React the cases render with, and the modules built on it. */
interface Loaded {
  React: typeof ReactModule;
  createRoot: typeof ReactDomClient.createRoot;
  Canvas: typeof CanvasModule.Canvas;
  CANVAS_ROOT_CLASS: string;
}

/** The module ids that make up one copy of React. */
const REACT_MODULE = /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/;

/**
 * A window from another origin, as the admin sees it.
 *
 * Every question asked of it throws, which is what a browser does for any
 * property outside the short cross-origin allowlist — including `in`, the
 * first thing React's prop description asks of an object.
 */
function crossOriginWindow(): object {
  const refuse = (): never => {
    throw new DOMException(
      "Blocked a frame from accessing a cross-origin frame.",
      "SecurityError"
    );
  };
  return new Proxy(
    {},
    {
      get: refuse,
      has: refuse,
      getOwnPropertyDescriptor: refuse,
      ownKeys: refuse,
    }
  );
}

/** The window the cases render into. */
function testWindow(): Window {
  const view = document.defaultView;
  if (view === null) throw new Error("jsdom provided no window");
  return view;
}

/** A ResizeObserver that lets a case deliver the region's width. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  disconnect(): void {}
  unobserve(): void {}
}

const originalObserver = globalThis.ResizeObserver;

/**
 * A fresh copy of React in development, and the modules under test on it.
 *
 * One per case. A throw from React's prop description leaves that copy of
 * React believing it is still committing, so every later render on it fails
 * with "Should not already be working" — which is how the canvas stopped
 * following its controls, and also why a case that provokes the throw must not
 * share its React with the next one.
 */
async function load(): Promise<Loaded> {
  // A fresh copy of React, loaded now that the console has `timeStamp`. The
  // copy already loaded stays in use by whatever holds it; only the modules
  // imported below are pointed at this one.
  const require = createRequire(import.meta.url);
  const earlier = Object.keys(require.cache).filter(id =>
    REACT_MODULE.test(id)
  );
  const kept = new Map(earlier.map(id => [id, require.cache[id]]));
  for (const id of earlier) Reflect.deleteProperty(require.cache, id);
  const React = require("react") as typeof ReactModule;
  const reactDom = require("react-dom") as object;
  const client = require("react-dom/client") as typeof ReactDomClient;
  for (const [id, module] of kept) require.cache[id] = module;

  vi.resetModules();
  vi.doMock("react", () => ({ ...React, default: React }));
  vi.doMock("react-dom", () => ({ ...reactDom, default: reactDom }));
  vi.doMock("react-dom/client", () => ({ ...client, default: client }));

  const engine = await import("@nextlyhq/blocks-engine");
  const { useBlockEnvironment } = await import(
    "@nextlyhq/blocks-react/environment"
  );
  const canvas = await import("./canvas");

  /** What a block drawn on the canvas was told about where it is. */
  function EnvironmentReader(): ReactModule.ReactElement {
    const environment = useBlockEnvironment();
    const own = React.useRef<HTMLSpanElement>(null);
    React.useLayoutEffect(() => {
      const element = own.current;
      if (element === null) return;
      element.dataset.document = String(
        environment?.document === element.ownerDocument
      );
      element.dataset.window = String(
        environment?.window === element.ownerDocument.defaultView
      );
    });
    return React.createElement("span", { ref: own, "data-reader": "" });
  }

  engine.clearBlocks();
  engine.registerBlocks(
    [
      {
        name: "acme/reader",
        version: 1,
        description: "A block that reads where it is drawn.",
        example: { props: {} },
        render: () => React.createElement(EnvironmentReader),
      },
    ] as never,
    { source: "canvas-environment-test" }
  );

  return {
    React,
    createRoot: client.createRoot,
    Canvas: canvas.Canvas,
    CANVAS_ROOT_CLASS: canvas.CANVAS_ROOT_CLASS,
  };
}

beforeAll(() => {
  // A browser's console, as far as React asks of it.
  (console as { timeStamp?: () => void }).timeStamp = () => {};
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    FakeResizeObserver;
  Object.defineProperty(testWindow(), "0", {
    value: crossOriginWindow(),
    enumerable: true,
    configurable: true,
  });
});

afterAll(() => {
  Reflect.deleteProperty(testWindow(), "0");
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
    originalObserver;
  Reflect.deleteProperty(console, "timeStamp");
  vi.resetModules();
});

/** A fresh element to render into, and the root drawing there. */
function mount(loaded: Loaded): {
  host: HTMLElement;
  root: ReactDomClient.Root;
} {
  const host = document.createElement("div");
  document.body.append(host);
  return { host, root: loaded.createRoot(host) };
}

describe("React describing a window handed over as a prop", () => {
  it("throws the frame's SecurityError when the prop changes", async () => {
    // The instrument check. If React stopped describing changed props, or the
    // model stopped throwing, this case fails, and the canvas case below would
    // then pass for no reason.
    //
    // The prop is PRESENT and `undefined` first, as the provider's value is
    // before the canvas has mounted: React describes a prop that changed, and
    // lists one that merely appeared without looking inside it.
    const loaded = await load();
    const { React } = loaded;
    function Holder(props: { held: { window: Window } | undefined }) {
      return React.createElement("span", null, props.held ? "held" : "empty");
    }
    const { root } = mount(loaded);
    await React.act(async () => {
      root.render(React.createElement(Holder, { held: undefined }));
    });

    await expect(
      React.act(async () => {
        root.render(
          React.createElement(Holder, { held: { window: testWindow() } })
        );
      })
    ).rejects.toThrow(/cross-origin frame/);
  });
});

describe("the canvas on a page holding a cross-origin frame", () => {
  it("states its document and window, and its later commits still run their effects", async () => {
    const loaded = await load();
    const { React, Canvas, CANVAS_ROOT_CLASS } = loaded;
    const { host, root } = mount(loaded);
    const page = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "r", type: "acme/reader", version: 1, props: {} }],
    } as never;
    const sheet = { css: "", classes: {} } as never;

    await React.act(async () => {
      root.render(
        React.createElement(Canvas, { document: page, siteStyles: sheet })
      );
    });

    // The blocks were told where they are drawn.
    const reader = host.querySelector<HTMLElement>("[data-reader]");
    expect(reader?.dataset.document).toBe("true");
    expect(reader?.dataset.window).toBe("true");

    // And React finished that commit: a later one still runs its effects, so
    // a root reporter handed over after the environment arrived is told.
    const reported: unknown[] = [];
    await React.act(async () => {
      root.render(
        React.createElement(Canvas, {
          document: page,
          siteStyles: sheet,
          onRoot: (element: HTMLDivElement | null) => reported.push(element),
        })
      );
    });
    expect(reported).toContain(host.querySelector(`.${CANVAS_ROOT_CLASS}`));
    await React.act(async () => {
      root.unmount();
    });
  });
});
