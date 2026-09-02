import path from "node:path";
import type { NextConfig } from "next";

// The @zunialab/* packages are symlinked out of the sibling zunia-ui checkout
// while the npm scope is private, so Turbopack has to trace from the parent
// directory to see them. Drop this once the packages are published.
const workspaceRoot = path.join(process.cwd(), "..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: [
    "@zunialab/ui",
    "@zunialab/tokens",
    "@zunialab/fonts",
    "@zunialab/sdk-react",
    "@zunialab/sdk-web",
    "@zunialab/sdk-core",
  ],
  outputFileTracingRoot: workspaceRoot,
};

export default nextConfig;
