// Load Next.js lint rules tuned for page speed and accessibility
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
// Load Next.js lint rules for TypeScript
import nextTypescript from "eslint-config-next/typescript";

// The full list of lint rules for this project
const eslintConfig = [
  // Apply the Next.js speed and accessibility rules
  ...nextCoreWebVitals,
  // Apply the Next.js TypeScript rules
  ...nextTypescript,
  {
    // Rules added on top of the Next.js defaults
    rules: {
      // Forbid "any", as the coding standards require
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Skip build output, installed packages, and generated files
    ignores: [".next/**", "node_modules/**", "out/**", "test-results/**", "playwright-report/**", "next-env.d.ts"],
  },
];

// Hand the rules to ESLint
export default eslintConfig;
