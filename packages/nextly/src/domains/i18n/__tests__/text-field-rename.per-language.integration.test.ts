/**
 * A text field renamed in the Builder keeps its values, on per-language storage as every
 * installation runs it: the cases shared with the earlier layout's suite (`text-field-rename-cases`).
 */
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { textFieldRenameCases } from "./helpers/text-field-rename-cases";

perLanguageStorageSuite();

textFieldRenameCases("per-language", "tfr_lang");
