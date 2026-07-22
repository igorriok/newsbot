import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommendedTypeChecked,
  globalIgnores(["dist/**", "node_modules/**", "coverage/**"]),
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
      },
    },
    rules: {
      "no-nested-ternary": "error",
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "block-like", next: "*" },
        { blankLine: "always", prev: "*", next: "block-like" },
        { blankLine: "always", prev: "var", next: "return" },
        // Require blank line after function calls (expressions) and before a 'const'
        { blankLine: "always", prev: "expression", next: "const" },
        // Optional: Require blank line after a 'const' and before a function call
        { blankLine: "always", prev: "const", next: "expression" },
      ],
      "lines-between-class-members": ["error", "always"],
      "padded-blocks": ["error", "always"],
      "consistent-return": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/typedef": [
        "error",
        {
          variableDeclaration: true,
          variableDeclarationIgnoreFunction: true,
        },
      ],
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        {
          assertionStyle: "never",
        },
      ],
      "id-length": [
        "error",
        {
          min: 3,
          exceptions: ["_", "id", "db", "fs", "en", "ro", "ru"],
          properties: "never",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSInterfaceDeclaration TSPropertySignature TSTypeLiteral",
          message:
            "Do not use anonymous (inline) types in interfaces. Extract them to their own interface or type alias.",
        },
        {
          selector: "VariableDeclarator TSTypeAnnotation TSTypeLiteral",
          message: "Do not use inline type literals. Define a named 'interface' or 'type' instead.",
        },
        {
          selector: "FunctionDeclaration > TSTypeAnnotation > TSTypeLiteral",
          message: "Do not use inline return types. Use a named 'interface' or 'type'.",
        },
        {
          selector: "TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message: "Do not use 'as unknown'. Narrow the type safely using a type guard or validation instead.",
        },
        {
          selector:
            "TSUnknownKeyword:not(CatchClause TSUnknownKeyword, CallExpression[callee.property.name='catch'] TSUnknownKeyword)",
          message: "The 'unknown' type is forbidden. Use a specific interface, a generic, or a type guard instead.",
        },
        {
          selector: "TSIndexSignature",
          message: "Index signatures are forbidden. Use 'Record<K, V>' instead.",
        },
      ],
    },
  },
  prettier,
]);

export default eslintConfig;
