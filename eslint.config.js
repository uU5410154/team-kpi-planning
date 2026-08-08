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
    files: ['scripts/check-ui.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
]
