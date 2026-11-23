/**
 * What `scripts/check-cli-startup.mjs` reads from the source, as one module:
 * the program and the helpers that list and judge its invocations. One module
 * because the script loads TypeScript through a loader that gives each load a
 * graph of its own, and the first-line declarations live in a module both the
 * program and the judge use: loaded apart, the judge would read a registry the
 * program never wrote to.
 */
export { createProgram } from "../../program";

export { answerOnlyInvocations, wrongAnswer } from "./answer-only-invocations";
export {
  commandPathOf,
  firstLineInvocations,
  firstNonBlankLine,
  wrongFirstLine,
} from "./first-line-invocations";
