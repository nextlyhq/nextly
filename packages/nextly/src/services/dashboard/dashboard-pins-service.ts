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
 * stored, so it comes back if their access does. Pinning needs read access to
 * the target, so a reader cannot learn that an entry exists by pinning it.
 *
 * @module services/dashboard/dashboard-pins-service
 * @experimental Until the dashboard's pins are drawn on it.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  canReadEntity,
  readAccessCaller,
  readableEntities,
} from "../../auth/entity-read-access";
import { container } from "../../di/container";
import { COMMON_TITLE_FIELDS } from "../../domains/collections/entry-title";
import {
  type DashboardPin,
  DashboardPins,
  type PinTarget,
} from "../../domains/dashboard/dashboard-pins";
import { NextlyError } from "../../errors/nextly-error";
import { entryHeading } from "../../lib/entry-heading";
import { readableDocumentColumns } from "../lib/readable-documents";

import type { ReadCaller } from "./readable-resources";

/** One pin as the reader is shown it: what it names, and its title. */
interface ShownPin {
  targetType: "collection" | "single";
  targetSlug: string;
  /** The pinned entry's id; "" for a Single. */
  entryId: string;
  /** The entry's title, as the reader reads it, or the Single's label. */
  title: string;
  pinnedAt: string;
}

/** The registries the titles are read from. */
interface PinRegistries {
  getCollectionBySlug(
    slug: string
  ): Promise<{ admin?: { useAsTitle?: string } | null } | null>;
  getSingleBySlug(slug: string): Promise<{ label: string } | null>;
}

/** The key one pin's title is kept under while a list is assembled. */
const keyOf = (
  pin: Pick<DashboardPin, "targetType" | "targetSlug" | "entryId">
) => `${pin.targetType}\u0000${pin.targetSlug}\u0000${pin.entryId}`;

class DashboardPinsService {
  constructor(
    private readonly pins: DashboardPins,
    private readonly registries: PinRegistries
  ) {}

  /**
   * The reader's pins they may read, newest first, each with its title. One
   * read per collection, for every pinned entry of it at once, as the reader.
   */
  async list(caller: ReadCaller): Promise<ShownPin[]> {
    const pins = await this.pins.list(caller.user.id);
    if (pins.length === 0) return [];
    const readable = await readableEntities(
      [...new Set(pins.map(pin => pin.targetSlug))],
      readAccessCaller(caller)
    );
    const titles = new Map<string, string>();
    const entries = new Map<string, string[]>();
    const singles = new Set<string>();
    for (const pin of pins) {
      if (!readable.has(pin.targetSlug)) continue;
      if (pin.targetType === "single") singles.add(pin.targetSlug);
      else
        entries.set(pin.targetSlug, [
          ...(entries.get(pin.targetSlug) ?? []),
          pin.entryId,
        ]);
    }
    await Promise.all([
      ...[...entries].map(async ([slug, ids]) => {
        for (const [id, title] of await this.entryTitles(slug, ids, caller)) {
          titles.set(
            keyOf({ targetType: "collection", targetSlug: slug, entryId: id }),
            title
          );
        }
      }),
      ...[...singles].map(async slug => {
        const single = await this.registries.getSingleBySlug(slug);
        if (single !== null) {
          titles.set(
            keyOf({ targetType: "single", targetSlug: slug, entryId: "" }),
            single.label
          );
        }
      }),
    ]);
    return pins.flatMap(pin => {
      const title = titles.get(keyOf(pin));
      return title === undefined
        ? []
        : [
            {
              targetType: pin.targetType,
              targetSlug: pin.targetSlug,
              entryId: pin.entryId,
              title,
              pinnedAt: new Date(pin.pinnedAt).toISOString(),
            },
          ];
    });
  }

  /**
   * Pin `target` for the reader. Refused, as not found, when they may not read
   * it or it does not exist, so pinning tells nobody what they could not open.
   */
  async pin(caller: ReadCaller, target: PinTarget): Promise<void> {
    if (!(await this.mayRead(caller, target))) {
      throw NextlyError.notFound({
        logContext: { target, reason: "not readable or not found" },
      });
    }
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
    if (target.targetType === "single") {
      return (
        (await canReadEntity(target.targetSlug, readAccessCaller(caller))) &&
        (await this.registries.getSingleBySlug(target.targetSlug)) !== null
      );
    }
    const titles = await this.entryTitles(
      target.targetSlug,
      [target.entryId],
      caller
    );
    return titles.has(target.entryId);
  }

  /**
   * The titles of the entries among `ids` the reader may read in `slug`, as
   * the read path returns them; none when the collection is gone or the read
   * refuses outright.
   */
  private async entryTitles(
    slug: string,
    ids: readonly string[],
    caller: ReadCaller
  ): Promise<Map<string, string>> {
    const collection = await this.registries.getCollectionBySlug(slug);
    if (collection === null) return new Map();
    const titleField = collection.admin?.useAsTitle ?? "title";
    let documents: Map<string, Record<string, unknown>>;
    try {
      documents = await readableDocumentColumns(slug, ids, caller, [
        titleField,
        ...COMMON_TITLE_FIELDS,
      ]);
    } catch (error) {
      // A read the gate refuses outright shows nothing, as one that returns no
      // rows does. Any other failure is a real one and is reported as such,
      // rather than read as "not yours".
      if (NextlyError.isForbidden(error) || NextlyError.isNotFound(error)) {
        return new Map();
      }
      throw error;
    }
    return new Map(
      [...documents].map(([id, row]) => [id, entryHeading(row, titleField, id)])
    );
  }
}

/**
 * The service over the booted instance's database and registries: what the
 * route answers with, and what a test boots, so the two cannot be assembled
 * differently.
 */
export function dashboardPinsService(): DashboardPinsService {
  const collections = container.get<Pick<PinRegistries, "getCollectionBySlug">>(
    "collectionRegistryService"
  );
  const singles = container.get<Pick<PinRegistries, "getSingleBySlug">>(
    "singleRegistryService"
  );
  return new DashboardPinsService(
    new DashboardPins(container.get<DrizzleAdapter>("adapter")),
    {
      getCollectionBySlug: slug => collections.getCollectionBySlug(slug),
      getSingleBySlug: slug => singles.getSingleBySlug(slug),
    }
  );
}
