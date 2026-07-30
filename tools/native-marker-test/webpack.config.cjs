const path = require("path");

module.exports = {
  entry: "./src/index.ts",
  output: {
    path: path.resolve(__dirname, "build"),
    filename: "ranger-atlas-native-marker-test.js",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  externals: {
    "@skyrim-platform/skyrim-platform": ["skyrimPlatform"],
    skyrimPlatform: ["skyrimPlatform"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
};
