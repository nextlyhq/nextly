/**
 * What a move into a group leaves behind. A group keeps its fields' values inside one JSON value,
 * which has no type, comment, character set, collation, index or foreign key of its own; so each
 * of those the old column had is named, in the preview and in the migration, as not carried, and
 * applied to no other column. The value itself, and the field's settings in the definition, are
 * kept.
 *
 * Uniqueness is not among them: a field the database keeps unique is never moved into a group.
 *
 * @module domains/schema/field-moves/not-carried
 */

/** The old column's properties, as the database reports them. */
export interface MovedColumnFacts {
  type: string;
  comment?: string | null;
  charset?: string | null;
  collation?: string | null;
  /** The indexes on the column, by name. */
  indexes: readonly string[];
  /** The foreign key on the column, by name, if it has one. */
  foreignKey?: string | null;
}

export interface NotCarried {
  property: string;
  value: string;
}

/** Each property of the old column the move does not carry, in a fixed order. */
export function notCarried(facts: MovedColumnFacts): NotCarried[] {
  const named = (property: string, value: string | null | undefined) =>
    value ? [{ property, value }] : [];
  return [
    ...named("type", facts.type),
    ...named("comment", facts.comment),
    ...named("character set", facts.charset),
    ...named("collation", facts.collation),
    ...facts.indexes.map(value => ({ property: "index", value })),
    ...named("foreign key", facts.foreignKey),
  ];
}

/** The sentence the preview and the migration's header give for one move into a group. */
export function notCarriedSentence(
  field: string,
  group: string,
  items: readonly NotCarried[]
): string {
  const list = items.map(item => `${item.property} ${item.value}`).join(", ");
  return `Moving ${field} into ${group} keeps every value; not carried, since a JSON value has no place for them: ${list}.`;
}
