import type { ReactNode } from "react";
import { AppFrame } from "@/components/shell/AppFrame";
import packageJson from "../../../package.json";

/**
 * Every app page (public and wallet) renders inside the persistent frame.
 * The version shown in the sidebar footer is read here, on the server, from
 * package.json: only the string reaches the browser.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppFrame version={packageJson.version}>{children}</AppFrame>;
}
