/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const { createJiti } = require('jiti');

const jiti = createJiti(path.resolve(__dirname, 'run-verify.cjs'), {
  alias: {
    '@': path.resolve(__dirname, '..'),
  },
});

jiti(path.resolve(__dirname, 'verify-teamlead-blockers.ts'));
