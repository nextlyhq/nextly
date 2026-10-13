/**
 * One check of a contract suite: a name and an async body that throws
 * `ContractViolation` when the implementation under test breaks the contract.
 *
 * The suites return plain cases rather than calling a test framework, so a
 * provider plugin runs them under whichever runner it uses and no framework is
 * pulled into this package:
 *
 * ```ts
 * for (const c of await paymentProviderContract(options)) it(c.name, c.run);
 * ```
 *
 * @experimental
 */
export interface ContractCase {
  readonly name: string;
  run(): Promise<void>;
}

/**
 * The failure a contract case throws: the implementation under test did not
 * do what the contract says.
 *
 * @experimental
 */
export class ContractViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractViolation";
  }
}

/**
 * Fail the case with `message` unless `condition` holds.
 *
 * @experimental
 */
export function expectContract(
  condition: unknown,
  message: string
): asserts condition {
  if (!condition) throw new ContractViolation(message);
}

/**
 * Run `body` and fail the case unless it throws, returning what it threw so
 * the case can check which refusal it was.
 *
 * @experimental
 */
export async function expectRefusal(
  body: () => Promise<unknown>,
  message: string
): Promise<unknown> {
  try {
    await body();
  } catch (error) {
    return error;
  }
  throw new ContractViolation(message);
}

/** @experimental */
export interface ContractRun {
  readonly passed: readonly string[];
  readonly failed: readonly {
    readonly name: string;
    readonly error: unknown;
  }[];
}

/**
 * Run every case in order and report which passed and which failed, without
 * stopping at the first failure. For a runner with no `it` of its own, and for
 * proving a suite catches a broken implementation.
 *
 * @experimental
 */
export async function runContractCases(
  cases: readonly ContractCase[]
): Promise<ContractRun> {
  const passed: string[] = [];
  const failed: { name: string; error: unknown }[] = [];
  for (const c of cases) {
    try {
      await c.run();
      passed.push(c.name);
    } catch (error) {
      failed.push({ name: c.name, error });
    }
  }
  return { passed, failed };
}
