/**
 * What the binding picker reads through the host, as hooks: the fields a
 * binding can read, one read shared by every control asking at once; the
 * language and zone a value is previewed in; and the values of a list's
 * first entry beside its item's fields.
 *
 * Apart from `binding-controls`, which draws the picker and the chip: the
 * component decides what to show, these decide when the host is asked.
 *
 * @module binding-picker-reads
 */
import type { BindingRunInput } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { BindingFieldSource, ListSample } from "./binding-services";
import type { ContentServices } from "./content-controls";
import type { ItemField } from "./item-binding-source";

/** The language and time zone the picker previews a formatted value in. */
export type PreviewFormatIn = Pick<BindingRunInput, "locale" | "timeZone">;

/**
 * The language and zone the picker previews in: the page's language, and the
 * site's zone, asked of the host when the picker opens rather than with the
 * canvas, which reads it only for a page already formatting a date. Until
 * the zone is in, and where the host has none or its read fails, the preview
 * is in UTC, as a page rendered with no zone; it is drawn again once it is.
 */
export function usePreviewFormatIn(
  services: ContentServices | undefined
): PreviewFormatIn {
  const locale = services?.bindingLocale;
  const readZone = services?.readSiteTimeZone;
  const [read, setRead] = React.useState<{
    readonly from: () => Promise<string | undefined>;
    readonly zone: string | undefined;
  }>();
  React.useEffect(() => {
    if (readZone === undefined) return;
    let current = true;
    readZone().then(
      zone => {
        if (current) setRead({ from: readZone, zone });
      },
      () => {
        // No zone to show: the previews stay in UTC.
      }
    );
    return () => {
      current = false;
    };
  }, [readZone]);
  // Only the zone this host's read gave, so another host's is never shown.
  const timeZone = read?.from === readZone ? read?.zone : undefined;
  return React.useMemo(
    () => ({
      ...(locale === undefined ? {} : { locale }),
      ...(timeZone === undefined ? {} : { timeZone }),
    }),
    [locale, timeZone]
  );
}

/** The host's read of the fields a binding can read. */
type ListBindingFields = () => Promise<readonly BindingFieldSource[]>;

/**
 * The read in flight, per host function, shared only while it runs, as the
 * list controls share theirs (`collection-loop-controls`): the controls drawn
 * together for one block (a bound image's chip and its alt note) make one
 * read and see one answer, so they can't disagree. Dropped once it settles:
 * an answer is one signed-in author's, read with their access.
 */
const sourcesInFlight = new WeakMap<
  ListBindingFields,
  Promise<readonly BindingFieldSource[]>
>();

/** The host's binding sources, one read shared by every control asking at once. */
function readBindingSources(
  list: ListBindingFields
): Promise<readonly BindingFieldSource[]> {
  const held = sourcesInFlight.get(list);
  if (held !== undefined) return held;
  const answer = list();
  sourcesInFlight.set(list, answer);
  const settle = (): void => {
    if (sourcesInFlight.get(list) === answer) sourcesInFlight.delete(list);
  };
  answer.then(settle, settle);
  return answer;
}

/** The fields a binding can read, as the host reads them; read once per open. */
export function useBindingSources(
  services: ContentServices | undefined,
  wanted: boolean
): readonly BindingFieldSource[] | "loading" | "failed" {
  const [sources, setSources] = React.useState<
    readonly BindingFieldSource[] | "loading" | "failed"
  >("loading");
  const list = services?.listBindingFields;
  React.useEffect(() => {
    if (!wanted || list === undefined) return;
    let current = true;
    setSources("loading");
    readBindingSources(list).then(
      read => {
        if (current) setSources(read);
      },
      () => {
        if (current) setSources("failed");
      }
    );
    return () => {
      current = false;
    };
  }, [list, wanted]);
  return sources;
}

/** One list's sample, asked: its stored props, and the entry clicked. */
export interface SampleAsk {
  readonly props: Readonly<Record<string, unknown>>;
  /** The entry's place among those the list shows; the first if absent. */
  readonly entry?: number;
}

/** No sample read. */
const UNREAD: readonly undefined[] = [];

/**
 * The samples of one entry of each list asked (`asks`, nearest first), as
 * the host reads them: the entry the author clicked on the canvas, else the
 * first. Each `undefined` until read, where the host has none, or where its
 * read fails, so that item's fields are then listed with no values. Read
 * again only when a list's stored props or its entry change.
 */
export function useListSamples(
  read: ContentServices["readListSample"],
  asks: readonly SampleAsk[]
): readonly (ListSample | undefined)[] {
  // By value: the document is a new object after every edit elsewhere.
  const key = JSON.stringify(asks.map(ask => [ask.props, ask.entry ?? null]));
  const [found, setFound] = React.useState<{
    readonly read: NonNullable<typeof read>;
    readonly key: string;
    readonly samples: readonly (ListSample | undefined)[];
  }>();
  React.useEffect(() => {
    if (read === undefined) return;
    const asked = JSON.parse(key) as [
      Readonly<Record<string, unknown>>,
      number | null,
    ][];
    if (asked.length === 0) return;
    let live = true;
    void Promise.all(
      asked.map(([stored, at]) =>
        // The entry only where one was clicked, so a host reading the first
        // entry is asked as before; a failed read shows no values.
        (at === null ? read(stored) : read(stored, at)).catch(() => undefined)
      )
    ).then(samples => {
      if (live) setFound({ read, key, samples });
    });
    return () => {
      live = false;
    };
  }, [read, key]);
  // Only the answer for this host and these lists, never a previous one's.
  return found !== undefined && found.read === read && found.key === key
    ? found.samples
    : UNREAD;
}

/** A field holding a media item by its id, as a list's entry stores one. */
function holdsMedia(field: ItemField): boolean {
  return field.type === "upload";
}

/** One list's item fields and the sample read of its entry. */
export interface SampledItem {
  readonly fields: readonly ItemField[];
  readonly sample: ListSample | undefined;
}

/**
 * The pictures each list's sample names by id (`items`, nearest first), by
 * the field's path: each read through the author's own media read
 * (`readMedia`, the one the canvas draws pictures with), its small picture's
 * address. Empty until read, where the host has no read, and for a picture
 * the read does not find.
 */
export function useSamplePictures(
  readMedia: ContentServices["readMedia"],
  items: readonly SampledItem[]
): readonly ReadonlyMap<string, string>[] {
  const ids: [number, string, string][] = [];
  items.forEach(({ fields, sample }, index) => {
    for (const field of fields) {
      const value = sample?.[field.name];
      if (holdsMedia(field) && typeof value === "string") {
        ids.push([index, field.name, value]);
      }
    }
  });
  // By value: a new sample object for the same entry asks nothing again.
  const key = JSON.stringify(ids);
  const [found, setFound] = React.useState<{
    readonly key: string;
    readonly pictures: readonly [number, string, string][];
  }>();
  React.useEffect(() => {
    if (readMedia === undefined) return;
    const asked = JSON.parse(key) as [number, string, string][];
    if (asked.length === 0) return;
    let live = true;
    void Promise.all(
      asked.map(
        async ([index, path, id]): Promise<
          [number, string, string] | undefined
        > => {
          const thumbnail = (await readMedia(id).catch(() => null))?.thumbnail;
          return thumbnail === undefined ? undefined : [index, path, thumbnail];
        }
      )
    ).then(read => {
      if (live) {
        setFound({ key, pictures: read.filter(each => each !== undefined) });
      }
    });
    return () => {
      live = false;
    };
  }, [readMedia, key]);
  const pictures = found?.key === key ? found.pictures : [];
  return items.map(
    (_, index) =>
      new Map(
        pictures
          .filter(([at]) => at === index)
          .map(([, path, thumbnail]) => [path, thumbnail])
      )
  );
}
