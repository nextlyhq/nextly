/**
 * The widest DECIMAL every supported dialect can declare.
 *
 * MySQL caps DECIMAL at precision 65 and scale 30; PostgreSQL allows far more
 * and SQLite ignores both. Declarations are held to the narrowest dialect so a
 * schema that applies on one applies on all three. Shared by the number-field
 * validator and the schema DSL, which both render these into DDL.
 */
export const MAX_DECIMAL_PRECISION = 65;
export const MAX_DECIMAL_SCALE = 30;
