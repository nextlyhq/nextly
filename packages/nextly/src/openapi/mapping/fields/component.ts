/**
 * Map `component` fields to OpenAPI schemas.
 *
 * `ComponentFieldConfig` has two mutually exclusive selectors:
 *
 *   - `component: 'hero'`           — single mode (one specific component)
 *   - `components: ['hero','cta']`  — multi mode / "dynamic zone" (any-of-N)
 *
 * Each combines orthogonally with `repeatable: true` for arrays. So four
 * variants, all reduce to: produce one "instance schema" (either a single
 * \`$ref\` or a \`oneOf\` with `__component` discriminator), then optionally
 * wrap it in an array.
 *
 * Naming: component slugs are conventionally singular (`hero`,
 * `feature-card`), so this mapper does NOT apply the collection-style
 * singularization. It only pascalizes kebab- / snake-case into PascalCase.
 *
 * Description on single-mode (a bare `$ref`) is carried via `allOf`-wrap
 * because OAS 3.1 does not allow sibling keywords next to `$ref` reliably
 * across tooling.
 *
 * @module nextly/openapi/mapping/fields/component
 */

import type { ComponentFieldConfig } from "../../../collections/fields/types/component";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult, MappingContext } from "./types";

function componentSlugToSchemaName(slug: string): string {
  // Components are named singularly by convention — unlike collection slugs
  // we do NOT strip a trailing 's'. Only pascalize from kebab/snake/space.
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function instanceSchema(
  field: ComponentFieldConfig,
  ctx: MappingContext
): OpenAPISchema {
  // Multi-mode wins when both happen to be set (defensive — the source-of-
  // truth type says they're mutually exclusive but TypeScript can't enforce
  // that statically).
  if (field.components && field.components.length > 0) {
    return {
      oneOf: field.components.map(slug =>
        ctx.schemaRef(componentSlugToSchemaName(slug))
      ),
      discriminator: { propertyName: "__component" },
    };
  }
  if (field.component) {
    return ctx.schemaRef(componentSlugToSchemaName(field.component));
  }
  // Misconfiguration — neither selector set. Don't crash; return a
  // permissive object schema. (Collection-level validation will flag the
  // misconfiguration separately.)
  return { type: "object" };
}

/**
 * If the inner schema is a bare `$ref`, attaching a sibling description is
 * unreliable across OAS tooling. Wrap the `$ref` in `allOf` to give the
 * description somewhere safe to live.
 */
function attachDescription(
  schema: OpenAPISchema,
  description: string
): OpenAPISchema {
  const isPureRef =
    schema &&
    typeof schema === "object" &&
    "$ref" in schema &&
    Object.keys(schema).length === 1;
  if (isPureRef) {
    return { allOf: [schema], description };
  }
  return { ...schema, description };
}

export const mapComponentField: FieldMapper<ComponentFieldConfig> = (
  field,
  ctx
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const inner = instanceSchema(field, ctx);

  if (field.repeatable) {
    const arraySchema: OpenAPISchema = {
      type: "array",
      items: inner,
    };
    if (field.minRows !== undefined) arraySchema.minItems = field.minRows;
    if (field.maxRows !== undefined) arraySchema.maxItems = field.maxRows;
    if (description) arraySchema.description = description;
    return {
      input: { ...arraySchema, items: instanceSchema(field, ctx) },
      output: { ...arraySchema, items: instanceSchema(field, ctx) },
    };
  }

  const finalInput = description
    ? attachDescription(inner, description)
    : inner;
  const finalOutput = description
    ? attachDescription(instanceSchema(field, ctx), description)
    : instanceSchema(field, ctx);
  return { input: finalInput, output: finalOutput };
};
