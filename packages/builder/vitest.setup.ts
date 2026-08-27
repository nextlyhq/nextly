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
 * This package runs `environment: "node"` and opts into jsdom per file, so the
 * majority of files that load this have no `document`. The work is done only
 * where there is one, and the testing library is imported only there: pulling
 * `react-dom` into a runtime that cannot host it would turn a setup file meant
 * to protect the DOM suites into a reason the node ones cannot start.
 *
 * Stated per package rather than shared from one place, which is the shape
 * `plugin-form-builder` already uses. A shared module would be a new published
 * package in a 25-package lockstep release for thirty lines that differ only
 * in which suites they guard.
 */
import { afterEach } from "vitest";

if ("document" in globalThis) {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
