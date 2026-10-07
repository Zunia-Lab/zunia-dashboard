/**
 * Installs the shipped chain catalog into `./catalog`.
 *
 * A module of its own so the identity rules stay importable from tests: the
 * repo's test command (`node --conditions=import --import tsx`) cannot load a
 * `.json` module, while Next bundles this import like any other. Every app
 * entry point reaches it through `./identity`; tests install the same file
 * with `fs` instead (`__tests__/catalog-fixture.ts`).
 */

import raw from "@/data/chain-catalog.json";
import { installCatalog, type CatalogEntry } from "./catalog";

installCatalog(raw as readonly CatalogEntry[]);
