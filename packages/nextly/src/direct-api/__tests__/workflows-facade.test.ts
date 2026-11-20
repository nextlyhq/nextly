/**
 * The module-level `nextly.workflows` facade offers every method the workflows
 * namespace has, and keeps its optional arguments optional.
 *
 * The facade lists its delegates by name; one written as a bare `args =>`
 * under `satisfies` keeps its own required parameter, so a call the namespace
 * allows with no argument fails to type-check against the facade.
 */
import { describe, expect, it } from "vitest";

import type { NextlyContext } from "../namespaces/context";
import { createWorkflowsNamespace } from "../namespaces/workflows";
import { nextly } from "../nextly";

describe("the nextly.workflows facade", () => {
  it("delegates every method of the workflows namespace", () => {
    const namespace = createWorkflowsNamespace({} as NextlyContext);
    expect(Object.keys(nextly.workflows).sort()).toEqual(
      Object.keys(namespace).sort()
    );
  });

  // The namespace declares list's argument optional, and the facade must keep
  // that for callers that pass none. The type checker reads this call; it is
  // never run, since the facade needs an initialised instance to answer.
  it("takes list with no argument", () => {
    const zeroArgumentCall = () => nextly.workflows.list();
    expect(typeof zeroArgumentCall).toBe("function");
  });
});
