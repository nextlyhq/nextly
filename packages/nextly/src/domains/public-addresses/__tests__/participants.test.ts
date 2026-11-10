import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  addParticipant,
  addressHeldError,
  firstHolder,
  hasParticipants,
  onParticipantsChange,
  recordEverywhere,
  removeParticipant,
  type AddressHolder,
  type HeldAddress,
  type HeldAddressUpdate,
  type ParticipantRunner,
} from "../participants";

const tx = {} as TransactionContext;
const post: AddressHolder = { collection: "posts", id: "p1" };
const page: AddressHolder = { collection: "pages", id: "1", label: "Hello" };
const en: HeldAddress = { locale: "en", path: "/blog/hello" };
const fr: HeldAddress = { locale: "fr", path: "/blog/bonjour" };

/** A participant that answers from `held` and remembers what it was told. */
function fake(held: Map<string, AddressHolder> = new Map()) {
  const asked: { address: HeldAddress; batch: readonly HeldAddressUpdate[] }[] =
    [];
  const recorded: (readonly HeldAddressUpdate[])[] = [];
  const runner: ParticipantRunner = {
    async holderOf(address, asker, batch) {
      asked.push({ address, batch });
      const holder = held.get(`${address.locale}|${address.path}`);
      return holder ?? null;
    },
    async record(batch) {
      recorded.push(batch);
    },
  };
  return { runner, asked, recorded };
}

const added: ParticipantRunner[] = [];
function join(runner: ParticipantRunner): void {
  addParticipant(runner, "plugin:test");
  added.push(runner);
}

afterEach(() => {
  for (const runner of added.splice(0)) removeParticipant(runner);
});

describe("the question participants share", () => {
  it("asks every participant about every address, in order", async () => {
    const quiet = fake();
    const holding = fake(new Map([["fr|/blog/bonjour", page]]));
    join(quiet.runner);
    join(holding.runner);
    const update = { holder: post, holds: [en, fr] };

    const clash = await firstHolder(update, [update], tx);

    expect(clash).toEqual({ address: fr, heldBy: page });
    expect(quiet.asked.map(a => a.address)).toEqual([en, fr]);
    expect(holding.asked.map(a => a.address)).toEqual([en, fr]);
  });

  it("is no clash where a participant names the asker itself", async () => {
    join(
      fake(new Map([["en|/blog/hello", { ...post, label: "Mine" }]])).runner
    );
    const update = { holder: post, holds: [en] };

    expect(await firstHolder(update, [update], tx)).toBeNull();
  });

  it("hands each participant the whole batch", async () => {
    const one = fake();
    join(one.runner);
    const update = { holder: post, holds: [en] };
    const other = { holder: page, holds: [] };

    await firstHolder(update, [update, other], tx);

    expect(one.asked[0]?.batch).toEqual([update, other]);
  });

  it("records with every participant", async () => {
    const one = fake();
    const two = fake();
    join(one.runner);
    join(two.runner);
    const batch = [{ holder: post, holds: [en] }];

    await recordEverywhere(batch, tx);

    expect(one.recorded).toEqual([batch]);
    expect(two.recorded).toEqual([batch]);
  });

  it("a throwing participant fails the question", async () => {
    const broken = new Error("store unreachable");
    join({
      holderOf: () => Promise.reject(broken),
      record: () => Promise.resolve(),
    });
    const update = { holder: post, holds: [en] };

    await expect(firstHolder(update, [update], tx)).rejects.toBe(broken);
  });

  it("knows whether anyone takes part, and says when that changes", () => {
    const counts: number[] = [];
    const stop = onParticipantsChange(count => counts.push(count));
    const one = fake();

    expect(hasParticipants()).toBe(false);
    addParticipant(one.runner, "plugin:test");
    expect(hasParticipants()).toBe(true);
    removeParticipant(one.runner);
    stop();

    expect(hasParticipants()).toBe(false);
    expect(counts).toEqual([1, 0]);
  });
});

describe("the refusal", () => {
  it("names the address, language and both documents", () => {
    const error = addressHeldError(
      { holder: post, holds: [en] },
      { address: en, heldBy: page }
    );

    expect(error.code).toBe("DUPLICATE");
    expect(error.publicMessage).toBe(
      '/blog/hello (en) is already the address of "Hello" in pages. Choose another address for this entry.'
    );
  });

  it("names a holder without a label by its id", () => {
    const error = addressHeldError(
      { holder: post, holds: [en] },
      { address: en, heldBy: { collection: "pages", id: "1" } }
    );

    expect(error.publicMessage).toBe(
      "/blog/hello (en) is already the address of the entry 1 in pages. Choose another address for this entry."
    );
  });
});
