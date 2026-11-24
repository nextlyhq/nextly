/**
 * The judgement a type-change refusal names (`describeClassed`), read so two roads' refusals of one
 * change compare: its class and each reason with its count, the row whose value is lost named
 * `<lost>` and every other row `<row>`, since each road keys its rows by its own ids, and the reasons
 * in one order, since a road may list them in another.
 */
export function judgementIn(text: string, lost: string): string {
  const named = text
    .split(lost)
    .join("<lost>")
    .replace(/id [0-9a-f-]{36}/g, "id <row>");
  const found = /(blocked|lossy): ((?:[^()]|\([^()]*\))*)/.exec(named);
  if (found === null) return `(no judgement in: ${named})`;
  const reasons = (found[2] ?? "")
    .split("; ")
    .map(reason => reason.trim())
    .sort();
  return `${found[1]}: ${reasons.join("; ")}`;
}

/** A refusal as text, whichever shape a road answers it in: its message and its whole body. */
export function refusalText(answer: unknown): string {
  return `${answer instanceof Error ? answer.message : ""} ${JSON.stringify(answer)}`;
}
