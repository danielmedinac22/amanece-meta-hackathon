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
const VIEJO = {
  regex: String.raw`(^|/)db/viejo` + EXTENSION,
  message: "Las tablas viejas no tienen lector: el estado de un Negocio se lee con leerEstado (@/nucleo/estado).",
};
/** Atrapa `@/nucleo/cambios/politica` y `../cambios/politica`, pero no el `./politica` de adentro de la carpeta. */
const INTERNOS_DE_CAMBIOS = {
  regex: String.raw`(^|/)cambios/(politica|redactar-consulta)` + EXTENSION,
  message: "Usa @/nucleo/cambios: politica y redactar-consulta son internos.",
};
const ESCRIBIR = {
  regex: String.raw`(^|/)estado/escribir` + EXTENSION,
  message: "Solo src/nucleo/cambios y scripts/ escriben Elementos: pide el Cambio con proponer.",
};
const LIBPG = { regex: String.raw`^libpg-query$`, message: "Solo src/nucleo/consultas/validar.ts parsea SQL: usa validarConsulta." };
const NEON = {
  regex: String.raw`^@neondatabase/serverless$`,
  importNames: ["neon"],
  message: "Solo src/db/index.ts y src/nucleo/consultas/ejecutar.ts abren el driver HTTP: una consulta del Panel corre con ejecutar.",
};
const POOL = { regex: String.raw`^(.*/)?db/pool` + EXTENSION, message: "Solo src/nucleo/cambios abre transacciones." };
const prohibir = (...patterns) => ({ "no-restricted-imports": ["error", { patterns }] });

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { ignores: ["src/nucleo/salida/index.ts"], rules: prohibir(KAPSO, LIBPG) },
  // Un bloque posterior reemplaza las opciones de la regla, no las suma: cada bloque repite todo lo que le toca.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/nucleo/**", "src/negocio/sesion.ts"],
    rules: prohibir(KAPSO, MARCAR, INTENCION, INTERNOS_DE_CAMBIOS, POOL, ESCRIBIR, VIEJO, LIBPG, NEON),
  },
  { files: ["src/negocio/sesion.ts"], rules: prohibir(KAPSO, INTENCION, INTERNOS_DE_CAMBIOS, POOL, ESCRIBIR, VIEJO, LIBPG, NEON) },
  {
    files: ["src/nucleo/**/*.ts"],
    ignores: ["src/nucleo/cambios/**", "src/nucleo/salida/index.ts", "src/nucleo/estado/escribir.ts", "src/nucleo/estado/index.ts"],
    rules: prohibir(KAPSO, INTERNOS_DE_CAMBIOS, POOL, ESCRIBIR, VIEJO, LIBPG, NEON),
  },
  // `escribir` y `leerEstado` reciben la transacción de quien reclama: importan el tipo, nunca la abren.
  { files: ["src/nucleo/estado/escribir.ts"], rules: prohibir(KAPSO, INTERNOS_DE_CAMBIOS, VIEJO, LIBPG, NEON) },
  { files: ["src/nucleo/estado/index.ts"], rules: prohibir(KAPSO, INTERNOS_DE_CAMBIOS, ESCRIBIR, VIEJO, LIBPG, NEON) },
  { files: ["src/nucleo/cambios/**/*.ts"], rules: prohibir(KAPSO, VIEJO, LIBPG, NEON) },
  { files: ["src/nucleo/consultas/validar.ts"], rules: prohibir(KAPSO, INTERNOS_DE_CAMBIOS, POOL, ESCRIBIR, VIEJO, NEON) },
  { files: ["src/db/index.ts"], rules: prohibir(KAPSO, MARCAR, INTENCION, INTERNOS_DE_CAMBIOS, POOL, ESCRIBIR, VIEJO, LIBPG) },
  { files: ["src/nucleo/consultas/ejecutar.ts"], rules: prohibir(KAPSO, INTERNOS_DE_CAMBIOS, POOL, ESCRIBIR, VIEJO, LIBPG) },
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
