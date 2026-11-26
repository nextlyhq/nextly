/**
 * The configuration the migration commands load, set by a test; none, and they load the project's own.
 * A module of its own, with no imports, so that a mock's factory meets none of what it is mocking.
 */
export const loadedConfig: { value: unknown } = { value: undefined };
