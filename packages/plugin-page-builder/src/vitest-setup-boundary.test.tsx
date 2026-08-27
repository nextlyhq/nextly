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
 * @module admin/vitest-setup-boundary.test
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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

  it("allows React.act to actually run", () => {
    /*
     * `React.act` refuses without this flag and the refusal is a warning, so a
     * suite missing it drives nothing and asserts against the first render.
     * Read from the global rather than from a rendered effect because the
     * failure mode is precisely that driving React quietly does nothing.
     */
    expect(
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
        .IS_REACT_ACT_ENVIRONMENT
    ).toBe(true);
  });
});
