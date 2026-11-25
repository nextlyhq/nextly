/**
 * The moves a Schema Builder save refuses, and the moves that go round them, on the storage layout
 * every installation runs: translatable values kept for each language (`describeRefusedMoves`). A
 * translated one-to-one is among the fields.
 */
import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";

import { describeRefusedMoves } from "./refused-moves-suite";

perLanguageStorageSuite();

describeRefusedMoves();
