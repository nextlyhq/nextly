// @vitest-environment jsdom
/**
 * `useBlockEnvironment()`: what a provider states, and the page's own
 * document and window, after mounting, where there is none.
 *
 * The properties that separate it from plausible wrong versions:
 *
 * - Inside a provider it answers with the PROVIDED objects, not the globals.
 *   The provider below hands it a document and window that are not the page's,
 *   so an implementation that read `globalThis` fails.
 * - A provider stating `undefined` (a frame not found yet) is still a
 *   provider: the hook answers `undefined`, not the admin page's globals.
 * - Outside a provider, the first render answers `undefined` and the render
 *   after mounting answers the page's own pair. An implementation that read
 *   the globals during render would pass the second half and fail the first,
 *   and one that never fell back would fail the second.
 *
 * The server render, which has no document at all, is
 * `environment.server.test.tsx`, in a node environment.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  BlockEnvironmentProvider,
  useBlockEnvironment,
  type BlockEnvironment,
} from "./environment";

afterEach(cleanup);

/** Records every answer the hook gives, in render order. */
function Probe({
  seen,
}: {
  seen: (BlockEnvironment | undefined)[];
}): React.JSX.Element {
  seen.push(useBlockEnvironment());
  return <span />;
}

describe("useBlockEnvironment", () => {
  it("answers with what the provider states, from the first render", () => {
    // A second document, with its own window, standing in for a canvas frame.
    const frame = document.implementation.createHTMLDocument("frame");
    const provided = {
      document: frame,
      window: { name: "frame window" } as unknown as Window,
    };
    const seen: (BlockEnvironment | undefined)[] = [];
    render(
      <BlockEnvironmentProvider value={provided}>
        <Probe seen={seen} />
      </BlockEnvironmentProvider>
    );

    expect(seen.length).toBeGreaterThan(0);
    for (const answer of seen) {
      expect(answer?.document).toBe(frame);
      expect(answer?.window).toBe(provided.window);
    }
    expect(seen.at(-1)?.document).not.toBe(document);
  });

  it("answers nothing, not the globals, while a provider states nothing", () => {
    const seen: (BlockEnvironment | undefined)[] = [];
    render(
      <BlockEnvironmentProvider value={undefined}>
        <Probe seen={seen} />
      </BlockEnvironmentProvider>
    );

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(answer => answer === undefined)).toBe(true);
  });

  it("falls back to the page's own document and window once mounted", () => {
    const seen: (BlockEnvironment | undefined)[] = [];
    render(<Probe seen={seen} />);

    // Nothing during the render a server would also produce, so hydration
    // sees the same markup.
    expect(seen[0]).toBeUndefined();
    // And the page's own pair after the effect ran.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)?.document).toBe(document);
    expect(seen.at(-1)?.window).toBe(window);
  });
});
