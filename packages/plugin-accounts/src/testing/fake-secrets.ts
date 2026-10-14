import { createHash, randomBytes, randomInt } from "node:crypto";

import type { OneTimeSecrets, SecretData, TxOption } from "../core/ports";

import {
  FakeCoreMisuse,
  roundTrip,
  type FakeClock,
  type FakeTransactions,
} from "./fake-transactions";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PURPOSE = /^[a-z][a-z0-9.-]{0,63}$/;

interface StoredSecret {
  readonly kind: "token" | "code";
  readonly purpose: string;
  readonly subject: string;
  /** A token's SHA-256, or a code as typed. */
  readonly value: string;
  readonly data: SecretData | null;
  readonly expiresAt: number;
  state: "live" | "spent" | "void";
  /** A transaction is spending it: no other caller can. */
  claimed: boolean;
  triesLeft: number;
}

/** A secret as the plugin received it, which a test reads as the email would carry it. */
export interface MintedSecret {
  readonly kind: "token" | "code";
  readonly purpose: string;
  readonly subject: string;
  readonly secret: string;
  readonly data: SecretData | null;
}

/**
 * Core's one-purpose secrets, kept in memory, with core's bounds and its
 * transaction rules: a write given `{ tx }` lands at that transaction's
 * commit, and `consumeCode` refuses to run inside one. A void secret
 * answers as a spent one.
 */
export class FakeOneTimeSecrets implements OneTimeSecrets {
  readonly #stored: StoredSecret[] = [];
  readonly #clock: FakeClock;
  readonly #transactions: FakeTransactions;
  /** Every secret minted, in the order minted. */
  readonly minted: MintedSecret[] = [];

  constructor(clock: FakeClock, transactions: FakeTransactions) {
    this.#clock = clock;
    this.#transactions = transactions;
  }

  /** The last secret minted for a subject and purpose. */
  lastMinted(subject: string, purpose: string): MintedSecret | undefined {
    return [...this.minted]
      .reverse()
      .find(secret => secret.subject === subject && secret.purpose === purpose);
  }

  async mintToken(
    input: Parameters<OneTimeSecrets["mintToken"]>[0],
    options?: TxOption
  ): Promise<{ token: string; expiresAt: Date }> {
    await roundTrip();
    checkCommon(input, MINUTE, 30 * DAY);
    const token = randomBytes(32).toString("base64url");
    const stored = this.#store("token", input, hashOf(token), 0);
    this.#transactions.write("mintToken", options, () => {
      if (input.voidEarlier === true)
        this.#voidLive("token", input.purpose, input.subject);
      this.#stored.push(stored);
    });
    this.minted.push({
      kind: "token",
      purpose: input.purpose,
      subject: input.subject,
      secret: token,
      data: stored.data,
    });

    return { token, expiresAt: new Date(stored.expiresAt) };
  }

  async mintCode(
    input: Parameters<OneTimeSecrets["mintCode"]>[0],
    options?: TxOption
  ): Promise<{ code: string; expiresAt: Date }> {
    await roundTrip();
    checkCommon(input, MINUTE, 60 * MINUTE);
    const digits = input.digits ?? 6;
    if (![6, 7, 8].includes(digits))
      throw new FakeCoreMisuse(`a code of ${digits} digits`);
    if (
      !Number.isInteger(input.maxWrongTries) ||
      input.maxWrongTries < 1 ||
      input.maxWrongTries > 10
    ) {
      throw new FakeCoreMisuse(
        `maxWrongTries ${input.maxWrongTries} is outside 1 to 10`
      );
    }
    const code = String(randomInt(0, 10 ** digits)).padStart(digits, "0");
    const stored = this.#store("code", input, code, input.maxWrongTries);
    this.#transactions.write("mintCode", options, () => {
      this.#voidLive("code", input.purpose, input.subject);
      this.#stored.push(stored);
    });
    this.minted.push({
      kind: "code",
      purpose: input.purpose,
      subject: input.subject,
      secret: code,
      data: stored.data,
    });

    return { code, expiresAt: new Date(stored.expiresAt) };
  }

  async peekToken(input: {
    purpose: string;
    token: string;
  }): ReturnType<OneTimeSecrets["peekToken"]> {
    await roundTrip();
    const found = this.#token(input);
    if (!found.ok) return found;

    return {
      ok: true,
      subject: found.stored.subject,
      data: found.stored.data,
      expiresAt: new Date(found.stored.expiresAt),
    };
  }

  async consumeToken(
    input: { purpose: string; token: string },
    options?: TxOption
  ): ReturnType<OneTimeSecrets["consumeToken"]> {
    await roundTrip();
    const found = this.#token(input);
    if (!found.ok) return found;
    const { stored } = found;
    stored.claimed = true;
    this.#transactions.write(
      "consumeToken",
      options,
      () => {
        stored.state = "spent";
        stored.claimed = false;
      },
      () => {
        stored.claimed = false;
      }
    );

    return {
      ok: true,
      subject: stored.subject,
      data: stored.data,
    };
  }

  async consumeCode(input: {
    purpose: string;
    subject: string;
    code: string;
  }): ReturnType<OneTimeSecrets["consumeCode"]> {
    this.#transactions.assertNone("consumeCode");
    await roundTrip();
    const stored = [...this.#stored]
      .reverse()
      .find(
        secret =>
          secret.kind === "code" &&
          secret.purpose === input.purpose &&
          secret.subject === input.subject
      );
    if (stored === undefined) return { ok: false, reason: "none" };
    if (stored.state !== "live" || stored.claimed)
      return { ok: false, reason: "spent" };
    if (this.#clock.now() >= stored.expiresAt)
      return { ok: false, reason: "expired" };
    if (stored.value === input.code) {
      stored.state = "spent";
      return { ok: true, data: stored.data };
    }
    stored.triesLeft -= 1;
    if (stored.triesLeft === 0) stored.state = "void";

    return {
      ok: false,
      reason: "wrong",
      triesLeft: stored.triesLeft,
    };
  }

  async voidFor(
    input: { subject: string; purposes?: readonly string[] },
    options?: TxOption
  ): Promise<{ voided: number }> {
    await roundTrip();
    const live = this.#stored.filter(
      secret =>
        secret.subject === input.subject &&
        secret.state === "live" &&
        !secret.claimed &&
        (input.purposes === undefined ||
          input.purposes.includes(secret.purpose))
    );
    this.#transactions.write("voidFor", options, () => {
      for (const secret of live) secret.state = "void";
    });

    return { voided: live.length };
  }

  #store(
    kind: StoredSecret["kind"],
    input: {
      purpose: string;
      subject: string;
      expiresInMs: number;
      data?: SecretData;
    },
    value: string,
    triesLeft: number
  ): StoredSecret {
    return {
      kind,
      purpose: input.purpose,
      subject: input.subject,
      value,
      data: input.data ?? null,
      expiresAt: this.#clock.now() + input.expiresInMs,
      state: "live",
      claimed: false,
      triesLeft,
    };
  }

  #voidLive(
    kind: StoredSecret["kind"],
    purpose: string,
    subject: string
  ): void {
    for (const secret of this.#stored) {
      if (
        secret.kind === kind &&
        secret.purpose === purpose &&
        secret.subject === subject &&
        secret.state === "live"
      ) {
        secret.state = "void";
      }
    }
  }

  #token(input: {
    purpose: string;
    token: string;
  }):
    | { ok: true; stored: StoredSecret }
    | { ok: false; reason: "invalid" | "expired" | "spent" } {
    const hash = hashOf(input.token);
    const stored = this.#stored.find(
      secret =>
        secret.kind === "token" &&
        secret.purpose === input.purpose &&
        secret.value === hash
    );
    if (stored === undefined) return { ok: false, reason: "invalid" };
    if (stored.state !== "live" || stored.claimed)
      return { ok: false, reason: "spent" };
    if (this.#clock.now() >= stored.expiresAt)
      return { ok: false, reason: "expired" };

    return { ok: true, stored };
  }
}

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function checkCommon(
  input: {
    purpose: string;
    subject: string;
    expiresInMs: number;
    data?: SecretData;
  },
  shortest: number,
  longest: number
): void {
  if (!PURPOSE.test(input.purpose))
    throw new FakeCoreMisuse(`purpose "${input.purpose}" is not allowed`);
  if (input.subject.length === 0 || input.subject.length > 255) {
    throw new FakeCoreMisuse("a subject must be 1 to 255 characters");
  }
  if (input.expiresInMs < shortest || input.expiresInMs > longest) {
    throw new FakeCoreMisuse(
      `expiresInMs ${input.expiresInMs} is outside ${shortest} to ${longest}`
    );
  }
  if (
    input.data !== undefined &&
    Buffer.byteLength(JSON.stringify(input.data)) > 1024
  ) {
    throw new FakeCoreMisuse("data is over 1 KB serialised");
  }
}
