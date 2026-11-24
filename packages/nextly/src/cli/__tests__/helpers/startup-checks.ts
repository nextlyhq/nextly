/**
 * What `scripts/check-cli-startup.mjs` reads from the source, as one module:
 * the program, the helpers that list and judge its invocations, and the
 * start-up probe's variable and line. One module because the script loads
 * TypeScript through a loader that gives each load a graph of its own, and the
 * first-line declarations live in a module both the program and the judge use:
 * loaded apart, the judge would read a registry the program never wrote to.
 */
export { createProgram } from "../../program";
// The variable that stops a run once its command's code has loaded, and the line it writes then.
export { CODE_LOADED_LINE, STARTUP_PROBE_ENV } from "../../lazy-action";

export { answerOnlyInvocations, wrongAnswer } from "./answer-only-invocations";
export {
  codeLoadInvocations,
  commandPathOf,
  firstLineInvocations,
  firstNonBlankLine,
  wrongFirstLine,
} from "./first-line-invocations";
