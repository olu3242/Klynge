import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/", "node_modules/", "next-env.d.ts", "test/corpus/", "public/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Client components and shared view types must never reach the engine or server modules.
    files: ["src/components/**/*.tsx", "src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/server/*", "**/server/*", "**/src/klynge/*", "**/klynge/index*"], message: "Client code must not import the engine or server modules." }] },
      ],
    },
  },
  {
    files: ["scripts/**/*.mjs", "scripts/**/*.ts"],
    languageOptions: { globals: { console: "readonly", process: "readonly", Buffer: "readonly", document: "readonly", window: "readonly", getComputedStyle: "readonly", fetch: "readonly", setTimeout: "readonly", FormData: "readonly", Blob: "readonly", CSS: "readonly" } },
  },
  { files: ["src/**/*.test.ts"], rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
);
