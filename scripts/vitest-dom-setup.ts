/**
 * The two test-environment rules, made boundaries rather than conventions.
 *
 * Both were previously left to each file to remember, and both fail SILENTLY
 * and in the reassuring direction — a file that forgets either one passes.
 *
 * ## Renders are torn down between cases
 *
 * `@testing-library/react` unmounts automatically only when something has
 * registered its cleanup. Nothing did. A file without its own `afterEach`
 * therefore accumulates every render into ONE document, and `querySelector`
 * answers with the FIRST case's element — so later cases assert against a tree
 * belonging to a test that has already finished, and agree with it.
 *
 * ## `act` is allowed to run
 *
 * `React.act` refuses to run unless `IS_REACT_ACT_ENVIRONMENT` is set, and the
 * refusal is a WARNING rather than a failure. A file missing it drives nothing,
 * asserts against the first render, and passes. The testing library sets the
 * flag only around its own `act`-wrapped calls, so anything driving React
 * directly — a mocked component's callback, a bare `act` in a test — is left
 * without it.
 *
 * ## Guarded, because most files here have no DOM
 *
 * Both packages that load this run `environment: "node"` and opt into jsdom
 * per file, so the majority of files that load it have no `document`. The work is done only
 * where there is one, and the testing library is imported only there: pulling
 * `react-dom` into a runtime that cannot host it would turn a setup file meant
 * to protect the DOM suites into a reason the node ones cannot start.
 *
 * ## One copy, outside every package
 *
 * Loaded by each package's vitest config by relative path rather than copied
 * into each one. Two copies of a rule this quiet is how a later fix reaches one
 * package and leaves the other silently on the old behaviour — and the whole
 * point of these two rules is that nothing tells you when they are missing.
 *
 * Here rather than in a package because it is dev tooling, not published
 * source: a shared module inside `packages/` would be a new entry in a
 * 25-package lockstep release for thirty lines no consumer ever loads. It also
 * imports `vitest`, so it cannot live in a package whose layering guard counts
 * anything in `src` that is not a test as source.
 */
import { afterEach } from "vitest";

if ("document" in globalThis) {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
