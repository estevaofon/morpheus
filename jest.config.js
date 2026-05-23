/**
 * Jest configuration for Morpheus / Matrix Notepad.
 *
 * - Default environment is jsdom: renderer/app.ts touches the DOM at load
 *   time (and escapeHtml/tokenizers use document), so the editor tests need a
 *   browser-like environment. The notepad data-layer test opts into the Node
 *   environment via a per-file `@jest-environment node` docblock.
 * - ts-jest transpiles TypeScript on the fly using tsconfig.test.json with
 *   module=commonjs so the guarded `module.exports` block at the bottom of
 *   app.ts (a no-op in the browser) exposes internals to the tests.
 * - isolatedModules: transpile-only (no cross-file type-checking) keeps the
 *   suite fast and decoupled from the production build's stricter typing.
 */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  clearMocks: true,
};
