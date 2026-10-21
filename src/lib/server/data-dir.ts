/**
 * Where the dashboard keeps what it writes at runtime (push subscriptions, the
 * NFT chain scan): `ZUNIA_DASHBOARD_DATA_DIR`, else `.data/` in the working
 * directory. The deployment must keep it on persistent disk, out of git, and
 * readable by the service user only (docs/DEPLOY.md).
 *
 * Written so the bundler can see the path is data, not code: a bare
 * `resolve(variable)` made Turbopack's file tracer give up and trace the whole
 * project into the push routes' and instrumentation's server bundles (760
 * files where /api/markets has 127). The default is a fixed subfolder of the
 * working directory, which the tracer scopes; the operator's directory is
 * runtime configuration and is marked to be ignored.
 */

import "server-only";
import { join, resolve } from "node:path";

export function dashboardDataDir(): string {
  const configured = process.env.ZUNIA_DASHBOARD_DATA_DIR?.trim();
  if (configured) return resolve(/* turbopackIgnore: true */ configured);
  return join(process.cwd(), ".data");
}
