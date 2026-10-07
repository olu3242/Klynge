import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", "build/", "public/"] },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly", document: "readonly", window: "readonly" },
    },
  },
  {
    // page.evaluate() callbacks run in the browser.
    files: ["scripts/qa/**/*.mjs"],
    languageOptions: { globals: { getComputedStyle: "readonly" } },
  },
  {
    files: ["js/**/*.js"],
    languageOptions: { sourceType: "script", globals: { document: "readonly", window: "readonly", Element: "readonly" } },
  },
  ...tseslint.configs.strict.map((c) => ({ ...c, files: ["src/**/*.ts"] })),
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      // Determinism: engine code must not read wall-clock time or randomness.
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Pass `now` explicitly; engine must be deterministic." },
        { object: "Math", property: "random", message: "Engine must be deterministic." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "Pass `now` explicitly." },
      ],
    },
  },
);
