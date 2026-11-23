/** Tests run against a real PostgreSQL (with pgvector) and Redis. See test/README.md. */
const swc = (syntax) => ['@swc/jest', {
  jsc: {
    parser: syntax === 'ts' ? { syntax: 'typescript', decorators: true } : { syntax: 'ecmascript' },
    transform: { legacyDecorator: true, decoratorMetadata: true },
    target: 'es2022',
  },
  module: { type: 'commonjs' },
}];

module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.spec\\.ts$',
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': swc('ts'),
    // jose ships as ES modules only; Jest needs it turned into CommonJS. Node itself loads it fine.
    '^.+/node_modules/jose/.+\\.js$': swc('js'),
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
};
