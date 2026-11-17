import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";

// Statements that count as standalone control-flow constructs. if/else, try/catch/finally and do/while
// are each a single AST node, so they are treated as one construct automatically.
const CONTROL_FLOW = ["if", "for", "while", "do", "switch", "try"];

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // Formatting and readability rules from code-style-convention, applied to every linted source file.
  {
    files: ["**/*.ts", "**/*.mjs"],
    plugins: {
      "@stylistic": stylistic,
    },
    rules: {
      // Layout: 120 columns, spaces only, one statement per line, no trailing whitespace.
      "@stylistic/max-len": ["error", { code: 120, ignoreUrls: true }],
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
      "@stylistic/no-tabs": "error",
      "@stylistic/max-statements-per-line": ["error", { max: 1 }],
      "@stylistic/no-trailing-spaces": "error",

      // Blank lines: exactly one around control flow, none padding the edges of a block.
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: CONTROL_FLOW },
        { blankLine: "always", prev: CONTROL_FLOW, next: "*" },
        { blankLine: "always", prev: "*", next: "return" },
      ],
      "@stylistic/no-multiple-empty-lines": [
        "error",
        { max: 1, maxBOF: 0, maxEOF: 0 },
      ],
      "@stylistic/padded-blocks": ["error", "never"],

      // Control flow: braces always, early returns over else, deliberate case handling.
      curly: ["error", "all"],
      "no-else-return": ["error", { allowElseIf: false }],
      "no-fallthrough": "error",
      "default-case": "error",
      "default-case-last": "error",

      // Imports: no duplicates, no wildcards (unused imports are caught by no-unused-vars).
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],

      // Dead code.
      "no-unreachable": "error",
      "no-useless-return": "error",
      "no-unused-private-class-members": "error",

      // Proxies for "keep functions focused". Thresholds are my choice; tune them to your codebase.
      complexity: ["warn", 15],
      "max-depth": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        { max: 60, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Documentation rules from code-style-convention: public APIs documented, docs consistent with signatures.
  {
    files: ["src/**/*.ts"],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
            ClassDeclaration: true,
            MethodDefinition: true,
          },
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "TSEnumDeclaration",
          ],
        },
      ],
      "jsdoc/require-param": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-check": "error",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-types": "error",
    },
  },

  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      // Unused parameters prefixed with an underscore are intentional placeholders.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Type-aware: every union/enum case must be handled deliberately.
      "@typescript-eslint/switch-exhaustiveness-check": "error",

      // Naming: camelCase values, PascalCase types, UPPER_CASE constants.
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        { selector: "import", format: ["camelCase", "PascalCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase", "UPPER_CASE"] },
        // External shapes (headers, DB columns, API payloads) keep their own casing.
        { selector: ["objectLiteralProperty", "typeProperty"], format: null },
      ],
    },
  },

  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },

  {
    files: ["drizzle.config.ts", "eslint.config.ts", "jest.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },

  {
    ignores: ["dist/**", "node_modules/**"],
  },
);
