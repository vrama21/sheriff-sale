module.exports = {
  roots: ['<rootDir>/src', '<rootDir>/scripts'],
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
