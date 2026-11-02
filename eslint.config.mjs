import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const EXTENSION = String.raw`(\.[cm]?[jt]sx?)?$`;

const KAPSO = {
  regex: String.raw`^((.*/)?salida/|(\.\.?/)+)kapso` + EXTENSION,
  message: "Solo src/nucleo/salida/index.ts habla con Kapso. Usa despachar.",
};
const MARCAR = {
  regex: String.raw`^(.*/)?nucleo/identidad` + EXTENSION,
  importNames: ["marcar"],
  message: "Fuera de src/nucleo, solo src/negocio/whatsapp.ts marca ids.",
};
const INTENCION = {
  regex: String.raw`^(.*/)?nucleo/salida(/index)?` + EXTENSION,
  importNames: ["intencion"],
  message: "Fuera de src/nucleo, solo src/negocio/whatsapp.ts arma intenciones.",
};
const prohibir = (...patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { ignores: ["src/nucleo/salida/index.ts"], rules: prohibir(KAPSO) },
  // Repite KAPSO: un bloque posterior reemplaza las opciones de la regla, no las suma.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/nucleo/**", "src/negocio/whatsapp.ts"],
    rules: prohibir(KAPSO, MARCAR, INTENCION),
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
