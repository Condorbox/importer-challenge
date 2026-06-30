const path = require("path");
const Module = require("module");

const serviceNodeModules = path.resolve(__dirname, "node_modules");
process.env.NODE_PATH = process.env.NODE_PATH
  ? `${serviceNodeModules}${path.delimiter}${process.env.NODE_PATH}`
  : serviceNodeModules;

Module._initPaths();
