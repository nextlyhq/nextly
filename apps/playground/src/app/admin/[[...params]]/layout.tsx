import { getBrandingCss } from "nextly/config";

import config from "../../../../nextly.config";
import { themesToStylesheet } from "../../../theme-lab/generate-css";
import { InterimThemeSwitcher } from "../../../theme-lab/InterimThemeSwitcher";
import { NEXTLY_THEMES } from "../../../theme-lab/themes";

const brandingCss = getBrandingCss(config.admin?.branding);

// Generated once at module scope rather than per request: the theme set is
// static build-time data, so recomputing this CSS on every request would be
// pure waste.
const themeCss = themesToStylesheet(NEXTLY_THEMES);

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
      <InterimThemeSwitcher />
    </>
  );
}
