/**
 * The system resource the release permissions are seeded under.
 *
 * In a module of its own, importing nothing, because two very different
 * readers need the one spelling: the release service, which authorizes against
 * it, and the activity log's list of the names its entries are filed under,
 * which must not pull the service's graph in behind a constant.
 *
 * `content-releases` rather than `releases`: registering a system resource
 * reserves its name, and "press releases" is a collection real sites have.
 *
 * @module domains/releases/releases-resource
 */
export const RELEASES_RESOURCE = "content-releases";
