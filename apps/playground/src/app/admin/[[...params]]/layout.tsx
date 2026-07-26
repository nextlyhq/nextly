import { getBrandingCss } from "nextly/config";

import config from "../../../../nextly.config";
import { themesToStylesheet } from "../../../theme-lab/generate-css";
import "../../../theme-lab/layouts.css";
import "../../../theme-lab/densities.css";
// Makes the font and radius a theme declares actually reach the admin, which
// reads neither `--font-sans` nor `--radius` on its own.
import "../../../theme-lab/harness.css";
import { NEXTLY_THEMES } from "../../../theme-lab/themes";
import { TWEAKCN_THEMES } from "../../../theme-lab/themes/tweakcn.generated";
import { ThemeSwitcher } from "../../../theme-lab/ThemeSwitcher";

const brandingCss = getBrandingCss(config.admin?.branding);

// Generated once at module scope rather than per request: the theme set is
// static build-time data, so recomputing this CSS on every request would be
// pure waste. Includes tweakcn presets alongside the Nextly originals so the
// switcher's full theme list actually has a stylesheet block to select --
// picking a preset with no matching `[data-theme="..."]` rule would silently
// no-op.
const themeCss = themesToStylesheet([...NEXTLY_THEMES, ...TWEAKCN_THEMES]);

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {brandingCss && (
        <style dangerouslySetInnerHTML={{ __html: brandingCss }} />
      )}
      <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      {children}
      <ThemeSwitcher />
    </>
  );
}
