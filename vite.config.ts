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
      // Type-aware: unhandled or misused promises, and assertions that change nothing.
      'typescript/await-thenable': 'error',
      'typescript/no-floating-promises': 'error',
      'typescript/no-misused-promises': 'error',
      'typescript/no-unnecessary-type-assertion': 'error',
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
          // The frontend type-checks without strictNullChecks (nextjs.json), so these rules either refuse
          // to run or call a cast unnecessary that strict mode needs (`process.env.X as string`).
          'typescript/no-unnecessary-type-assertion': 'off',
          'typescript/no-useless-default-assignment': 'off',
        },
      },
      {
        // Tests pass mocked methods around detached (`vi.mocked(db).transaction`); they never rely on `this`.
        files: ['**/*.test.ts'],
        rules: {
          'typescript/unbound-method': 'off',
        },
      },
    ],
    options: { typeAware: true, typeCheck: false },
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
