/**
 * Builds the declarations the published-surface guard reads.
 *
 * A script rather than something the suite does for itself, so the work is a
 * turbo task with declared inputs: scheduled, cached, and under no deadline.
 * It used to run inside a `beforeAll` with a wall-clock budget, which a loaded
 * runner exceeded — failing a package the branch had not touched.
 */
import { buildDeclarations } from "../src/__tests__/ensure-declarations.js";

buildDeclarations();
