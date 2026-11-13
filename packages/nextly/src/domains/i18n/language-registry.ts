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

import { coalesce } from "../../shared/lib/coalesce";

import {
  IMPLICIT_LANGUAGE,
  localizationFromStoredLanguages,
  type StoredLanguage,
} from "./config/stored-languages";
import type { SanitizedLocalizationConfig } from "./config/types";

/** How the registry reads the stored list. */
export interface StoredLanguageReader {
  /** A value that changes whenever a stored row does, cheap to read. */
  fingerprint(): Promise<string>;
  rows(): Promise<StoredLanguage[]>;
  /**
   * The fingerprint and the rows in one read, for the registry's first read, which needs both: a
   * start would otherwise wait for one read and then the other. A reader without it is read in
   * two.
   */
  fingerprintedRows?(): Promise<{
    fingerprint: string;
    rows: StoredLanguage[];
  }>;
  /**
   * Whether the calling flow is inside an open transaction. A read made there would take another
   * connection from the pool, outside the transaction, so the registry reads nothing and keeps the
   * list it holds. A reader that cannot tell answers as if outside one.
   */
  inOpenTransaction?(): boolean;
}

/** How long a fingerprint is trusted before it is read again, as the permission epoch does. */
const DEFAULT_TTL_MS = 1000;

export class LanguageRegistry {
  private readonly configured: SanitizedLocalizationConfig | undefined;
  /** The languages served while none are configured or stored, if any. */
  private readonly implicit: SanitizedLocalizationConfig | undefined;
  private readonly reader: StoredLanguageReader | undefined;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly snapshot = new AsyncLocalStorage<{
    localization: SanitizedLocalizationConfig | undefined;
  }>();

  private stored: SanitizedLocalizationConfig | undefined;
  /** The stored languages Settings removed, kept inactive with their content. */
  private retainedCodes: readonly string[] = [];
  private fingerprintSeen: string | undefined;
  private checkedAt: number | undefined;
  /**
   * The read under way, shared by every ordinary caller (`coalesce`), under
   * the number of the reads a forced refresh has begun: a forced refresh
   * starts a read of its own, which every caller after it joins instead.
   */
  private readonly inFlight = new Map<number, Promise<void>>();
  private forcedReads = 0;
  /** Counts reads started, so a read that a later one overtook leaves what the later one stored. */
  private readsStarted = 0;

  constructor(options: {
    configured?: SanitizedLocalizationConfig;
    reader?: StoredLanguageReader;
    /**
     * Serve the implicit language while none are configured or stored, as a site that keeps every
     * translatable field per language does: its values are stored under one language even before
     * it declares any. Otherwise such a site has no localization at all.
     */
    implicitLanguage?: boolean;
    ttlMs?: number;
    now?: () => number;
  }) {
    this.configured = options.configured;
    this.implicit =
      options.implicitLanguage === true
        ? localizationFromStoredLanguages([IMPLICIT_LANGUAGE])
        : undefined;
    this.reader = options.reader;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    // A monotonic clock: the wall clock can jump, backwards or forwards, which would hold a stale
    // list past its lifetime or reread on every call.
    this.now = options.now ?? (() => performance.now());
  }

  /** Whether the configuration declares the languages, so Settings may not change them. */
  get lockedByConfig(): boolean {
    return this.configured !== undefined;
  }

  /** The languages to use now: the request's snapshot inside one, the latest read otherwise. */
  current(): SanitizedLocalizationConfig | undefined {
    if (this.configured) return this.configured;
    const pinned = this.snapshot.getStore();
    return (pinned ? pinned.localization : this.stored) ?? this.implicit;
  }

  /**
   * The languages Settings removed and keeps, inactive, so adding one again brings its content
   * back. No request reads or writes them; a reader that must account for every translation the
   * database holds, such as the record of which media items content uses, asks for them here.
   * Always the latest read, never a request's snapshot, and none for a list the configuration
   * locks.
   */
  // Called through `LiveLocalization`, an interface the dead-code gate cannot trace to the class.
  // fallow-ignore-next-line unused-class-member
  retained(): readonly string[] {
    return this.configured ? [] : this.retainedCodes;
  }

  /** Runs `operation` with `current()` fixed to the languages as they are now. */
  runWithSnapshot<T>(operation: () => T): T {
    return this.snapshot.run({ localization: this.current() }, operation);
  }

  /**
   * Runs one call with one language list from start to end: the list is brought up to date, then
   * fixed for everything `operation` does. A call made inside another one (a hook's own call, say)
   * keeps the list the enclosing call fixed, and reads nothing.
   */
  async runWithLatest<T>(operation: () => Promise<T>): Promise<T> {
    if (this.snapshot.getStore()) return operation();
    await this.refresh();
    return this.runWithSnapshot(operation);
  }

  /**
   * Brings the stored list up to date: at most one fingerprint read per interval, one read shared
   * by every caller, and the rows read only when the fingerprint moved. `force` reads now. Inside
   * an open transaction nothing is read, forced or not (`StoredLanguageReader.inOpenTransaction`).
   */
  async refresh(options?: { force?: boolean }): Promise<void> {
    const reader = this.readerNow();
    if (!reader) return;
    if (options?.force !== true) {
      if (this.isFresh()) return;
    } else {
      this.forcedReads += 1;
    }
    await coalesce(this.inFlight, this.forcedReads, () => this.read(reader));
  }

  /**
   * The reader, when the stored list may be read now: never for a list the configuration locks,
   * and never inside an open transaction.
   */
  private readerNow(): StoredLanguageReader | undefined {
    if (this.configured || !this.reader) return undefined;
    return this.reader.inOpenTransaction?.() === true ? undefined : this.reader;
  }

  /** Whether the last fingerprint read is recent enough to trust. */
  private isFresh(): boolean {
    return (
      this.checkedAt !== undefined && this.now() - this.checkedAt < this.ttlMs
    );
  }

  /**
   * Reads the fingerprint, and the rows when it moved. A forced refresh does not wait for a read
   * already under way, so the two can finish in either order: only the read started last stores
   * what it found, or an older read finishing late would put the previous list back and have it
   * trusted for another interval.
   */
  /**
   * The fingerprint, and the rows when it moved. Before anything was read the
   * rows are wanted whatever the fingerprint says, so both come in one read
   * where the reader offers one.
   */
  private async readChanged(
    reader: StoredLanguageReader
  ): Promise<{ fingerprint: string; rows: StoredLanguage[] | undefined }> {
    if (this.fingerprintSeen === undefined && reader.fingerprintedRows) {
      return reader.fingerprintedRows();
    }
    const fingerprint = await reader.fingerprint();
    return {
      fingerprint,
      rows:
        fingerprint !== this.fingerprintSeen ? await reader.rows() : undefined,
    };
  }

  private async read(reader: StoredLanguageReader): Promise<void> {
    const started = ++this.readsStarted;
    const { fingerprint, rows } = await this.readChanged(reader);
    if (started !== this.readsStarted) return;
    if (rows) {
      this.stored = localizationFromStoredLanguages(rows);
      this.retainedCodes = rows.filter(row => !row.active).map(row => row.code);
      this.fingerprintSeen = fingerprint;
    }
    this.checkedAt = this.now();
  }
}
