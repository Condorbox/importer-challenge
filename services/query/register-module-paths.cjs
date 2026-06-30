const path = require("path");
const Module = require("module");

const importerNodeModules = path.resolve(__dirname, "../importer/node_modules");
process.env.NODE_PATH = process.env.NODE_PATH
  ? `${importerNodeModules}${path.delimiter}${process.env.NODE_PATH}`
  : importerNodeModules;

Module._initPaths();
