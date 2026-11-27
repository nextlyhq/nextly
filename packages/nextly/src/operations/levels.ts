/**
 * The level of one run: the operation's declared level, raised by every rule
 * the run's input or target meets. The plan calls this before anything
 * changes, and hands its answer to the approval rules, which decide whether to
 * ask.
 *
 * @module operations/levels
 * @experimental
 */
import {
  RISK_LEVELS,
  type OperationRaise,
  type OperationRun,
  type RiskLevel,
} from "./definition";

/** Where `level` sits in the order, lowest first. */
export function levelRank(level: RiskLevel): number {
  return RISK_LEVELS.indexOf(level);
}

/** What one run is: its level, and whether "Always allow" may cover it. */
export interface RunLevel {
  readonly level: RiskLevel;
  readonly alwaysAllow: boolean;
}

/** The part of an operation's declaration that decides a run's level. */
interface LevelDeclaration<Input> {
  readonly level: RiskLevel;
  /**
   * A declaration leaves it out or sets `false`; the list's view always says
   * `true` or `false`. Either may be passed.
   */
  readonly alwaysAllow?: boolean;
  readonly raise?: readonly OperationRaise<Input>[];
}

/**
 * The level for this input and target: the highest of the declared level and
 * every rule that applies. A rule naming a lower level is refused when the
 * list is assembled; taking the highest here as well means such a rule could
 * not lower a run even if one got past that check. "Always allow" is lost when
 * the operation or any rule that applies says so.
 */
export function levelForRun<Input>(
  operation: LevelDeclaration<Input>,
  run: OperationRun<Input>
): RunLevel {
  let level = operation.level;
  let alwaysAllow = operation.alwaysAllow !== false;
  for (const rule of operation.raise ?? []) {
    // Only a plain "no" leaves a rule out. Any other answer (a promise from a
    // rule written to answer later, a value that isn't true or false) raises
    // the run, since a level computed too low is the harm to avoid.
    const answer: unknown = rule.applies(run);
    if (answer === false) continue;
    if (answer instanceof Promise) answer.catch(() => undefined);
    if (levelRank(rule.level) > levelRank(level)) level = rule.level;
    if (rule.alwaysAllow === false) alwaysAllow = false;
  }
  return { level, alwaysAllow };
}
