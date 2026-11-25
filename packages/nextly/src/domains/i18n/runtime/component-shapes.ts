/**
 * The shapes of repeaters and groups that place a component inside, read with the component's
 * fields.
 *
 * Such a container holds its component's values inline in its rows, so what it translates inside
 * depends on that component's fields, which the registry holds (`placesComponent`). Its companion
 * ref carries a shape of its own text alone and the container's definition; each path that splits
 * or puts back its value first reads the shape again here, on its own transaction handle.
 *
 * @module domains/i18n/runtime/component-shapes
 */
import type { LocalizedFieldRef } from "../companion-join";
import {
  type ComponentFieldsOf,
  placesComponent,
  shapeBeforeComponents,
  sharedStructureShape,
  type SharedStructureShape,
  type StructuredField,
} from "../shared-structure";

/**
 * `refs` with the shape of each container placing a component read again with that component's
 * fields, as the registry holds them now (read on `executor`, the caller's transaction handle
 * where it holds one): its text inside a row is then split into the language's overlay and put
 * back on read. A component whose fields cannot be read leaves the shape as it was; a component
 * field the definition no longer has is no longer read from an overlay, and a new one falls back
 * through the chain as any value no language holds does. The refs as they are where none places a
 * component, with no read.
 */
export async function withComponentShapes(
  refs: readonly LocalizedFieldRef[],
  executor?: unknown
): Promise<LocalizedFieldRef[]> {
  const placing = refs.flatMap(ref =>
    ref.placingComponents ? [ref.placingComponents] : []
  );
  if (placing.length === 0) return [...refs];
  const { resolveComponentSchemas } = await import(
    "../../versions/restore-version"
  );
  const schemas = await resolveComponentSchemas(
    placing as Parameters<typeof resolveComponentSchemas>[0],
    executor
  );
  const fieldsOf = (slug: string) => {
    const schema = schemas.get(slug);
    return schema?.resolved === false ? undefined : schema?.fields;
  };
  return refs.map(ref =>
    ref.placingComponents
      ? {
          ...ref,
          sharedStructure:
            sharedStructureShape(ref.placingComponents, fieldsOf) ??
            shapeBeforeComponents(ref.placingComponents),
        }
      : ref
  );
}

/** `companion` with its refs' component shapes read (`withComponentShapes`); null as null. */
export async function withComponentShapesOf<
  T extends { localizedFields: LocalizedFieldRef[] },
>(companion: T | null, executor?: unknown): Promise<T | null> {
  if (!companion) return companion;
  if (!companion.localizedFields.some(ref => ref.placingComponents)) {
    return companion;
  }
  return {
    ...companion,
    localizedFields: await withComponentShapes(
      companion.localizedFields,
      executor
    ),
  };
}

/**
 * The shape of each container in `fields` that keeps its text inside, by field name, a container
 * placing a component read with that component's fields as the registry holds them (read on
 * `executor`), as {@link withComponentShapes} reads a ref's: a container whose only text is inside
 * a component is split by it too, and one whose component holds no text by its own text alone
 * (`shapeBeforeComponents`). For a path holding field definitions rather than companion refs, such
 * as a Single's first row.
 */
export async function containerShapesOf(
  fields: readonly unknown[],
  executor?: unknown
): Promise<Map<string, SharedStructureShape>> {
  const named = fields.filter(
    (field): field is StructuredField & { name: string; type: string } =>
      typeof field === "object" &&
      field !== null &&
      typeof (field as { name?: unknown }).name === "string" &&
      typeof (field as { type?: unknown }).type === "string"
  );
  const placing = named.filter(field => placesComponent(field));
  let fieldsOf: ComponentFieldsOf | undefined;
  if (placing.length > 0) {
    const { resolveComponentSchemas } = await import(
      "../../versions/restore-version"
    );
    const schemas = await resolveComponentSchemas(
      placing as unknown as Parameters<typeof resolveComponentSchemas>[0],
      executor
    );
    fieldsOf = slug => {
      const schema = schemas.get(slug);
      return schema?.resolved === false ? undefined : schema?.fields;
    };
  }
  return new Map(
    named.flatMap(field => {
      const shape =
        sharedStructureShape(field, fieldsOf) ??
        (placesComponent(field) ? shapeBeforeComponents(field) : null);
      return shape ? [[field.name, shape] as const] : [];
    })
  );
}
