/**
 * Whether the install has an administrator, as setup-status and the setup
 * routes ask it, kept once the answer is yes.
 *
 * The admin asks setup-status on every screen, signed in or not, and the
 * answer is a walk of the role graph (the `super-admin` role, every role
 * inheriting it, then whether anyone holds one): about four statements a
 * screen for an answer that changes only when roles, their inheritance or
 * their holders change. Every such change moves the role version
 * (`nextly_rbac_epoch`), in this process at once and in another within a
 * second, so a yes is kept under the version it was read at, and read again
 * once the version moves, or after a minute where nothing moves it.
 *
 * **Only a yes is kept.** A no is read every time: setup opens on it, so the
 * moment a first administrator exists the next answer has to say so, and a
 * no kept past that moment would offer setup to an install that has its
 * administrator. A kept yes errs the other way, refusing setup a little
 * longer, which grants nothing; and the setup itself checks again under the
 * role row's lock (`grantFirstAdministratorInTx`). While the role version
 * cannot be trusted nothing is kept, as for every cache filed under it.
 *
 * @module domains/users/services/administrator-known
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { refreshEpoch, stampIsCurrent } from "../../../services/lib/rbac-epoch";

import {
  superAdminRoleHeld,
  type FirstAdministratorTables,
} from "./last-super-admin";

/**
 * How long a yes is kept when the role version does not move: the bound,
 * where the version cannot be read, on how long a change made elsewhere goes
 * unseen. The same minute a user's resolved access is kept for.
 */
const ADMINISTRATOR_KEPT_MS = 60_000;

/** A yes, the role version it was read under, and when it lapses. */
interface KeptYes {
  epoch: string;
  until: number;
}

// On `globalThis`: a Next.js server holds several copies of a package's
// modules, and a copy each would read once per copy. The name carries the
// shape's version (`_v1`), raised with any change to it: a dev server keeps
// `globalThis` across a module reload, and must not hand reloaded code what
// an older build left.
const globalForAdministrator = globalThis as unknown as {
  __nextly_administratorKnown_v1?: WeakMap<object, KeptYes>;
};

function keptYeses(): WeakMap<object, KeptYes> {
  globalForAdministrator.__nextly_administratorKnown_v1 ??= new WeakMap();
  return globalForAdministrator.__nextly_administratorKnown_v1;
}

/**
 * Whether anyone holds the `super-admin` role in force on `adapter`'s
 * database (`superAdminRoleHeld`), a yes answered from what this process
 * kept while the role version it was read under stands. Errors propagate:
 * an unknown answer is never a no.
 */
export async function administratorExists(
  adapter: Pick<DrizzleAdapter, "getDrizzle">,
  tables: FirstAdministratorTables
): Promise<boolean> {
  const epoch = await refreshEpoch();
  const kept = keptYeses().get(adapter);
  if (
    kept !== undefined &&
    kept.until > Date.now() &&
    stampIsCurrent(kept.epoch)
  ) {
    return true;
  }
  const held = await superAdminRoleHeld(adapter.getDrizzle(), tables);
  // Kept only when the version it was read under still stands: a change
  // made while it was read may have replaced the rows it read.
  if (held && stampIsCurrent(epoch)) {
    keptYeses().set(adapter, {
      epoch,
      until: Date.now() + ADMINISTRATOR_KEPT_MS,
    });
  } else {
    keptYeses().delete(adapter);
  }
  return held;
}
