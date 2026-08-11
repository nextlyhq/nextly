// The builder is a React package — it renders THROUGH `@nextlyhq/blocks-react`
// rather than being a renderer — so it layers the shared React rules over the
// repository base. The root config scopes those rules by path; this per-package
// config applies them unconditionally, matching how the other React packages
// lint when run directly.
import { config } from "@nextlyhq/eslint-config/react-internal";

export default [...config];
