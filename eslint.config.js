// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignored paths
  { ignores: ["dist/**", "coverage/**", "temp/**"] },

  // TypeScript recommended rules (non-type-aware, fast)
  ...tseslint.configs.recommended,

  // Project-specific overrides
  {
    rules: {
      // Enforced by TypeScript standards doc
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-explicit-any": "error",

      // Allow unused args when prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
