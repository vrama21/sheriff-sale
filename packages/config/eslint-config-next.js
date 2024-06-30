/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ['next', 'turbo', 'prettier'],
  parserOptions: {
    babelOptions: {
      presets: [require.resolve('next/babel')],
    },
  },
  rules: {
    '@next/next/no-html-link-for-pages': 'off',
    'react/jsx-key': 'off',
  },
  settings: {
    next: {
      rootDir: ['backend', 'frontend', 'packages/*/'],
    },
  },
};
