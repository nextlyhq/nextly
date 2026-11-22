// @vitest-environment jsdom

/**
 * A lazy part's code fetched before the part is drawn: a screen whose address
 * says the part is next asks for it at once, and the part, once drawn, takes
 * that fetch instead of asking again. A failed early fetch is forgotten, so
 * the draw fetches afresh; a wrapper that is not a lazy part is ignored.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazyPart, preloadPart } from "./lazy-part";

afterEach(cleanup);

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

describe("preloadPart", () => {
  it("fetches the code before the first draw, and the draw takes that fetch", async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const Part = lazyPart(load);

    preloadPart(Part);
    expect(load).toHaveBeenCalledTimes(1);
    preloadPart(Part);
    expect(load).toHaveBeenCalledTimes(1);

    render(<Part name="Ada" />);
    expect(await screen.findByText("Hello, Ada")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed early fetch, so the draw fetches again", async () => {
    const load = vi
      .fn<() => Promise<typeof Greeting>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Greeting);
    const Part = lazyPart(load);

    preloadPart(Part);
    await Promise.resolve();
    await Promise.resolve();

    render(<Part name="Ada" />);
    expect(await screen.findByText("Hello, Ada")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a component that is not a lazy part", () => {
    expect(() => preloadPart(Greeting)).not.toThrow();
  });
});
