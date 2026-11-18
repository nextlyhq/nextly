/**
 * A reader's dashboard pins, as that reader may see them, and the pin and
 * unpin that change them.
 *
 * The reader is always the signed-in person: their pins are theirs alone,
 * and nothing here takes another person's id.
 *
 * What a reader is shown is decided by the read rules at the moment of
 * reading, never when the pin was made: a pin of something they may no longer
 * read is left out of the list, with no title and no placeholder, and kept
 * stored, so it comes back if their access does. It still counts toward their
 * limit, so the reader is told how many of their own pins those are (a count
 * alone: no target, title or time leaves the server) and may have the server
 * remove them, asking again at that moment which ones they may not read.
 * Pinning needs read access to
 * the target, so a reader cannot learn that an entry exists by pinning it. A
 * pin whose target no longer exists is removed when the pins are read, so it
 * never costs the reader one of their pins.
 *
 * @module services/dashboard/dashboard-pins-service
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";
import {
  type DashboardPin,
  DashboardPins,
  type PinTarget,
} from "../../domains/dashboard/dashboard-pins";
import { NextlyError } from "../../errors/nextly-error";
import { existingDocumentIds } from "../lib/readable-documents";

import {
  bootedHeadingRegistries,
  type DocumentHeading,
  type DocumentRef,
  headingKey,
  type HeadingRegistries,
  readableHeadings,
} from "./readable-headings";
import type { ReadCaller } from "./readable-resources";

/**
 * One pin as the reader is shown it: what it names, and its heading as the
 * reader reads it now (its title, and its icon, status and update time where
 * it has them).
 */
export interface ShownPin extends DocumentHeading {
  targetType: "collection" | "single";
  targetSlug: string;
  /** The pinned entry's id; "" for a Single. */
  entryId: string;
  pinnedAt: string;
}

/** The reader's pins: those they may read, and how many they no longer may. */
interface ReaderPins {
  /** The pins they may read, newest first, each with its heading. */
  shown: ShownPin[];
  /**
   * How many of their pins name documents that exist but they may not read
   * now: a count alone, so no target of one leaves the server; they are
   * removed there ({@link DashboardPinsService.removeUnreadable}).
   */
  unreadableCount: number;
}

/** The reader's live pins, split by whether they may read each now. */
interface SortedPins {
  /** Each pin they may read, with its heading as they read it. */
  readable: { pin: DashboardPin; heading: DocumentHeading }[];
  /** Each pin of a document that exists but they may not read now. */
  unreadable: DashboardPin[];
}

/** The document a stored pin names, as the headings are keyed. */
function refOf(
  pin: Pick<DashboardPin, "targetType" | "targetSlug" | "entryId">
): DocumentRef {
  return {
    kind: pin.targetType,
    slug: pin.targetSlug,
    entryId: pin.targetType === "single" ? "" : pin.entryId,
  };
}

/** A stored pin as the target the repository takes. */
function targetOf(pin: DashboardPin): PinTarget {
  return pin.targetType === "single"
    ? { targetType: "single", targetSlug: pin.targetSlug }
    : {
        targetType: "collection",
        targetSlug: pin.targetSlug,
        entryId: pin.entryId,
      };
}

class DashboardPinsService {
  constructor(
    private readonly pins: DashboardPins,
    private readonly registries: HeadingRegistries
  ) {}

  /**
   * The reader's pins they may read, newest first, each with its heading. One
   * read per collection, for every pinned entry of it at once, as the reader.
   *
   * Reading the pins first removes the reader's orphans, pins whose target no
   * longer exists, so they are neither shown nor counted against the limit.
   */
  async list(caller: ReadCaller): Promise<ShownPin[]> {
    return (await this.read(caller)).shown;
  }

  /**
   * The reader's pins they may read, newest first, each with its heading, and
   * how many of their pins name documents they may no longer read. One read
   * per collection, as {@link list}.
   *
   * 🔴 An unreadable pin is only counted: no target, title, status or time of
   * it is answered. A pin whose target is gone is never one of them: it is
   * removed first ({@link livePins}).
   */
  async read(caller: ReadCaller): Promise<ReaderPins> {
    const { readable, unreadable } = await this.sorted(caller);
    return {
      shown: readable.map(({ pin, heading }) => ({
        targetType: pin.targetType,
        targetSlug: pin.targetSlug,
        entryId: pin.entryId,
        ...heading,
        pinnedAt: new Date(pin.pinnedAt).toISOString(),
      })),
      unreadableCount: unreadable.length,
    };
  }

  /**
   * Remove the reader's own pins of documents they may not read now; how many
   * went. Read access is asked again here, as the reader, for every pin they
   * hold, before anything is removed: a pin they may read again by now stays,
   * whatever an earlier read counted. Only the reader's pins are read, and
   * each removal names the reader, so no one else's pin can go.
   */
  async removeUnreadable(caller: ReadCaller): Promise<number> {
    const { unreadable } = await this.sorted(caller);
    // Every removal settles before the answer, so a failure is never reported
    // while others are still being written, and a read that follows it sees
    // them all; then the first failure fails the request.
    const settled = await Promise.allSettled(
      unreadable.map(pin => this.pins.unpin(caller.user.id, targetOf(pin)))
    );
    const failed = settled.find(
      (each): each is PromiseRejectedResult => each.status === "rejected"
    );
    if (failed !== undefined) throw failed.reason;
    return settled.filter(each => each.status === "fulfilled" && each.value)
      .length;
  }

  /**
   * The reader's live pins, newest first, split by whether they may read each
   * now, with the heading of each they may: the one access read that both
   * {@link read} and {@link removeUnreadable} take their answer from.
   */
  private async sorted(caller: ReadCaller): Promise<SortedPins> {
    const pins = await this.livePins(caller.user.id);
    if (pins.length === 0) return { readable: [], unreadable: [] };
    const headings = await readableHeadings(
      pins.map(refOf),
      caller,
      this.registries
    );
    const sorted: SortedPins = { readable: [], unreadable: [] };
    for (const pin of pins) {
      const heading = headings.get(headingKey(refOf(pin)));
      if (heading === undefined) sorted.unreadable.push(pin);
      else sorted.readable.push({ pin, heading });
    }
    return sorted;
  }

  /**
   * Pin `target` for the reader. Refused, as not found, when they may not read
   * it or it does not exist, so pinning tells nobody what they could not open.
   * Their orphans are removed first, so the limit counts only pins of targets
   * that still exist.
   */
  async pin(caller: ReadCaller, target: PinTarget): Promise<void> {
    if (!(await this.mayRead(caller, target))) {
      throw NextlyError.notFound({
        logContext: { target, reason: "not readable or not found" },
      });
    }
    await this.livePins(caller.user.id);
    await this.pins.pin(caller.user.id, target);
  }

  /**
   * Remove the reader's pin of `target`; true when there was one. Needs no
   * access to the target: a reader may always let go of what they kept.
   */
  unpin(caller: ReadCaller, target: PinTarget): Promise<boolean> {
    return this.pins.unpin(caller.user.id, target);
  }

  /** Whether the reader may read the target, which exists. */
  private async mayRead(
    caller: ReadCaller,
    target: PinTarget
  ): Promise<boolean> {
    const ref = refOf({
      targetType: target.targetType,
      targetSlug: target.targetSlug,
      entryId: target.targetType === "collection" ? target.entryId : "",
    });
    const headings = await readableHeadings([ref], caller, this.registries);
    return headings.has(headingKey(ref));
  }

  /**
   * `userId`'s pins whose target still exists, after removing those whose
   * target does not: a deleted entry or Single, or a collection gone with
   * its entries. A delete sweeps its own target's pins; this catches a pin
   * written while its target was being deleted, so it never costs a pin.
   *
   * 🔴 Existence, not readability: a pin of something the reader may not read
   * now is kept, so it returns when their access does. The existence read
   * ignores access, and what it learns reaches the reader only about their
   * own pins, as a count: how many they can no longer read
   * (`ReaderPins.unreadableCount`, so they may have them removed), which
   * drops when such a target is deleted. That is the price of letting them
   * free its place under the limit; no target, title, status or time of one
   * is answered.
   */
  private async livePins(userId: string): Promise<DashboardPin[]> {
    const pins = await this.pins.list(userId);
    if (pins.length === 0) return pins;
    const live = await this.existingTargets(pins);
    const orphans = pins.filter(pin => !live.has(headingKey(refOf(pin))));
    await Promise.all(
      orphans.map(pin => this.pins.unpin(userId, targetOf(pin)))
    );
    return pins.filter(pin => live.has(headingKey(refOf(pin))));
  }

  /** The targets among `pins` that still exist, by {@link headingKey}. */
  private async existingTargets(
    pins: readonly DashboardPin[]
  ): Promise<Set<string>> {
    const live = new Set<string>();
    const entries = new Map<string, string[]>();
    for (const pin of pins) {
      if (pin.targetType === "collection") {
        entries.set(pin.targetSlug, [
          ...(entries.get(pin.targetSlug) ?? []),
          pin.entryId,
        ]);
      }
    }
    const singles = [
      ...new Set(
        pins.filter(pin => pin.targetType === "single").map(p => p.targetSlug)
      ),
    ];
    await Promise.all([
      ...[...entries].map(async ([slug, ids]) => {
        // A collection that is gone takes every entry of it with it.
        if ((await this.registries.getCollectionBySlug(slug)) === null) return;
        for (const id of await existingDocumentIds(slug, ids)) {
          live.add(headingKey({ kind: "collection", slug, entryId: id }));
        }
      }),
      ...singles.map(async slug => {
        if ((await this.registries.getSingleBySlug(slug)) !== null) {
          live.add(headingKey({ kind: "single", slug, entryId: "" }));
        }
      }),
    ]);
    return live;
  }
}

/**
 * The service over the booted instance's database and registries: what the
 * route answers with, and what a test boots, so the two cannot be assembled
 * differently.
 */
export function dashboardPinsService(): DashboardPinsService {
  return new DashboardPinsService(
    new DashboardPins(container.get<DrizzleAdapter>("adapter")),
    bootedHeadingRegistries()
  );
}
