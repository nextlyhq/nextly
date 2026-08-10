// The renderer is a React package, so it layers the shared React rules over the
// repository base. The root config scopes those rules by path; this per-package
// config applies them unconditionally, matching how the other React packages
// lint when run directly.
import { config } from "@nextlyhq/eslint-config/react-internal";

export default [...config];
