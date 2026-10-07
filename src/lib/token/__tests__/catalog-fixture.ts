/**
 * The shipped catalog, read with `fs` for tests.
 *
 * `node --conditions=import --import tsx` cannot import a `.json` module (tsx
 * hands Node's JSON loader the transformed source), so tests install the same
 * file `catalog-data.ts` installs in the app, read the one way that works.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installCatalog, type CatalogEntry } from "../catalog";

let installed = false;

export function installTestCatalog(): void {
  if (installed) return;
  const file = join(import.meta.dirname, "../../../data/chain-catalog.json");
  installCatalog(JSON.parse(readFileSync(file, "utf8")) as CatalogEntry[]);
  installed = true;
}
