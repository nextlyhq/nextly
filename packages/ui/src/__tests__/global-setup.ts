/**
 * Build the declarations the surface guard reads, before any suite runs.
 *
 * A global setup is the one place every entry point passes through — `test`,
 * `test:watch`, `test:ui` and `test:coverage` alike — so a clean checkout works
 * from any of them without a manual build step.
 *
 * It runs once per project rather than once per run, which is why the suite
 * that depends on these declarations calls the same routine itself.
 */
import { ensureDeclarations } from "./ensure-declarations";

export default function setup(): void {
  ensureDeclarations();
}
