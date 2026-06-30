import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
  // ts-jest/jest run via the importer's node_modules (see
  // register-module-paths.cjs, also used by the "dev" and "typecheck"
  // scripts) rather than duplicating devDependencies in this package.
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../../shared/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          // Same override as importer's jest.config.ts: ts-jest runs on
          // CommonJS regardless of the NodeNext settings in tsconfig.json
          // used by the real dev/build.
          module: "CommonJS",
          moduleResolution: "Node",
          types: ["jest", "node"],
        },
      },
    ],
  },
};

export default config;
