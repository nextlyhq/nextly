/**
 * A field move stopped part-way on MySQL leaves every value readable (`move-stopped-part-way-suite`),
 * on per-language storage as every installation runs it. The moved fields are shared, kept on the
 * entry's own row in every language: a translated field's move goes through its language table, which
 * these statements do not cover.
 */
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";

import { moveStoppedPartWaySuite } from "./move-stopped-part-way-suite";

perLanguageStorageSuite();

moveStoppedPartWaySuite();
