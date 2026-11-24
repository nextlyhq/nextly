/**
 * The tries of one entry write: made again, from what its before hooks left, where a save changed
 * its collection while the write waited for it.
 *
 * A write loads its collection's definition, asks its access rules, runs its before hooks,
 * validates, and only then opens its transaction and holds the collection (`holdEntityForWrite`).
 * Where the save it waited for changed the definition, the write is refused under the hold, before
 * any statement, to be made again from the definition as it stands.
 *
 * Nothing of the site's own code runs twice for it:
 *
 * - A before hook may send mail, call another service or count, which no rollback takes back. What
 *   its step left is kept, and a later try is handed that (`kept`).
 * - An access rule's answer is kept for the tries after it (`askOnce`), as the answer of a write
 *   that waits once is kept through its wait, until the write has its hold; what is asked under
 *   the hold is asked as always.
 *
 * So a write made again means what its hooks made of it: they ran against the earlier definition,
 * and the entry is written in the later one, as though the write had been sent just before the save
 * and landed just after it. A field the caller or a hook set that the save removed, or stores
 * differently, refuses the write by name rather than making it again (`refuseMadeFromEarlier`).
 *
 * Only where a save can hold entries (`savesHoldEntriesHere`): elsewhere a write is made once, and
 * nothing is kept for a try that cannot come, so no write pays a copy of its data for one.
 *
 * @module domains/collections/services/write-tries
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { isProductionRuntime } from "../../../shared/builder-refusal";
import { detachData } from "../../../shared/lib/detach";

import type { HeldTries } from "./entry-write-hold";

/** How many times a write is made, the first included. */
export const WRITE_TRIES = 3;

/** The tries of the write running now. A write made inside another's hook has its own. */
const running = new AsyncLocalStorage<WriteTries>();

/** What one try came to. */
type Outcome<T> = { readonly value: T } | { readonly error: unknown };

/**
 * Whether a write here may wait for a save that changes its collection's definition. A Schema
 * Builder save is the one that holds entries, and none runs in production. Anything else that comes
 * to hold them while a server runs says so here.
 */
export function savesHoldEntriesHere(): boolean {
  return !isProductionRuntime();
}

export class WriteTries implements HeldTries {
  /** When the write has waited as long as it may for its hold, once its first hold is sought. */
  private waitsUntil: number | undefined;
  /** How many tries have been started. */
  private made = 0;
  /** Whether the try under way was refused as made from a definition that changed. */
  private changed = false;
  /** Whether the try under way has its hold, with its definition found to stand. */
  private holds = false;
  /** What each step left the first time it ran. */
  private readonly left = new Map<string, unknown>();
  /** Each question's answer, as a try last heard it. */
  private readonly answers = new Map<string, unknown>();

  /** `again` says whether the write may be made again: decided once, for the whole write. */
  constructor(private readonly again: boolean = savesHoldEntriesHere()) {}

  /** Whether the try under way is a later one, made from what the first left. */
  get madeAgain(): boolean {
    return this.made > 1;
  }

  /**
   * Whether the try under way is a later one that has no hold yet: from its hold on, what runs is
   * the write itself, and what its hooks make, which no earlier try reached.
   */
  get replaying(): boolean {
    return this.madeAgain && !this.holds;
  }

  /** Whether the try under way can be made again, so refusing it costs the write nothing. */
  get remakes(): boolean {
    return this.again && this.made < WRITE_TRIES;
  }

  /**
   * Makes the write, and makes it again while a try is refused as made from a definition that
   * changed, up to `WRITE_TRIES` in all, `reload` reading the definitions afresh before each later
   * try; where no try is left, the refusal stands.
   */
  async make<T>(
    write: () => Promise<T>,
    reload: () => Promise<void>
  ): Promise<T> {
    for (;;) {
      this.made += 1;
      this.changed = false;
      this.holds = false;
      const outcome = await running.run(this, () => settled(write));
      if (!this.changed || !this.remakes) return valueOf(outcome);
      await reload();
    }
  }

  /**
   * The answer of the comparison under the hold: whether the definition the try was made from has
   * changed. One found to stand has its hold.
   */
  compared(changed: boolean): void {
    this.changed = changed;
    this.holds = !changed;
  }

  /**
   * What is left of `whole`, the time the write may wait for its hold over all its tries: counted
   * from its first hold, so being made again never has it wait longer than one wait.
   */
  waitLeft(whole: number): number {
    this.waitsUntil ??= Date.now() + whole;
    return Math.max(0, this.waitsUntil - Date.now());
  }

  /**
   * What `step` left the first time it ran, as a copy of its own, so what a try does to it in place
   * (hashing a password, encoding a value) reaches no other try.
   */
  async kept<T>(step: string, run: () => Promise<T> | T): Promise<T> {
    if (!this.again) return run();
    if (this.left.has(step)) return detachData(this.left.get(step) as T);
    const result = await run();
    this.left.set(step, detachData(result));
    return result;
  }

  /** What `step` answered the first time it ran: the thing itself, where no copy would serve. */
  async once<T>(step: string, run: () => Promise<T> | T): Promise<T> {
    if (!this.again) return run();
    if (this.left.has(step)) return this.left.get(step) as T;
    const result = await run();
    this.left.set(step, result);
    return result;
  }

  /**
   * The answer to `question`: as an earlier try heard it, for a later one until it has its hold;
   * asked otherwise. One try asks as often as it ever did, since a hook between two askings may
   * change the answer.
   */
  async answer<T>(question: string, ask: () => Promise<T>): Promise<T> {
    if (this.replaying && this.answers.has(question)) {
      return this.answers.get(question) as T;
    }
    const answer = await ask();
    if (this.again && !this.holds) this.answers.set(question, answer);
    return answer;
  }
}

/**
 * The answer to `question` for the write running now, kept for its later tries (`WriteTries`);
 * asked as it is where no write is, or where the write asks on a transaction (`onTransaction`).
 */
export function askOnce<T>(
  question: string,
  ask: () => Promise<T>,
  options: { onTransaction: boolean }
): Promise<T> {
  const tries = running.getStore();
  return tries === undefined || options.onTransaction
    ? ask()
    : tries.answer(question, ask);
}

/**
 * Whether the write running now is being made again, before its hold: the site's own code has judged
 * its data already, and the data is the same.
 */
export function replayingWrite(): boolean {
  return running.getStore()?.replaying === true;
}

/** Runs `write`, with what it came to rather than what it threw. */
function settled<T>(write: () => Promise<T>): Promise<Outcome<T>> {
  return write().then(
    value => ({ value }),
    (error: unknown) => ({ error })
  );
}

/** The value of a try, or what it threw. */
function valueOf<T>(outcome: Outcome<T>): T {
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
