/**
 * Lets these tests load `.json` modules under the repo's test command.
 *
 * `pnpm test` runs `node --conditions=import --import tsx --test`. Under that
 * flag (Node 22 and 26, tsx 4.23) a `.json` import reaches Node's CommonJS
 * JSON loader already transformed by tsx into a JavaScript module
 * (`var chain_catalog_client_default = [...]`), which it then fails to parse,
 * so any test that imports `@/lib/chains` (the slim catalog the swap engine
 * reads bech32 prefixes and networks from) dies at import. This restores the
 * plain loader for `.json`: read the file, parse it, nothing else. Import it
 * first, before anything that pulls in a JSON module.
 *
 * Test-only. The app is bundled by Next, which handles JSON itself; without
 * the flag (`node --import tsx --test`) this is a no-op in effect.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

type JsonLoader = (module: { exports: unknown }, filename: string) => void;

const extensions = createRequire(import.meta.url).extensions as unknown as Record<string, JsonLoader>;

extensions[".json"] = (module, filename) => {
  module.exports = JSON.parse(readFileSync(filename, "utf8")) as unknown;
};
