module.exports = {
  roots: ['<rootDir>/src'],
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  }
};
