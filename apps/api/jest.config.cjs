module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "src/.*\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": require.resolve("ts-jest")
  },
  collectCoverageFrom: ["src/**/*.(t|j)s"],
  coverageDirectory: "coverage",
  testEnvironment: "node"
};
