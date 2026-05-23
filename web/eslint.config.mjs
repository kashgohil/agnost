import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import tailwind from "eslint-plugin-tailwindcss";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tailwind.configs["flat/recommended"],
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
    settings: {
      tailwindcss: {
        callees: ["cn", "cva", "clsx"],
        // Project uses Tailwind v4 CSS-first config; no JS config file to point at.
        config: false,
        // Tailwind v4 generates utilities from @theme tokens in globals.css.
        // eslint-plugin-tailwindcss doesn't read CSS-first config, so we
        // whitelist them by regex. Entries here are regex strings.
        whitelist: [
          // bespoke animations (keyframes in globals.css)
          "animate-sheet-fade-in",
          "animate-sheet-fade-out",
          "animate-sheet-slide-in",
          "animate-sheet-slide-out",
          // theme-token utilities: {property}-{token}
          "(bg|text|border|ring|fill|stroke|from|to|via|accent|placeholder|caret|decoration|outline|divide|shadow|ring-offset)-(background|foreground|paper|ink|ink-soft|ink-mute|rule|rule-soft|positive|negative|attention)",
        ],
      },
    },
  },
  {
    ignores: ["node_modules", ".next", "dist", "next-env.d.ts"],
  },
];
