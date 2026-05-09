import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.d.ts",
      "packages/eve-dashboard/**",
      "packages/usb/**",
    ],
  },
  {
    files: ["packages/**/*.ts"],
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    settings: {
      "import/resolver": {
        node: { extensions: [".ts", ".js", ".mjs"] },
      },
    },
    rules: {
      "import/no-cycle": ["error", { ignoreExternal: true }],
    },
  },
  // Ban execSync in lifecycle and task paths — it blocks the event loop.
  {
    files: [
      "packages/@eve/lifecycle/src/**/*.ts",
      "packages/**/src/tasks/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              importNames: ["execSync"],
              message: "execSync blocks the event loop. Use exec from node:child_process/promises instead.",
            },
            {
              name: "node:child_process",
              importNames: ["execSync"],
              message: "execSync blocks the event loop. Use exec from node:child_process/promises instead.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='execSync']",
          message: "execSync blocks the event loop. Use exec from node:child_process/promises instead.",
        },
        {
          selector: "MemberExpression[property.name='execSync']",
          message: "execSync blocks the event loop. Use exec from node:child_process/promises instead.",
        },
      ],
    },
  },
];
