import tseslint from "typescript-eslint";

import { restrictEnvAccess } from "@repo/eslint-config/base";

/** @type {import('typescript-eslint').Config} */
export default tseslint.config(
  {
    ignores: ["dist/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
  ...restrictEnvAccess,
);
