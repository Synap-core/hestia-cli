#!/bin/bash

echo "=== Setting up ESLint for automatic unused variable fixing ==="

# Create minimal ESLint config
cat > eslint.config.js << 'ESLINT_CONFIG'
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module"
    },
    plugins: {
      "@typescript-eslint": typescriptEslint
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }]
    }
  }
];
ESLINT_CONFIG

echo "ESLint configuration created."
echo ""
echo "To fix unused variables automatically:"
echo "npx eslint src --ext .ts --fix"
echo ""
echo "Note: This will remove or prefix unused variables."
echo "Run without --fix first to see what will be changed."
