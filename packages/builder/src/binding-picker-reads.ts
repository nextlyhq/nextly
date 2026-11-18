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
import type { ItemSource } from "./item-binding-source";

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

/**
 * The samples of one of a list's entries, as the host reads them for the
 * list `list`: the entry at `entry` (the one the author clicked on the
 * canvas), else the first. `undefined` until read, where the host has none,
 * or where the read fails, so the item's fields are then listed with no
 * values. Read again only when the list's stored props or the entry change.
 */
export function useListSample(
  read: ContentServices["readListSample"],
  list: ItemSource["list"],
  entry?: number
): ListSample | undefined {
  const props = list?.props;
  // By value: the document is a new object after every edit elsewhere.
  const key =
    props === undefined ? undefined : JSON.stringify([props, entry ?? null]);
  const [found, setFound] = React.useState<{
    readonly read: NonNullable<typeof read>;
    readonly key: string;
    readonly sample: ListSample | undefined;
  }>();
  React.useEffect(() => {
    if (read === undefined || key === undefined) return;
    let live = true;
    const [stored, at] = JSON.parse(key) as [
      Readonly<Record<string, unknown>>,
      number | null,
    ];
    // The entry only where one was clicked, so a host reading the first
    // entry is asked as before.
    (at === null ? read(stored) : read(stored, at)).then(
      sample => {
        if (live) setFound({ read, key, sample });
      },
      () => {
        // No samples to show: the fields are listed without values.
      }
    );
    return () => {
      live = false;
    };
  }, [read, key]);
  // Only the answer for this host and this list, never a previous one's.
  return found !== undefined && found.read === read && found.key === key
    ? found.sample
    : undefined;
}
