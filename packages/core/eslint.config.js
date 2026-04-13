import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Basic code quality - most important for security
      '@typescript-eslint/no-unused-vars': ['error', { 
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_' 
      }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      
      // Security awareness
      '@typescript-eslint/no-explicit-any': 'warn',
      
      // Style
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { 'avoidEscape': true }],
    },
  }
);