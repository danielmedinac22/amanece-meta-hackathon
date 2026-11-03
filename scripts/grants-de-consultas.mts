/**
 * Imprime los GRANT por columna de `amanece_consultas`, derivados de `FUENTES`, para pegarlos en la migración.
 * `probar-consultas` compara esta misma lista con la base en los dos sentidos.
 *
 *   pnpm tsx scripts/grants-de-consultas.mts
 */
const { grantsDeConsultas } = await import('../src/nucleo/consultas/catalogo')

for (const [tabla, columnas] of grantsDeConsultas()) console.log(`GRANT SELECT (${[...columnas].join(', ')}) ON public.${tabla} TO amanece_consultas;--> statement-breakpoint`)
