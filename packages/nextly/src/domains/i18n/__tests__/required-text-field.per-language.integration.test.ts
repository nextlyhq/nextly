/**
 * A text field made required in the Builder settles the entries without a value, on per-language
 * storage as every installation runs it: the cases shared with the earlier layout's suite
 * (`required-text-field-cases`).
 */
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

import { fieldGroupAnswerCases } from "./helpers/field-group-answer-cases";
import { requiredTextFieldCases } from "./helpers/required-text-field-cases";

perLanguageStorageSuite();

requiredTextFieldCases("per-language", "rq_l");

fieldGroupAnswerCases("rq_fg");
