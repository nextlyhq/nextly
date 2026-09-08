// @vitest-environment jsdom
/**
 * The test environment's own guarantees, asserted.
 *
 * `vitest.setup.ts` exists to make two rules boundaries rather than
 * conventions, and both of them fail silently: a suite that has lost either one
 * goes on passing. So the setup file's effect is not observable from any
 * ordinary test going green — which is exactly the shape it was written to
 * prevent, and the reason it needs a test of its own.
 *
 * These assert what the setup file PRODUCES, from a file that deliberately
 * declares neither rule itself. Delete `setupFiles` from `vitest.config.ts` and
 * every case here fails; that is the whole point of them.
 *
 * @module vitest-setup-boundary.test
 */
import { render, screen } from "@testing-library/react";
import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";

/*
 * ORDER MATTERS between the first two cases, unusually and deliberately: what
 * is under test is teardown BETWEEN tests, which no single case can observe.
 * The first renders and the second asks what survived it.
 */
describe("what the setup file guarantees a DOM suite", () => {
  it("renders into the document", () => {
    render(<p data-testid="left-behind">rendered by the first case</p>);

    expect(document.body.querySelector("[data-testid]")).not.toBeNull();
  });

  it("starts with the previous case's render already torn down", () => {
    /*
     * This file registers no `afterEach(cleanup)` of its own. Without the setup
     * file nothing unmounts, the render above is still in this document, and
     * every `querySelector` in this file answers with THAT element — a case
     * asserting against a test that has already finished, and agreeing.
     */
    expect(document.body.querySelector("[data-testid]")).toBeNull();
  });

  it("lets React.act drive an update, with no environment complaint", () => {
    /*
     * Driving React is the assertion, not the flag. `act` still runs and
     * flushes without `IS_REACT_ACT_ENVIRONMENT`; what the flag controls is
     * whether React reports the environment as unconfigured. So checking the
     * boolean would assert that the setup file set the value the setup file
     * set, and would stay green if the flag stopped meaning anything.
     */
    const complaints: string[] = [];
    const reported = vi
      .spyOn(console, "error")
      .mockImplementation((...args: unknown[]) => {
        complaints.push(args.map(String).join(" "));
      });

    try {
      let bump = (): void => {};
      function Counter(): React.JSX.Element {
        const [count, setCount] = useState(0);
        bump = () => setCount(value => value + 1);
        return <output data-testid="count">{count}</output>;
      }

      render(<Counter />);
      act(() => {
        bump();
      });

      // The update reached the DOM, so `act` did flush.
      expect(screen.getByTestId("count").textContent).toBe("1");
      // And React did not report the environment as unconfigured, which is the
      // half the flag actually decides.
      expect(
        complaints.filter(text =>
          text.includes("not configured to support act")
        )
      ).toEqual([]);
    } finally {
      reported.mockRestore();
    }
  });
});
