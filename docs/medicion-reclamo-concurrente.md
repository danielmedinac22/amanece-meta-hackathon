# Medición: decenas de reclamadores sobre `trabajos`

Prototipo desechable para el ticket #13 (de qué base de código partimos y dónde corre), parte del `blast-radius` de su diseño. No es código de producción. Se midió el 29 de octubre de 2026 desde Colombia contra una rama desechable de Neon en `us-east-1` (1 CU fijo), ya borrada, con `ENVIO_SIMULADO=1`. No llama al modelo ni a Kapso.

## La pregunta

La seguridad de la cola del #13 descansa en un hecho: el reclamo de una sola sentencia (`UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`) por el driver HTTP de Neon, con el índice único parcial `trabajos_uno_por_fila`, nunca deja dos tomados vivos en una fila, respeta el orden de `orden` dentro de la fila y no se traba detrás de un tomado huérfano. `medir/turno-durable` lo probó con 2 drenadores y sin filas. Faltaban decenas de reclamadores a la vez.

## Cómo se midió

`scripts/medir-reclamo-concurrente.mts` crea el esquema `medir_reclamo` con el DDL de `tipos.ts` del diseño y corre sus sentencias `tomar` y `cerrar` tal cual (sin `<su cola>`, porque aquí ningún tipo junta ráfagas). Usa `neon()` de `@neondatabase/serverless`, el mismo driver de `src/db/index.ts`. Aborta si el host de `DATABASE_URL` no es `RAMA_DE_MEDICION_HOST`.

- 2.000 trabajos en 40 filas `tel:` (50 por fila), con `vence` al azar para que el `ORDER BY vence` caiga casi siempre en uno que no es cabeza.
- 64 reclamadores en un proceso, cada uno por su propia petición HTTP: toma, duerme 0 a 50 ms y cierra con la cerca (`tomado_por`).
- 100 de esos cierran la primera vez con `reintentar` (vuelven a `pendiente` 100 ms después, con el mismo `orden`).
- Una fila con un tomado huérfano (arriendo vencido hace 5 s), un pendiente anterior a él y cinco detrás.
- 8 trabajos con arriendo de 1 s: su primer corredor espera a que otro lo rescate y entonces intenta cerrar, con el rescatador todavía vivo.
- Una fila de empate: 30 trabajos con el mismo `orden` y el mismo `creado`, como dos `encolar` dentro de una transacción.
- Un observador lee la base cada 50 ms buscando filas con dos tomados vivos.

Afirma con `afirmar` y sale con 1 si algo falla. `--sabotaje=<a,b>` rompe una pieza: `sin-indice`, `sin-skip-locked`, `sin-fila-ocupada` (quita `o.estado = 'tomado'` del `NOT EXISTS`), `huerfano-cabeza` (el huérfano solo se retoma si es cabeza, como c1) y `sin-cerca`. `--analizar` corre `ANALYZE` antes, `--por-fila=N` cambia el tamaño y `--plan` imprime el plan.

```
pnpm tsx scripts/medir-reclamo-concurrente.mts [--sabotaje=sin-indice] [--analizar] [--por-fila=250] [--plan]
```

## Resultados

La ida y vuelta mínima del driver desde Colombia (`SELECT 1`, 30 seguidas) fue de 76 a 85 ms en p50 en todas las corridas. Las cifras "en Postgres" son `clock_timestamp() − statement_timestamp()` leído en el `RETURNING`: lo que tarda la sentencia dentro de la base, sin la red.

**El diseño tal cual, 2.045 trabajos, 64 reclamadores: 14 de 14 afirmaciones en tres corridas.**

| Corrida | Reclamo en Postgres p50 / p95 | Reclamo desde el cliente p50 / p95 | 23505 en las 40 filas / en el empate | Afirmaciones |
| --- | --- | --- | --- | --- |
| Sin `ANALYZE` | 31 / 638 ms | 377 / 983 ms | 0 / 288 | 14 de 14 |
| Sin `ANALYZE`, otra vez | 236 / 704 ms | 477 / 896 ms | 0 / 310 | 14 de 14 |
| Con `ANALYZE` (el plan que queda en producción) | 276 / 1.071 ms | 475 / 1.255 ms | 0 / 44 | 14 de 14 |
| Con `ANALYZE`, 10.045 trabajos | 5.457 / 11.582 ms | 5.672 / 11.854 ms | 0 / 74 | 11 de 14: en 300 s terminó 1.415; ninguna falla de corrección |
| `--reclamo=partido`, con `ANALYZE` | 0,7 / 27 ms | 197 / 346 ms | 0 / 106 | 14 de 14, en 19 s |
| `--reclamo=partido`, con `ANALYZE`, 10.045 trabajos | 45 / 767 ms | 293 / 1.005 ms | 0 / 116 | 14 de 14, en 166 s |

En ninguna corrida del diseño hubo dos tomados vivos en una fila, un trabajo corrido dos veces sin rescate, una toma que se adelantara a un anterior de su fila ni un error del driver distinto de 23505. El huérfano se retomó a sí mismo y después corrieron el pendiente anterior y los de detrás, en orden. La cerca rechazó a los 8 corredores que volvieron tarde.

**Choques 23505.** Cero en las 40 filas en todas las corridas: ahí la consulta sola nunca chocó. En la fila de empate, entre 44 y 310 por corrida, y entre 8 y 56 reclamos que chocaron dos veces y devolvieron "nada" aunque había trabajo.

**El plan.** Con estadísticas (`ANALYZE`, que en producción corre solo el autovacuum; la diferencia entre las dos corridas sin `ANALYZE` sugiere que llegó a mitad de la segunda, sin comprobarlo), el planificador resuelve el `NOT EXISTS` de tipos.ts, que junta las dos condiciones con un `OR`, con un `Seq Scan` de toda la tabla por cada candidato que recorre en orden de `vence`. El costo crece con el cuadrado de lo pendiente: con 10.045 trabajos el reclamo tarda 5,5 s en p50 y la cola no se vacía. Partida en dos `NOT EXISTS`, cada condición usa su índice parcial (`trabajos_uno_por_fila` en hash, `trabajos_cabeza_de_fila` en Index Only Scan) y las afirmaciones son las mismas.

**Sabotajes, 2.045 trabajos.**

| Sabotaje | Afirmaciones que fallaron | Qué se vio |
| --- | --- | --- |
| `sin-indice` | 2: dos tomados vivos (reclamadores y base) | Solo en la fila de empate. En las 40 filas no hubo dobles, pero el reclamo pasó a 363 / 7.808 ms en Postgres: el `NOT EXISTS` se quedó sin índice para "fila ocupada" |
| `sin-skip-locked` | 0 en esta corrida; en una corrida anterior, "sin errores del driver" por `deadlock detected` | 278 / 620 ms en Postgres, nueve veces más lento en p50. El `UPDATE` vuelve a comprobar la fila bloqueada (EvalPlanQual), así que `SKIP LOCKED` aquí es rendimiento, no corrección |
| `sin-fila-ocupada` (con índice) | 2: el orden dentro de la fila | 0 dobles: el índice rechazó 17.438 veces. Pero `medir:31:6` corrió antes que `medir:31:5`: el índice garantiza uno a la vez, no el orden |
| `sin-fila-ocupada,sin-indice` | 5 | 416 observaciones de la base con dos tomados vivos en una fila; orden roto; el huérfano corrió después de su pendiente anterior |
| `huerfano-cabeza` (el reclamo de c1) | 4 | La fila del huérfano quedó trabada: `H` tomado, `P` y cinco detrás pendientes, hasta el corte por estancamiento |
| `sin-cerca` | 1 | Los 8 corredores que volvieron tarde cerraron el trabajo de su rescatador vivo |
| `--reclamo=partido --sabotaje=sin-indice` | 2: dos tomados vivos | Igual que `sin-indice`: solo en la fila de empate |

## Qué decide

- El reclamo de una sentencia por `neon-http`, con la cerca y el índice parcial, aguanta 64 reclamadores sin un doble, sin perder el orden y sin trabarse detrás de un huérfano.
- "Uno tomado a la vez" lo da el índice solo cuando dos trabajos de una fila empatan en `(orden, creado)`. El orden lo da la consulta (`o.estado = 'tomado'`), no el índice.
- El `NOT EXISTS` con `OR` de tipos.ts no aguanta una cola larga. Antes de fusionar: partirlo en dos `NOT EXISTS`, desempatar por `id` y medirlo con `ANALYZE` y 10.000 trabajos.
- La rama de Neon era de 1 CU fijo. Con 0,25 CU (lo que da los USD 19 al mes del diseño) estas cifras serían peores.
