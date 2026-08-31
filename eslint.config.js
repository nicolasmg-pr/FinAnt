// ESLint 9 flat config. Expo's shared rules plus the few this project adds.
const expo = require('eslint-config-expo/flat');

module.exports = [
  ...expo,
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', '**/.expo/**', 'apps/mobile/expo-env.d.ts'],
  },
  {
    rules: {
      // Financial figures are money objects; a stray `==` on a currency code
      // or an unused catch binding is worth failing the lint on.
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // i18next's default export re-exports its own methods; the rule fires on
      // every legitimate `i18n.changeLanguage(...)` call.
      'import/no-named-as-default-member': 'off',
    },
  },
  {
    // CLI helpers print to stdout: that is their entire purpose.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
