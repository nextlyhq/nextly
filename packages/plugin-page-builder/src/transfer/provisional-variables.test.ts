/**
 * The variables an import's judging writes count as defined are seen by the
 * whole async flow they run, and by nothing outside it.
 */
import { describe, expect, it } from "vitest";

import {
  provisionalVariables,
  withProvisionalTokenIds,
  withProvisionalVariables,
} from "./provisional-variables";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("provisional variables", () => {
  it("are seen inside the run, after an await too", async () => {
    const seen = await withProvisionalVariables(["t-new"], async () => {
      const before = [...provisionalVariables()];
      await tick();
      return { before, after: [...provisionalVariables()] };
    });
    expect(seen).toEqual({ before: ["t-new"], after: ["t-new"] });
  });

  it("are empty outside a run, and once it has finished", async () => {
    expect(provisionalVariables().size).toBe(0);
    await withProvisionalVariables(["t-new"], async () => tick());
    expect(provisionalVariables().size).toBe(0);
  });

  it("do not reach a flow that started outside the run", async () => {
    // A request already in flight when the judgement begins keeps its own
    // empty view, so concurrent writes never borrow each other's variables.
    let outside: ReadonlySet<string> | undefined;
    const elsewhere = (async () => {
      await tick();
      outside = provisionalVariables();
    })();
    await withProvisionalVariables(["t-new"], async () => tick());
    await elsewhere;
    expect(outside?.size).toBe(0);
  });

  it("are added to the site's variables only inside a run", async () => {
    const site = new Set(["color.brand"]);
    // Outside: the site's own set, unchanged.
    expect(withProvisionalTokenIds(site)).toBe(site);
    const inside = await withProvisionalVariables(["t-new"], async () =>
      withProvisionalTokenIds(site)
    );
    expect([...inside].sort()).toEqual(["color.brand", "t-new"]);
    // The site's set itself is never widened.
    expect([...site]).toEqual(["color.brand"]);
  });
});
