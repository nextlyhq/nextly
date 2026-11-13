/**
 * The public id an API key carries, which the server can verify without a
 * database lookup.
 *
 * A key is `nx_live_<id>_<secret>`. The id is 12 random hex characters and a
 * 12-character tag, an HMAC of them under a key derived from the install's
 * secret, so only this install can make an id that verifies. A request whose
 * source the server cannot resolve has its failed key lookups bounded per
 * verified id, before any lookup: an invented id does not verify and buys no
 * budget of its own, so a flood of invalid keys cannot refuse a valid key
 * that carries an id.
 *
 * Every generation of the secret verifies an id, so rotating `NEXTLY_SECRET`
 * with the old one in `NEXTLY_SECRET_PREVIOUS` keeps every key's id. An id that
 * verifies under none is treated as no id at all (the bound shared by keys
 * without one), never refused for it, so a key outlives a lost secret.
 *
 * @module domains/auth/lib/api-key-id
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { env } from "../../../shared/lib/env";
import { keyedDigest } from "../../../shared/lib/keyed-digest";
import { generationsCurrentFirst } from "../../../shared/lib/secret-generations";

/** What the API-key-id use of the install's secret is called. */
const ID_KEY_INFO = "nextly api key ids";

/** Hex characters of randomness, and of tag, in an id. */
const RANDOM_HEX = 12;
const TAG_HEX = 12;

/**
 * A key that carries an id: the prefix, 24 hex characters, an underscore and
 * the 43-character secret. A key made before ids (`nx_live_` and 43 characters)
 * is shorter, so the two shapes never match one string.
 */
const KEY_WITH_ID = /^nx_live_([0-9a-f]{24})_[A-Za-z0-9_-]{43}$/;

function tagOf(random: string, secret: string | undefined): string {
  return keyedDigest(ID_KEY_INFO, random, secret ?? "").slice(0, TAG_HEX);
}

/** A new id, tagged under the current secret. */
export function mintApiKeyId(): string {
  const random = randomBytes(RANDOM_HEX / 2).toString("hex");
  const [current] = generationsCurrentFirst(
    env.NEXTLY_SECRET,
    env.NEXTLY_SECRET_PREVIOUS
  );
  return `${random}${tagOf(random, current)}`;
}

/**
 * The id `rawKey` carries when it verifies under a generation of the install's
 * secret, or `null`: a key made before ids, any other string, or an id this
 * install did not make.
 */
export function verifiedApiKeyId(rawKey: string): string | null {
  const match = KEY_WITH_ID.exec(rawKey);
  if (!match) return null;
  const id = match[1];
  const random = id.slice(0, RANDOM_HEX);
  const tag = Buffer.from(id.slice(RANDOM_HEX));
  for (const secret of generationsCurrentFirst(
    env.NEXTLY_SECRET,
    env.NEXTLY_SECRET_PREVIOUS
  )) {
    if (timingSafeEqual(Buffer.from(tagOf(random, secret)), tag)) return id;
  }
  return null;
}
