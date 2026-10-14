import { LIMIT_RULES } from "../core/limit-rules";
import type { LimitEntry, SecretData } from "../core/ports";
import {
  accountByAddress,
  changeAddressAtVersion,
  holdAtVersion,
  normaliseAddress,
  type AccountRow,
  type AccountsDb,
} from "../storage/accounts";
import {
  askAddressChange,
  pendingChangeById,
  pendingChangeOf,
  takePendingChange,
} from "../storage/pending-changes";
import { endAccountSessions } from "../storage/sessions";

import { HOUR, MINUTE, type FlowDeps } from "./deps";
import { provenHolder, sessionHolder } from "./holder";
import { ADDRESS } from "./input";
import { pageLink } from "./links";
import { queueNotice } from "./mail";
import { attemptSucceeded, type AttemptRefusal } from "./password-attempt";
import { PURPOSES } from "./purposes";
import { spendCode } from "./spend-code";
import { codeDigits } from "./verification-email";

const CHANGE_PURPOSES = [
  PURPOSES.addressChangeLink,
  PURPOSES.addressChangeCode,
  PURPOSES.addressChangeCancel,
];

export type AddressChangeRequestResult =
  | { status: "accepted" }
  | { status: "signed-out" }
  | { status: "refused"; reason: "invalid-address" | "same-address" }
  | { status: "refused"; reason: "too-many-requests"; retryAfterMs: number }
  | AttemptRefusal;

/**
 * The holder asks to change their address. The current password is asked
 * for and counted as a sign-in attempt is; the request is counted per
 * account, per new address and per client before any of its work. The
 * answer, the pending change and the old address's email, with its link to
 * cancel, are the same whether or not the new address is another account's;
 * only the new address's email differs: its link and code when it is free,
 * and word that someone tried to use it when it is not. A new request
 * replaces the account's pending one.
 */
export async function requestAddressChange(
  deps: FlowDeps,
  input: {
    sessionToken: string;
    currentPassword: string;
    newAddress: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<AddressChangeRequestResult> {
  const parsed = ADDRESS.safeParse(input.newAddress);
  if (!parsed.success) return { status: "refused", reason: "invalid-address" };
  const proven = await provenHolder(deps, {
    ...input,
    password: input.currentPassword,
  });
  if (proven.status !== "proven") return proven;
  const { account, attempt, now } = proven;
  // The current password is proven, so the attempt is settled whatever
  // becomes of the request, as a change of password settles it.
  await attemptSucceeded(deps, attempt);
  const newKey = normaliseAddress(parsed.data);
  if (newKey === account.addressNormalised)
    return { status: "refused", reason: "same-address" };

  const counted = await reserveChange(deps, {
    accountId: account.id,
    newKey,
    client: input.client,
  });
  if (counted !== null) return counted;

  const other = await accountByAddress(deps.db, parsed.data);
  const secrets = await deps.db.transaction(tx =>
    askChange(deps, tx, {
      account,
      newAddress: parsed.data,
      free: other === null,
      now,
    })
  );
  if (secrets === null) return { status: "refused", reason: "try-again" };
  await deps.mail.queue({
    kind: "address-change-asked",
    accountId: account.id,
    to: account.address,
    newAddress: parsed.data,
    cancelLink: pageLink(deps.settings, "cancelAddressChange", secrets.cancel),
  });
  if (other !== null) {
    await deps.mail.queue({
      kind: "address-in-use",
      accountId: other.id,
      to: other.address,
    });
  } else if (secrets.link !== null && secrets.code !== null) {
    await deps.mail.queue({
      kind: "confirm-new-address",
      accountId: account.id,
      to: parsed.data,
      link: pageLink(deps.settings, "confirmAddress", secrets.link),
      code: secrets.code,
    });
  }

  return { status: "accepted" };
}

/** The request's counts: per account, per new address and per client. Null when admitted. */
async function reserveChange(
  deps: FlowDeps,
  input: { accountId: string; newKey: string; client: string | null }
): Promise<AddressChangeRequestResult | null> {
  const entries: LimitEntry[] = [
    { rule: LIMIT_RULES.addressChangeAccount, key: input.accountId },
    { rule: LIMIT_RULES.addressChangeNew, key: input.newKey },
  ];
  if (input.client !== null)
    entries.push({ rule: LIMIT_RULES.emailClient, key: input.client });
  const reservation = await deps.core.limits.reserve(entries);
  if (reservation.status === "admitted") return null;
  if (reservation.status === "unavailable")
    return { status: "refused", reason: "try-again" };

  return {
    status: "refused",
    reason: "too-many-requests",
    retryAfterMs: reservation.retryAfterMs,
  };
}

/**
 * The pending change and its secrets, replacing any earlier one: the old
 * address's cancel link always, the new address's link and code only when
 * it is free. Each names the change, so a link from an earlier request
 * never confirms a later one. Written only while the account is at the
 * version the holder's session was proven at: a password change, a reset
 * or a sign-out everywhere that committed since ended that session, and
 * nothing is asked (null).
 */
async function askChange(
  deps: FlowDeps,
  tx: AccountsDb,
  input: { account: AccountRow; newAddress: string; free: boolean; now: Date }
): Promise<{
  cancel: string;
  link: string | null;
  code: string | null;
} | null> {
  const { core, settings } = deps;
  const subject = input.account.id;
  if (!(await holdAtVersion(tx, input.account))) return null;
  const lifeMs = settings.verification.linkHours * HOUR;
  await core.secrets.voidFor({ subject, purposes: CHANGE_PURPOSES }, { tx });
  const change = await askAddressChange(tx, {
    accountId: subject,
    newAddress: input.newAddress,
    expiresAt: new Date(input.now.getTime() + lifeMs),
  });
  const data: SecretData = { change: change.id };
  const cancel = await core.secrets.mintToken(
    {
      purpose: PURPOSES.addressChangeCancel,
      subject,
      expiresInMs: lifeMs,
      data,
    },
    { tx }
  );
  if (!input.free) return { cancel: cancel.token, link: null, code: null };
  const link = await core.secrets.mintToken(
    { purpose: PURPOSES.addressChangeLink, subject, expiresInMs: lifeMs, data },
    { tx }
  );
  const code = await core.secrets.mintCode(
    {
      purpose: PURPOSES.addressChangeCode,
      subject,
      expiresInMs: settings.verification.codeMinutes * MINUTE,
      digits: codeDigits(settings.verification.codeDigits),
      maxWrongTries: settings.verification.codeTries,
      data,
    },
    { tx }
  );

  return { cancel: cancel.token, link: link.token, code: code.code };
}

export type AddressChangeResult =
  | { status: "changed" }
  /** Confirmed only inside a signed-in session of the account that asked. */
  | { status: "sign-in-needed" }
  | {
      status: "refused";
      reason: "invalid" | "expired" | "spent" | "taken" | "try-again";
    }
  | { status: "refused"; reason: "wrong-code"; triesLeft: number }
  | { status: "refused"; reason: "too-many-tries"; retryAfterMs: number };

/** Ends a change's transaction with this answer, rolling it back. */
class Refusal extends Error {
  constructor(
    readonly reason: "invalid" | "expired" | "spent" | "taken" | "try-again"
  ) {
    super(reason);
  }
}

/**
 * Confirms an address change by the link sent to the new address, inside a
 * signed-in session of the account that asked.
 */
export async function confirmAddressChangeByLink(
  deps: FlowDeps,
  input: { sessionToken: string; token: string }
): Promise<AddressChangeResult> {
  const holder = await sessionHolder(deps, input.sessionToken);
  if (holder === null) return { status: "sign-in-needed" };
  const peeked = await deps.core.secrets.peekToken({
    purpose: PURPOSES.addressChangeLink,
    token: input.token,
  });
  if (!peeked.ok) return { status: "refused", reason: peeked.reason };
  if (peeked.subject !== holder.account.id) return { status: "sign-in-needed" };

  return applyChange(deps, holder, changeOf(peeked.data), async tx => {
    const spent = await deps.core.secrets.consumeToken(
      { purpose: PURPOSES.addressChangeLink, token: input.token },
      { tx }
    );
    return spent.ok;
  });
}

/**
 * Confirms an address change by the code sent to the new address, inside a
 * signed-in session of the account that asked. Each try is reserved first
 * against the new address's tries in 24 hours, and the code is spent on its
 * own, outside any transaction; a right code gives its try back.
 */
export async function confirmAddressChangeByCode(
  deps: FlowDeps,
  input: { sessionToken: string; code: string }
): Promise<AddressChangeResult> {
  const holder = await sessionHolder(deps, input.sessionToken);
  if (holder === null) return { status: "sign-in-needed" };
  const pending = await pendingChangeOf(deps.db, holder.account.id);
  if (pending === null) return { status: "refused", reason: "invalid" };

  const spent = await spendCode(deps, {
    addressKey: pending.newAddressNormalised,
    purpose: PURPOSES.addressChangeCode,
    subject: holder.account.id,
    code: input.code,
  });
  if (spent.status === "refused") return spent;

  return applyChange(deps, holder, changeOf(spent.data));
}

/**
 * The old address's link cancels the pending change it names, voiding the
 * change's link and code. No session is needed: the old address's owner
 * may not be signed in.
 */
export async function cancelAddressChange(
  deps: FlowDeps,
  input: { token: string }
): Promise<
  | { status: "cancelled" }
  | { status: "refused"; reason: "invalid" | "expired" | "spent" }
> {
  const { core } = deps;
  try {
    await deps.db.transaction(async tx => {
      const spent = await core.secrets.consumeToken(
        { purpose: PURPOSES.addressChangeCancel, token: input.token },
        { tx }
      );
      if (!spent.ok) throw new Refusal(spent.reason);
      const change = changeOf(spent.data);
      if (change === null || !(await takePendingChange(tx, change, deps.now())))
        throw new Refusal("spent");
      await core.secrets.voidFor(
        { subject: spent.subject, purposes: CHANGE_PURPOSES },
        { tx }
      );
    });
  } catch (error) {
    if (error instanceof Refusal) {
      return {
        status: "refused",
        reason:
          error.reason === "expired" || error.reason === "invalid"
            ? error.reason
            : "spent",
      };
    }
    throw error;
  }

  return { status: "cancelled" };
}

/**
 * Applies a confirmed change, in one transaction: the secret spent, the
 * pending change taken (so a cancellation, or anything that cancelled it,
 * wins only if it committed first, and a change past its time never
 * applies), the new address still free, the address moved at the version
 * the holder's session read, every other session ended and every link and
 * code voided. Then the old address is told.
 */
async function applyChange(
  deps: FlowDeps,
  holder: { session: { tokenHash: string }; account: AccountRow },
  changeId: string | null,
  spend?: (tx: AccountsDb) => Promise<boolean>
): Promise<AddressChangeResult> {
  const { account } = holder;
  const pending =
    changeId === null ? null : await pendingChangeById(deps.db, changeId);
  if (pending === null || pending.accountId !== account.id)
    return { status: "refused", reason: "spent" };
  try {
    await deps.db.transaction(async tx => {
      if (spend !== undefined && !(await spend(tx))) throw new Refusal("spent");
      if (!(await takePendingChange(tx, pending.id, deps.now())))
        throw new Refusal("expired");
      const moved = await changeAddressAtVersion(
        tx,
        deps.dialect,
        account,
        pending.newAddress
      );
      if (moved !== "changed")
        throw new Refusal(moved === "taken" ? "taken" : "try-again");
      await endAccountSessions(tx, account.id, {
        except: holder.session.tokenHash,
      });
      await deps.core.secrets.voidFor({ subject: account.id }, { tx });
    });
  } catch (error) {
    if (error instanceof Refusal)
      return { status: "refused", reason: error.reason };
    throw error;
  }
  await queueNotice(deps, {
    kind: "address-changed",
    accountId: account.id,
    to: account.address,
    newAddress: pending.newAddress,
  });

  return { status: "changed" };
}

/** The change a secret names, from the data it was minted with. */
function changeOf(data: SecretData | null): string | null {
  return typeof data?.change === "string" ? data.change : null;
}
