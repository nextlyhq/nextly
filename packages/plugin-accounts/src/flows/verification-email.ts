import {
  holdWhileUnverified,
  type AccountRow,
  type AccountsDb,
} from "../storage/accounts";

import { HOUR, MINUTE, type FlowDeps } from "./deps";
import { PURPOSES } from "./purposes";
import { secretFields } from "./secret-fields";

/** A verification email's secrets, each with the ref its queued email is sent by. */
export interface MintedVerification {
  link: { token: string; ref: string };
  code: { code: string; ref: string };
  notMe: { token: string; ref: string };
}

/** A verification email's secrets: its link, its code (voiding any earlier code) and its "this wasn't me" link. */
export async function mintVerification(
  deps: FlowDeps,
  tx: AccountsDb,
  subject: string
): Promise<MintedVerification> {
  const { core, settings } = deps;
  const linkMs = settings.verification.linkHours * HOUR;
  const link = await core.secrets.mintToken(
    { purpose: PURPOSES.verifyLink, subject, expiresInMs: linkMs },
    { tx }
  );
  const code = await core.secrets.mintCode(
    {
      purpose: PURPOSES.verifyCode,
      subject,
      expiresInMs: settings.verification.codeMinutes * MINUTE,
      digits: codeDigits(settings.verification.codeDigits),
      maxWrongTries: settings.verification.codeTries,
    },
    { tx }
  );
  const notMe = await core.secrets.mintToken(
    { purpose: PURPOSES.notMe, subject, expiresInMs: linkMs },
    { tx }
  );

  return { link, code, notMe };
}

/**
 * Mints the verification secrets while the account is held unverified at
 * the version read, so a verification or a change that ends sessions which
 * committed since is seen and nothing is minted (null).
 */
export async function mintWhileUnverified(
  deps: FlowDeps,
  account: Pick<AccountRow, "id" | "securityVersion">
): Promise<MintedVerification | null> {
  return deps.db.transaction(async tx =>
    (await holdWhileUnverified(tx, account))
      ? mintVerification(deps, tx, account.id)
      : null
  );
}

export async function queueVerification(
  deps: FlowDeps,
  account: Pick<AccountRow, "id" | "address">,
  minted: MintedVerification
): Promise<void> {
  await deps.mail.queue({
    kind: "verify-address",
    accountId: account.id,
    to: account.address,
    ...secretFields(deps.settings, "verify-address", {
      link: minted.link,
      code: minted.code,
      notMeLink: minted.notMe,
    }),
  });
}

/**
 * The settings bound the digits to 6 to 8, which core's helper takes as a
 * literal; anything else is a setting that skipped its bounds, refused here.
 */
export function codeDigits(digits: number): 6 | 7 | 8 {
  if (digits === 6 || digits === 7 || digits === 8) return digits;
  throw new RangeError(`A code of ${digits} digits is outside 6 to 8.`);
}
