/**
 * The part of the Standard Schema interface (standardschema.dev, version 1)
 * that the operation list reads: a schema that validates an unknown value and
 * says which input and output types it stands for.
 *
 * Declared here rather than imported because the specification asks libraries
 * that only accept such schemas to copy the interface instead of depending on a
 * package for it. Zod's schemas, which core's operations use, satisfy it
 * structurally, and so will a plugin's schema from any library that implements
 * the standard.
 *
 * @module operations/standard-schema
 * @experimental
 */

/** A schema any Standard Schema library made. */
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    /**
     * Checks a value. A library may answer asynchronously, so a caller awaits
     * the result whichever way it comes.
     */
    readonly validate: (
      value: unknown
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    /** The types the schema stands for; only the type checker reads them. */
    readonly types?:
      | { readonly input: Input; readonly output: Output }
      | undefined;
  };
}

/** What `validate` answers: the parsed value, or the issues that refused it. */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<
          PropertyKey | { readonly key: PropertyKey }
        >;
      }>;
    };

/** The value a schema accepts before parsing. */
export type SchemaInput<S extends StandardSchema> = NonNullable<
  S["~standard"]["types"]
>["input"];

/** The value a schema gives back once it has parsed one. */
export type SchemaOutput<S extends StandardSchema> = NonNullable<
  S["~standard"]["types"]
>["output"];
