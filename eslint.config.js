import js from '@eslint/js'
import globals from 'globals'

/**
 * Deliberately narrow. The one rule that earns its keep here is no-undef: a
 * component that references an identifier it never imported builds fine, ships
 * fine, and only explodes when the branch that uses it renders — which is how a
 * missing MUI <Link> import survived until a filtered PIC change hit an alert
 * that nothing else rendered.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  // browser code
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // node code
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', '*.config.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // The browser-driving test runs page.evaluate callbacks that execute inside
  // the page, so document/window are legitimately in scope there.
  {
    // The browser-driving suites evaluate code INSIDE the page, so they
    // legitimately name document and window alongside the Node globals.
    // Every suite that drives a browser, not just the first two — the other six
    // used `document` inside page.evaluate and failed lint, which stopped
    // `npm test` at its first step.
    files: [
      'scripts/check-ui.mjs', 'scripts/check-sharedload.mjs', 'scripts/check-apps.mjs',
      'scripts/check-auth.mjs', 'scripts/check-commitment.mjs', 'scripts/check-heldfinish.mjs',
      'scripts/check-jira.mjs', 'scripts/check-timeline.mjs', 'scripts/check-weekly.mjs', 'scripts/check-approvals.mjs', 'scripts/check-mail.mjs', 'scripts/check-ai.mjs', 'scripts/check-manager.mjs', 'scripts/check-jiraweek.mjs',
      'scripts/check-projects-page.mjs',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]
