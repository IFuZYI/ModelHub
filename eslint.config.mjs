import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfig = [
  // Global ignores must be their own object in flat config.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
      "reference/**",
    ],
  },
  ...nextVitals,
  ...nextTypeScript,
  {
    // Existing data-loading and listbox effects intentionally synchronize local
    // state; keep the prior lint behavior while using Next 16's flat config.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
