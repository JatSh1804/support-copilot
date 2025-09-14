import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      // Build outputs and dependencies
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "node_modules/**",

      // Supabase Edge Functions (Deno environment)
      "supabase/**",
      "**/supabase/**",
      "**/*.edge.ts",
      "**/*.edge.js"]
  },
  {
    rules: {
      // Disable unused variables rule
      "@typescript-eslint/no-unused-vars": "off",

      // Disable explicit any rule
      "@typescript-eslint/no-explicit-any": "off",

      // Disable unescaped entities rule
      "react/no-unescaped-entities": "off",

      // Disable exhaustive deps rule for useEffect
      "react-hooks/exhaustive-deps": "off",

      // Disable empty interface rule
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-empty-object-type": "off"
    },
  },
];

export default eslintConfig;
