/**
 * The unique fields a code-first config moves into a group or a repeater, where each refusal names
 * the container and why, shared by the `migrate:create` and development-push suites: the fields, the
 * entity of each kind that holds them, where each is moved to, and the message both roads give.
 */
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  group,
  relationship,
  repeater,
  text,
} from "../../../../config";
import type { TestNextly } from "../../../../plugins/test-nextly";

export const PEOPLE = "rcm_people";
export const POSTS = "rcm_posts";
export const HOME = "rcm_home";
export const FRAME = "rcm_frame";

/** The entity holding the unique field: a collection, a Single or a field group. */
export const ENTITY_KINDS = ["collection", "single", "fieldGroup"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** The slug of the entity of each kind the suites move a field of. */
export const SLUG_OF: Record<EntityKind, string> = {
  collection: POSTS,
  single: HOME,
  fieldGroup: FRAME,
};

/** Every table this module's entities own starts with one of these. */
export const TABLE_PREFIXES = ["dc_rcm_", "single_rcm_", "fg_rcm_"];

/** A field the database keeps unique, as a code-first config declares it. */
export interface UniqueKind {
  kind: string;
  name: string;
  /** Whether its entity is translated, for a field kept for each language. */
  localized: boolean;
  field: () => unknown;
}

export const UNIQUE_KINDS: UniqueKind[] = [
  {
    kind: "a field declared unique",
    name: "code",
    localized: false,
    field: () => text({ name: "code", unique: true } as never),
  },
  {
    kind: "a one-to-one",
    name: "person",
    localized: false,
    field: () =>
      relationship({
        name: "person",
        relationTo: PEOPLE,
        unique: true,
      } as never),
  },
  {
    kind: "a translated one-to-one",
    name: "person",
    localized: true,
    field: () =>
      relationship({
        name: "person",
        relationTo: PEOPLE,
        unique: true,
        localized: true,
      } as never),
  },
];

/** Where a unique field is moved to, at one depth, two and three, and what the refusal names. */
export interface MoveTarget {
  what: string;
  path: string[];
  noun: "group" | "repeater";
  holder: string;
}

export const TARGETS: MoveTarget[] = [
  { what: "a group", path: ["meta"], noun: "group", holder: "meta" },
  {
    what: "a group inside a group",
    path: ["wrap", "part"],
    noun: "group",
    holder: "wrap",
  },
  {
    what: "a group three deep",
    path: ["wrap", "part", "deep"],
    noun: "group",
    holder: "wrap",
  },
  { what: "a repeater", path: ["items"], noun: "repeater", holder: "items" },
  {
    what: "a group inside a repeater",
    path: ["items", "each"],
    noun: "repeater",
    holder: "items",
  },
];

const note = () => text({ name: "note" });
const at = (path: readonly string[] | null, ...segments: string[]) =>
  path !== null &&
  path.length === segments.length &&
  segments.every((segment, index) => segment === path[index]);

/** The containers, with the moved field in the one `path` names, or in none. */
function containers(moved: unknown, path: readonly string[] | null): unknown[] {
  const inside = (...segments: string[]) =>
    at(path, ...segments) ? [moved] : [];
  return [
    group({ name: "meta", fields: [note(), ...inside("meta")] as never }),
    group({
      name: "wrap",
      fields: [
        group({
          name: "part",
          fields: [
            note(),
            ...inside("wrap", "part"),
            group({
              name: "deep",
              fields: [note(), ...inside("wrap", "part", "deep")] as never,
            }),
          ] as never,
        }),
      ],
    }),
    repeater({
      name: "items",
      fields: [
        note(),
        ...inside("items"),
        group({
          name: "each",
          fields: [note(), ...inside("items", "each")] as never,
        }),
      ] as never,
    }),
  ];
}

/** The fields of an entity holding `kind`'s field at `path`, or on the row with none. */
const entityFields = (kind: UniqueKind, path: readonly string[] | null) => {
  const moved = kind.field();
  return [
    text({ name: "title" }),
    ...(path === null ? [moved] : []),
    ...containers(moved, path),
  ] as never;
};

/** What the config declares, with `entity`'s field at `path`, or on the row with none. */
export function definitions(
  entity: EntityKind,
  kind: UniqueKind,
  path: readonly string[] | null
) {
  const fields = entityFields(kind, path);
  const { localized } = kind;
  return {
    collections: [
      defineCollection({ slug: PEOPLE, fields: [text({ name: "title" })] }),
      ...(entity === "collection"
        ? [defineCollection({ slug: POSTS, localized, fields })]
        : []),
    ],
    ...(entity === "single"
      ? { singles: [defineSingle({ slug: HOME, localized, fields } as never)] }
      : {}),
    ...(entity === "fieldGroup"
      ? {
          fieldGroups: [
            defineFieldGroup({ slug: FRAME, localized, fields } as never),
          ],
        }
      : {}),
  };
}

export function configOf(
  entity: EntityKind,
  kind: UniqueKind,
  path: readonly string[] | null
) {
  return defineConfig({
    ...definitions(entity, kind, path),
    db: { migrationsDir: "./migrations" },
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  } as never);
}

/** The refusal of moving `name` into `target`, as every road gives it. */
export function refusalMessage(name: string, target: MoveTarget): string {
  return `${name} cannot be moved into the ${target.noun} ${target.holder}: a ${target.noun} keeps its values in one JSON value, which cannot be kept unique. It can be moved once it is no longer unique (a one-to-one changed to many-to-one, or its unique setting removed), as a change of its own.`;
}

/**
 * A unique field already inside a repeater, moved out of it or within it: refused for its rows,
 * which taking its uniqueness away would not change, on every road.
 */
export const INSIDE_REPEATER_MOVES: {
  what: string;
  path: string[] | null;
  message: string;
}[] = [
  {
    what: "out to the row",
    path: null,
    message:
      "code cannot be moved out of the repeating rows items: each entry may hold several rows of it, which one field cannot keep. Add a new field instead.",
  },
  {
    what: "into a group outside it",
    path: ["meta"],
    message:
      "code cannot be moved out of the repeating rows items: each entry may hold several rows of it, which one field cannot keep. Add a new field instead.",
  },
  {
    what: "into a group inside it",
    path: ["items", "each"],
    message:
      "Moving code within the repeating rows items is not available yet.",
  },
];

/**
 * The rows the app stores for `entity` with a value in its moved field: two posts with one each, a
 * Single's document, and for a field group, whose values sit in its hosts, none.
 */
export async function seed(
  t: TestNextly,
  entity: EntityKind,
  kind: UniqueKind
): Promise<void> {
  const person = async (title: string): Promise<string> => {
    const { item } = await t.nextly.create({
      collection: PEOPLE as never,
      data: { title, slug: title } as never,
    });
    return String((item as { id: unknown }).id);
  };
  const value = async (text: string, title: string) =>
    kind.name === "person" ? { person: await person(title) } : { code: text };
  if (entity === "collection") {
    for (const [text, title] of [
      ["one", "ann"],
      ["two", "ben"],
    ] as const) {
      await t.nextly.create({
        collection: POSTS as never,
        data: {
          title: text,
          slug: text,
          ...(await value(text, title)),
        } as never,
      });
    }
    return;
  }
  if (entity === "single") {
    await t.nextly.updateSingle({
      slug: HOME as never,
      data: {
        title: "one",
        ...(await value("one", "ann")),
        // Replaces whatever the Single holds: it was made by a first read, so nothing is lost.
        _overwrite: true,
      } as never,
    });
  }
}
