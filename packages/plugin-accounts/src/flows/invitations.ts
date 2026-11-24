import { createHash } from "node:crypto";

import { z } from "zod";

import {
  accountByAddress,
  createAccount,
  normaliseAddress,
} from "../storage/accounts";
import { rememberBrowser } from "../storage/known-browsers";
import { startSession } from "../storage/sessions";

import { DAY, sessionLimits, type FlowDeps } from "./deps";
import {
  EMAIL_REQUESTS,
  reserveEmailRequest,
  type EmailRequestVerdict,
} from "./email-limits";
import { expiryFor } from "./expiry";
import { ADDRESS, nameAndAddress } from "./input";
import { pageLink } from "./links";
import {
  accountPasswordRefusal,
  type AccountPasswordRefusal,
} from "./new-password";
import { PURPOSES } from "./purposes";
import { secretFields } from "./secret-fields";
import type { StartedSession } from "./verify";

/**
 * What the site's own code keeps with an invitation and is handed back when
 * it is accepted, to tie the new account to a record of its own: a flat
 * record of plain values.
 *
 * @experimental
 */
export type InvitationData = Readonly<
  Record<string, string | number | boolean | null>
>;

/** The app's data as the plugin takes it: at most 20 short keys of plain values. */
const APP_DATA = z
  .record(
    z.string().min(1).max(64),
    z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()])
  )
  .refine(record => Object.keys(record).length <= 20);

/** The most a secret's data may hold, as JSON: core refuses more. */
const SECRET_DATA_BYTES = 1024;

/** What an invitation's secret carries, read back when it is used. */
const INVITED = z.strictObject({
  address: z.string(),
  name: z.string(),
  data: z.string().nullable(),
});

/**
 * The subject an address's invitations are minted under: a digest of the
 * normalised address, the same however it is cased or spaced, so a new
 * invitation replaces the last one; and of a fixed length, within core's
 * bound on a subject, which an address may be longer than.
 */
export function invitationSubject(address: string): string {
  const digest = createHash("sha256")
    .update(normaliseAddress(address), "utf8")
    .digest("hex");

  return `invitation-${digest}`;
}

export type InviteResult =
  | { status: "invited"; token: string; link: string; expiresAt: Date }
  | {
      status: "refused";
      reason: "invalid-name" | "invalid-address" | "invalid-data";
    }
  | Extract<EmailRequestVerdict, { status: "refused" }>;

/**
 * Invites an address: a link for it alone, minted through core's
 * one-purpose secrets, which keep only its hash, good for the site's
 * invitation days and spent once. A new invitation to the same address
 * voids the one before it. It is issued whether sign-up is open or closed,
 * and counted against the address, and the client where one is given, as
 * every request that emails an address is.
 *
 * An address that already has an account is answered exactly as a free
 * one, with a link of the same kind, so the answer never shows whether an
 * address has an account; that link is refused when used, and the email,
 * where the plugin sends it, tells the holder to sign in instead.
 */
export async function invite(
  deps: FlowDeps,
  input: {
    address: string;
    name: string;
    data?: unknown;
    sendEmail: boolean;
    client: string | null;
  }
): Promise<InviteResult> {
  const given = nameAndAddress(input);
  if (given.status === "refused") return given;
  const { name, address } = given;
  const appData =
    input.data === undefined ? null : APP_DATA.safeParse(input.data);
  if (appData !== null && !appData.success)
    return { status: "refused", reason: "invalid-data" };
  const carried = {
    address,
    name,
    data: appData === null ? null : JSON.stringify(appData.data),
  };
  if (Buffer.byteLength(JSON.stringify(carried), "utf8") > SECRET_DATA_BYTES)
    return { status: "refused", reason: "invalid-data" };

  const verdict = await reserveEmailRequest(deps, {
    kind: EMAIL_REQUESTS.invitation,
    addressKey: normaliseAddress(address),
    client: input.client,
  });
  if (verdict.status === "refused") return verdict;

  const { settings } = deps;
  const minted = await deps.core.secrets.mintToken({
    purpose: PURPOSES.invitation,
    subject: invitationSubject(address),
    expiresInMs: settings.invitationLinkDays * DAY,
    data: carried,
    voidEarlier: true,
  });
  const fields = secretFields(settings, "invitation", { link: minted });
  if (input.sendEmail) {
    const existing = await accountByAddress(deps.db, address);
    await deps.mail.queue(
      existing === null
        ? {
            kind: "invitation",
            accountId: null,
            to: address,
            ...fields,
            // Its template may greet the person by name and say when the
            // link stops working, in the site's time zone. Inviting again
            // sends the new link's expiry, through this same path.
            name,
            ...expiryFor(minted.expiresAt, settings.timeZone),
          }
        : {
            kind: "invitation-has-account",
            accountId: existing.id,
            to: existing.address,
            signInLink: pageLink(settings, "signIn"),
            resetLink: pageLink(settings, "reset"),
          }
    );
  }

  return {
    status: "invited",
    token: minted.token,
    link: fields.link,
    expiresAt: minted.expiresAt,
  };
}

/**
 * Withdraws the address's invitation, if it has one: its link is refused
 * from then on. True when there was one to withdraw.
 */
export async function withdrawInvitation(
  deps: Pick<FlowDeps, "core">,
  input: { address: string }
): Promise<boolean> {
  const address = ADDRESS.safeParse(input.address);
  if (!address.success) return false;
  const { voided } = await deps.core.secrets.voidFor({
    subject: invitationSubject(address.data),
    purposes: [PURPOSES.invitation],
  });

  return voided > 0;
}

export type AcceptInvitationResult =
  | {
      status: "accepted";
      account: { id: string; address: string; name: string };
      data: InvitationData | null;
      session: StartedSession;
      knownBrowserToken: string;
    }
  | {
      status: "refused";
      reason: "invalid" | "expired" | "spent" | "other-address" | "has-account";
    }
  | AccountPasswordRefusal;

/** Ends the acceptance's transaction with this answer, rolling it back. */
class Refusal extends Error {
  constructor(
    readonly reason: "invalid" | "expired" | "spent" | "has-account"
  ) {
    super(reason);
  }
}

/**
 * Accepts an invitation: makes the account for the invited address and no
 * other, with the name the site gave and the password chosen here, held to
 * every rule a new password is, the breached-password lookup counted
 * against the invitation. The address is verified by the link, so the
 * account signs in at once: in one transaction the link is spent, the
 * account made, a session started and this browser marked known. Of two
 * uses of one link, even at the same moment, the database lets one spend
 * it, so exactly one account is made; the other changes nothing. An
 * `address`, where the caller has one, must be the invited one, or nothing
 * is spent. Other plugins hear of it, with the site's data.
 */
export async function acceptInvitation(
  deps: FlowDeps,
  input: { token: string; password: string; address?: string }
): Promise<AcceptInvitationResult> {
  const { core, settings } = deps;
  const peeked = await core.secrets.peekToken({
    purpose: PURPOSES.invitation,
    token: input.token,
  });
  if (!peeked.ok) return { status: "refused", reason: peeked.reason };
  const invited = INVITED.safeParse(peeked.data);
  if (!invited.success) return { status: "refused", reason: "invalid" };
  const { address, name } = invited.data;
  // Read before anything is written, so the account is never made with
  // data that cannot be handed back.
  const data = appDataOf(invited.data.data);
  if (data === undefined) return { status: "refused", reason: "invalid" };
  if (
    input.address !== undefined &&
    normaliseAddress(input.address) !== normaliseAddress(address)
  )
    return { status: "refused", reason: "other-address" };
  if ((await accountByAddress(deps.db, address)) !== null)
    return { status: "refused", reason: "has-account" };

  const refusal = await accountPasswordRefusal(
    deps,
    peeked.subject,
    input.password
  );
  if (refusal !== null) return refusal;
  const passwordHash = await core.passwords.hash(input.password);

  const now = deps.now();
  const session = core.opaque.create();
  const browser = core.opaque.create();
  let made;
  try {
    made = await deps.db.transaction(async tx => {
      const spent = await core.secrets.consumeToken(
        { purpose: PURPOSES.invitation, token: input.token },
        { tx }
      );
      if (!spent.ok) throw new Refusal(spent.reason);
      const created = await createAccount(tx, deps.dialect, {
        address,
        name,
        passwordHash,
        createdAt: now,
        verified: { at: now, by: "invitation" },
      });
      // A refusal aborts the transaction on PostgreSQL, so the link's spend
      // is rolled back with it.
      if (created.status === "taken") throw new Refusal("has-account");
      const started = await startSession(
        tx,
        { accountId: created.account.id, tokenHash: session.hash, now },
        sessionLimits(settings)
      );
      await rememberBrowser(
        tx,
        { accountId: created.account.id, tokenHash: browser.hash, now },
        settings.knownBrowsers.perAccount
      );
      return { account: created.account, started };
    });
  } catch (error) {
    if (error instanceof Refusal)
      return { status: "refused", reason: error.reason };
    throw error;
  }

  deps.events.emit("nextlyhq-plugin-accounts.invitation.accepted", {
    accountId: made.account.id,
    data,
  });

  return {
    status: "accepted",
    account: {
      id: made.account.id,
      address: made.account.address,
      name: made.account.name,
    },
    data,
    session: {
      token: session.secret,
      expiresAt: made.started.absoluteExpiresAt,
    },
    knownBrowserToken: browser.secret,
  };
}

/**
 * The site's data as it was kept: null where it kept none, undefined where
 * what is kept is not data the plugin wrote.
 */
function appDataOf(kept: string | null): InvitationData | null | undefined {
  if (kept === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(kept);
  } catch {
    return undefined;
  }
  const parsed = APP_DATA.safeParse(value);

  return parsed.success ? parsed.data : undefined;
}
