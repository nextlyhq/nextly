// @vitest-environment jsdom
/**
 * A page that adds code of its own is a full-document boundary: reached by
 * the site's client-side navigation, it loads again as a whole document so
 * its loader runs; left that way, the next page loads as a whole document so
 * none of its scripts or styles stay behind. Loaded as a document, nothing
 * reloads, and React's development re-run of effects reloads nothing either.
 */
import { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PageCodeBoundary,
  type DocumentNavigation,
} from "./page-code-boundary";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A navigation whose address the test moves, and whose reloads it counts. */
function navigationAt(start: string) {
  let href = start;
  const queued: (() => void)[] = [];
  const navigation: DocumentNavigation = {
    href: () => href,
    reload: vi.fn(),
    later: run => {
      queued.push(run);
    },
  };
  return {
    navigation,
    go: (next: string) => {
      href = next;
    },
    /** Runs what was put off, as the browser's next task would. */
    settle: () => {
      for (const run of queued.splice(0)) run();
    },
  };
}

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

/** The boundary as the published page's HTML carries it, then hydrated. */
function loadAsDocument(navigation: DocumentNavigation, strict = false) {
  const tree = strict ? (
    <StrictMode>
      <PageCodeBoundary owner="head:1" navigation={navigation} />
    </StrictMode>
  ) : (
    <PageCodeBoundary owner="head:1" navigation={navigation} />
  );
  host = document.createElement("div");
  host.innerHTML = renderToString(tree);
  document.body.append(host);
  act(() => {
    root = hydrateRoot(host as HTMLElement, tree);
  });
}

/** The boundary as client-side navigation renders it, with no HTML. */
function reachByClient(navigation: DocumentNavigation) {
  host = document.createElement("div");
  document.body.append(host);
  act(() => {
    root = createRoot(host as HTMLElement);
    root.render(<PageCodeBoundary owner="head:1" navigation={navigation} />);
  });
}

describe("<PageCodeBoundary>", () => {
  it("reloads a page reached by client-side navigation, once the address is the page's", () => {
    const at = navigationAt("https://site.test/from");
    reachByClient(at.navigation);
    // Put off, so the router has moved the address first.
    expect(at.navigation.reload).not.toHaveBeenCalled();
    at.go("https://site.test/to");
    at.settle();
    expect(at.navigation.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads nothing on a page loaded as a document", () => {
    const at = navigationAt("https://site.test/page");
    loadAsDocument(at.navigation);
    at.settle();
    expect(at.navigation.reload).not.toHaveBeenCalled();
  });

  it("loads the next page as a document when the page is left by client-side navigation", () => {
    const at = navigationAt("https://site.test/page");
    loadAsDocument(at.navigation);
    at.go("https://site.test/next");
    act(() => root?.unmount());
    root = undefined;
    at.settle();
    expect(at.navigation.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads where a refresh at the same address takes the page's code away", () => {
    const at = navigationAt("https://site.test/page");
    loadAsDocument(at.navigation);
    // The server's new output has no boundary: the code is gone, the
    // address unmoved.
    act(() => root?.unmount());
    root = undefined;
    at.settle();
    expect(at.navigation.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads where a refresh at the same address changes the page's code, and not where it keeps it", () => {
    const at = navigationAt("https://site.test/page");
    loadAsDocument(at.navigation);
    act(() =>
      root?.render(
        <PageCodeBoundary owner="head:1" navigation={at.navigation} />
      )
    );
    at.settle();
    expect(at.navigation.reload).not.toHaveBeenCalled();
    act(() =>
      root?.render(
        <PageCodeBoundary owner="head:2" navigation={at.navigation} />
      )
    );
    at.settle();
    expect(at.navigation.reload).toHaveBeenCalledTimes(1);
  });

  it("reloads nothing where React re-runs its effects in development, the address unmoved", () => {
    const at = navigationAt("https://site.test/page");
    loadAsDocument(at.navigation, true);
    at.settle();
    expect(at.navigation.reload).not.toHaveBeenCalled();
  });
});
