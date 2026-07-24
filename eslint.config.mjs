import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Le prefixe `_` est le marqueur explicite d'un symbole volontairement inutilise (ex. le 4e
      // argument d'un middleware d'erreur Express, requis pour l'arite mais jamais lu). Honorer cette
      // convention deja utilisee dans le code, sans quoi un parametre positionnel obligatoire remonte
      // comme un oubli.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
