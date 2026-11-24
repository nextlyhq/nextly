/**
 * The default Layout settled after a test boot, which the suites that boot
 * the installed plugin start every case from.
 *
 * The plugin begins its own seed from `onReady` without awaiting it
 * (`seedDefaultLayoutAtStart`), and that run reads the instance as soon as
 * the services are registered. In a test boot that is before
 * `createTestNextly` seeds the Public role's grants (`seedPublic`), so a
 * starter header, whose list of pages visitors must be able to read, is
 * refused there as listing a field visitors can't see. A development start
 * seeds the grants before the run can read the instance; the harness seeds
 * them after.
 *
 * Usually that run has failed before the boot returns, and the suite's own
 * call then seeds. When the database is slow it is still in flight, and the
 * suite's call joins it (a run in flight is joined, not raced) and fails the
 * boot with the starter's refusal. So the run in flight is waited out first,
 * whatever it answers, and the default is then made as the jobs sweep makes
 * it: the suite's own run still fails the boot when it fails, since it runs
 * again.
 *
 * @module __tests__/settle-default-layout
 */
import type { EnsureOutcome } from "../default-layout/ensure-default";

/**
 * Settle the default after a boot: `ensure` is the suite's own call of
 * `ensureDefaultLayout`, made once to wait out the run in flight and once
 * more for the default the suite starts from.
 */
export async function settleDefaultLayout(
  ensure: () => Promise<EnsureOutcome>
): Promise<EnsureOutcome> {
  await ensure().catch(() => undefined);
  return ensure();
}
