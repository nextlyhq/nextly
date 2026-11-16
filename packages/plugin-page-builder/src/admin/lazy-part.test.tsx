// @vitest-environment jsdom

/**
 * A part of the plugin's admin whose code is fetched when it is first drawn:
 * that it draws nothing while the code arrives (an admin section whose body is
 * empty stays hidden), that it then draws the part with the
 * props it was given, that a failed fetch says so and fetches again when
 * asked, and that a part already fetched is drawn at once, without a second
 * fetch.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { lazyPart } from "./lazy-part";

afterEach(cleanup);

/** A fetch the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>;
}

describe("lazyPart", () => {
  it("fetches nothing until the part is drawn", () => {
    const load = vi.fn(() => Promise.resolve(Greeting));

    lazyPart(load);

    expect(load).not.toHaveBeenCalled();
  });

  it("draws nothing while the code arrives, then the part with its props", async () => {
    const fetch = deferred<typeof Greeting>();
    const Part = lazyPart(() => fetch.promise);

    const { container } = render(<Part name="Ada" />);

    expect(container.innerHTML).toBe("");

    fetch.resolve(Greeting);

    expect(await screen.findByText("Hello, Ada")).toBeTruthy();
  });

  it("says a failed fetch failed, and fetches again when asked", async () => {
    const first = deferred<typeof Greeting>();
    const load = vi
      .fn<() => Promise<typeof Greeting>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(Greeting);
    const Part = lazyPart(load);

    render(<Part name="Ada" />);
    first.reject(new Error("offline"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "This part of the page could not be loaded. Check your connection and try again."
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Hello, Ada")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("draws a part already fetched at once, without fetching it again", async () => {
    const load = vi.fn(() => Promise.resolve(Greeting));
    const Part = lazyPart(load);

    render(<Part name="Ada" />);
    await screen.findByText("Hello, Ada");
    cleanup();

    render(<Part name="Grace" />);

    // Synchronously: no loading state on the second mount.
    expect(screen.getByText("Hello, Grace")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shares one fetch between parts drawn while it is on its way", async () => {
    const fetch = deferred<typeof Greeting>();
    const load = vi.fn(() => fetch.promise);
    const Part = lazyPart(load);

    render(
      <>
        <Part name="Ada" />
        <Part name="Grace" />
      </>
    );
    fetch.resolve(Greeting);

    expect(await screen.findByText("Hello, Grace")).toBeTruthy();
    expect(screen.getByText("Hello, Ada")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
