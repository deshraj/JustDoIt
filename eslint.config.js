import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/drizzle/**',
      '**/.turbo/**',
      '**/.next/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // apps/web (Next.js) only: Core Web Vitals + Next-specific rules, layered
    // on top of the shared typescript-eslint base above rather than pulling
    // in the full `eslint-config-next` (which duplicates react/import rules
    // already covered here and assumes the legacy eslintrc format).
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.flatConfig.coreWebVitals.rules,
    },
  },
  {
    // Relax rules that are noisy/inapplicable for the web app's test and
    // config files (mirrors how the rest of the repo treats *.test.ts).
    files: ['apps/web/**/*.test.{ts,tsx}', 'apps/web/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
