import { Config } from "@remotion/cli/config";
import path from "node:path";

Config.overrideWebpackConfig((currentConfiguration) => ({
  ...currentConfiguration,
  resolve: {
    ...currentConfiguration.resolve,
    alias: {
      ...(currentConfiguration.resolve?.alias ?? {}),
      "@chimera": path.resolve(process.cwd(), "chimera/src"),
    },
  },
  module: {
    ...currentConfiguration.module,
    rules: [
      { test: /\.song$/, type: "asset/source" },
      { test: /\.mid$/, type: "asset/inline" },
      ...(currentConfiguration.module?.rules ?? []),
    ],
  },
}));
