// Reuse the repository's shared ESLint base so this package lints under the
// same rules as every other package; there is nothing engine-specific to add.
import { config } from "@nextlyhq/eslint-config/base";

export default [...config];
