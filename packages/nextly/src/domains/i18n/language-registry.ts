/**
 * The site's content languages, as every service reads them.
 *
 * A configuration that declares `localization` locks the list: the registry serves that block and
 * reads nothing. Otherwise the list is the one Settings stores (`nextly_languages`), and with
 * nothing stored there is no localization at all, as for a site without the block.
 *
 * A change made on one instance reaches the others through the database: `refresh()` asks for a
 * cheap fingerprint of the stored rows at most once per interval, sharing one read between
 * callers, and reads the rows themselves only when the fingerprint moved. The instance that made
 * the change refreshes with `force`, so it serves the new list at once.
 *
 * `current()` is synchronous so the services can keep reading it where they read their
 * configuration today. Inside `runWithSnapshot`, it answers with the list as it was when the
 * scope began, so one request never sees two lists: a language added while a save is under way
 * reaches the next request, not the second half of that save.
 *
 * @module domains/i18n/language-registry
 */
import { AsyncLocalStorage } from "node:async_hooks";

import {
  localizationFromStoredLanguages,
  type StoredLanguage,
} from "./config/stored-languages";
import type { SanitizedLocalizationConfig } from "./config/types";

/** How the registry reads the stored list. */
export interface StoredLanguageReader {
  /** A value that changes whenever a stored row does, cheap to read. */
  fingerprint(): Promise<string>;
  rows(): Promise<StoredLanguage[]>;
}

/** How long a fingerprint is trusted before it is read again, as the permission epoch does. */
const DEFAULT_TTL_MS = 1000;

export class LanguageRegistry {
  private readonly configured: SanitizedLocalizationConfig | undefined;
  private readonly reader: StoredLanguageReader | undefined;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly snapshot = new AsyncLocalStorage<{
    localization: SanitizedLocalizationConfig | undefined;
  }>();

  private stored: SanitizedLocalizationConfig | undefined;
  private fingerprintSeen: string | undefined;
  private checkedAt: number | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(options: {
    configured?: SanitizedLocalizationConfig;
    reader?: StoredLanguageReader;
    ttlMs?: number;
    now?: () => number;
  }) {
    this.configured = options.configured;
    this.reader = options.reader;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Whether the configuration declares the languages, so Settings may not change them. */
  get lockedByConfig(): boolean {
    return this.configured !== undefined;
  }

  /** The languages to use now: the request's snapshot inside one, the latest read otherwise. */
  current(): SanitizedLocalizationConfig | undefined {
    if (this.configured) return this.configured;
    const pinned = this.snapshot.getStore();
    return pinned ? pinned.localization : this.stored;
  }

  /** Runs `operation` with `current()` fixed to the languages as they are now. */
  runWithSnapshot<T>(operation: () => T): T {
    return this.snapshot.run({ localization: this.current() }, operation);
  }

  /**
   * Brings the stored list up to date: at most one fingerprint read per interval, one read shared
   * by every caller, and the rows read only when the fingerprint moved. `force` reads now.
   */
  async refresh(options?: { force?: boolean }): Promise<void> {
    if (this.configured || !this.reader) return;
    const force = options?.force === true;
    if (!force && this.isFresh()) return;
    if (!force && this.inFlight) return this.inFlight;
    await this.track(this.read(this.reader));
  }

  /** Whether the last fingerprint read is recent enough to trust. */
  private isFresh(): boolean {
    return (
      this.checkedAt !== undefined && this.now() - this.checkedAt < this.ttlMs
    );
  }

  /** Shares `reading` with refreshes made while it runs. */
  private async track(reading: Promise<void>): Promise<void> {
    this.inFlight = reading;
    try {
      await reading;
    } finally {
      if (this.inFlight === reading) this.inFlight = undefined;
    }
  }

  private async read(reader: StoredLanguageReader): Promise<void> {
    const fingerprint = await reader.fingerprint();
    if (fingerprint !== this.fingerprintSeen) {
      this.stored = localizationFromStoredLanguages(await reader.rows());
      this.fingerprintSeen = fingerprint;
    }
    this.checkedAt = this.now();
  }
}
