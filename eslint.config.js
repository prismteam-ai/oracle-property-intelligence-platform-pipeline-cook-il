// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "data/**",
      "**/.turbo/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/cdk.out/**",
      "infra/cdk/test/fixtures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["apps/web/src/ui/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
