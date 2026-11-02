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
  message: "Fuera de src/nucleo, solo src/negocio/sesion.ts marca ids: el Negocio sale de la sesión.",
};
const INTENCION = {
  regex: String.raw`^(.*/)?nucleo/salida(/index)?` + EXTENSION,
  importNames: ["intencion"],
  message: "Fuera de src/nucleo nadie arma intenciones. La respuesta a un Caso sale por aprobar.",
};
/** Hasta el corte del 31-oct, el Cambio viejo solo se propone y se escribe por el puente. */
const CAMBIOS_VIEJOS = {
  regex: String.raw`^(.*/)?negocio/cambios` + EXTENSION,
  importNames: ["aplicarCambio", "revertirCambio", "obtenerCambio", "proponerRegla", "proponerConocimiento", "proponerPieza"],
  message: "Un Cambio se propone con proponer y se aplica con aprobar (@/nucleo/cambios). Solo src/nucleo/cambios/puente.ts usa lo viejo.",
};
/** Atrapa `@/nucleo/cambios/puente` y `../cambios/puente`, pero no el `./puente` de adentro de la carpeta. */
const INTERNOS_DE_CAMBIOS = {
  regex: String.raw`(^|/)cambios/(puente|politica)` + EXTENSION,
  message: "Usa @/nucleo/cambios: puente y politica son internos.",
};
const POOL = { regex: String.raw`^(.*/)?db/pool` + EXTENSION, message: "Solo src/nucleo/cambios abre transacciones." };
const prohibir = (...patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { ignores: ["src/nucleo/salida/index.ts"], rules: prohibir(KAPSO) },
  // Un bloque posterior reemplaza las opciones de la regla, no las suma: cada bloque repite todo lo que le toca.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/nucleo/**", "src/negocio/sesion.ts"],
    rules: prohibir(KAPSO, MARCAR, INTENCION, CAMBIOS_VIEJOS, INTERNOS_DE_CAMBIOS, POOL),
  },
  { files: ["src/negocio/sesion.ts"], rules: prohibir(KAPSO, INTENCION, CAMBIOS_VIEJOS, INTERNOS_DE_CAMBIOS, POOL) },
  {
    files: ["src/nucleo/**/*.ts"],
    ignores: ["src/nucleo/cambios/**", "src/nucleo/salida/index.ts"],
    rules: prohibir(KAPSO, CAMBIOS_VIEJOS, INTERNOS_DE_CAMBIOS, POOL),
  },
  { files: ["src/nucleo/cambios/**/*.ts"], ignores: ["src/nucleo/cambios/puente.ts"], rules: prohibir(KAPSO, CAMBIOS_VIEJOS) },
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
