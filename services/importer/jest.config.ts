import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/../../shared/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          // Jest (via ts-jest) runs on CommonJS under the hood.
          // We override module/moduleResolution here only for the test
          // transform; the real tsconfig.json (NodeNext) still governs
          // `npm run dev` and the production build.
          module: "CommonJS",
          moduleResolution: "Node",
          types: ["jest", "node"],
        },
      },
    ],
  },
};

export default config;
