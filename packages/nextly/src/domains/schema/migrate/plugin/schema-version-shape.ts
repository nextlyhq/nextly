/**
 * What a plugin schema version is: a positive integer.
 *
 * One rule for both places a version is declared — the plugin's manifest and
 * each migration module it ships — because both values land in the same
 * place: the integer `schema_version` column of the owner registry, which the
 * boot gate compares against. A module accepted with `0.5` committed its SQL
 * and then failed to record its owner on PostgreSQL, while SQLite stored the
 * fraction, so the two had to stop disagreeing about what a version is.
 *
 * A module of its own, importing nothing but zod, so the manifest validator
 * and the migration checks can share it without either importing the other.
 *
 * @module domains/schema/migrate/plugin/schema-version-shape
 * @since 1.0.0
 */
import { z } from "zod";

export const SCHEMA_VERSION_SHAPE = z.number().int().positive();
