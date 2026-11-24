/**
 * The mark a demote (`nextly db:sync --demote`) leaves on the registry record it hands to the
 * Schema Builder, in place of the configuration file's path: what tells such a record from a
 * collection made in the Builder, whose address a code entry may later take.
 *
 * Its own module so the schema pipeline and the collection registry read the one spelling without
 * either importing the other.
 *
 * @module domains/schema/pipeline/demoted-from-code
 */
export const DEMOTED_FROM_CODE = "demoted-from-code";
