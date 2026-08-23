import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      ".render-demo/**",
      ".shadow-eval/**",
      ".shadow-eval-s02/**",
      ".grid-check/**",
      ".bakeoff-s03/**",
      "eval/mixer/.render/**",
      "node_modules/**",
      "design/**",
      "public/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  /*
   * Eval helpers never enter the product bundle (2L-R). The specific blocks
   * below override this rule for their files, so each of them carries the
   * same pattern again.
   */
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    // Product code only: a test may reach eval fixtures, the bundle may not.
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/eval/**"],
              message: "Eval helpers are test scaffolding, not product code.",
            },
          ],
        },
      ],
    },
  },
  /*
   * Project-file boundaries (spec 13.15, 2L-A), enforced on the real import
   * graph rather than by text search: the pure contract stays pure, the hook
   * persists only through the injected commit, and components take the whole
   * flow through the hook.
   */
  {
    files: ["src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/project/project-file",
              message:
                "Components take the project flow through use-project-file; parsing and serialising are not component work.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/lib/project/project-file.ts",
      "src/lib/project/project-file-errors.ts",
      "src/lib/project/project-file-name.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "The project-file contract is pure." },
            { name: "react-dom", message: "The project-file contract is pure." },
            { name: "tone", message: "The project-file contract is pure." },
            {
              name: "@/lib/song/storage",
              message:
                "The storage envelope must never reach a portable project file.",
            },
            {
              name: "@/lib/song/storage-envelope",
              message:
                "The storage envelope must never reach a portable project file.",
            },
            {
              name: "@/lib/song/song-store",
              message: "The contract does not know the store; callers commit.",
            },
          ],
          patterns: [
            {
              group: ["**/eval/**"],
              message: "Eval helpers are test scaffolding, not product code.",
            },
            {
              group: ["@/components/*"],
              message: "The project-file contract is pure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/project/use-project-file.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/song/storage",
              message: "The hook persists only through the injected commit.",
            },
            {
              name: "@/lib/song/storage-envelope",
              message: "The hook persists only through the injected commit.",
            },
            {
              name: "@/lib/song/song-store",
              message: "The hook persists only through the injected commit.",
            },
          ],
          patterns: [
            {
              group: ["**/eval/**"],
              message: "Eval helpers are test scaffolding, not product code.",
            },
            {
              group: ["@/components/*"],
              message: "Hooks do not import components.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
