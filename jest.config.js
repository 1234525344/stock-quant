module.exports = {
  testEnvironment: "node",
  roots: ["__tests__"],
  testMatch: ["**/*.test.js"],
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/routes/**",
    "!src/state.js",
    "!src/ai-service.js",
    "!src/ai-picker.js",
    "!src/article-generator.js",
    "!src/index.js",
  ],
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 40,
      functions: 45,
      lines: 50,
    },
  },
  coverageReporters: ["text", "text-summary", "lcov"],
  verbose: true,
};
