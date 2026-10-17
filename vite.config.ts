import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    // eslint:recommended + @typescript-eslint/recommended map to Oxlint's default plugins.
    plugins: ['eslint', 'typescript', 'unicorn', 'oxc'],
    categories: { correctness: 'error' },
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    ignorePatterns: ['**/dist/**', '**/build/**', '**/.next/**', '**/*.d.ts', 'packages/database/drizzle/**'],
    overrides: [
      {
        // eslint-config-next. turbo/no-undeclared-env-vars is dropped: Oxlint has no equivalent, and
        // every env var the frontend reads (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, VERCEL_URL, PORT, NODE_ENV,
        // DATABASE_URL) is declared in turbo.json globalEnv.
        files: ['frontend/**'],
        plugins: ['react', 'nextjs', 'jsx-a11y'],
        rules: {
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'warn',
          'react/jsx-key': 'off',
          'nextjs/no-html-link-for-pages': 'off',
        },
      },
    ],
    options: { typeAware: false, typeCheck: false },
  },
  fmt: {
    bracketSpacing: true,
    printWidth: 120,
    semi: true,
    singleQuote: true,
    tabWidth: 2,
    trailingComma: 'all',
    sortPackageJson: false,
    // Scraped HTML fixtures must stay byte-for-byte; drizzle-kit owns its migration snapshots.
    ignorePatterns: ['**/__fixtures__/**', 'packages/database/drizzle/**'],
    overrides: [
      {
        // Code blocks in docs quote scraped pages and commands verbatim; format the prose only.
        files: ['**/*.md'],
        options: { embeddedLanguageFormatting: 'off' },
      },
    ],
  },
});
