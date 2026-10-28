# ¿Alcanza un SQL acotado para Secciones e Indicadores? Medición del paso "verificar" de "Cómo queda funcionando un Cambio"

Es un prototipo desechable (playbook Prototype de poteto-mode). Responde preguntas observando. Lo que queda como artefacto son los números, los scripts de `scripts/medir-sql/`, el validador de `src/medir-sql/` y los JSON de `scripts/medir-sql/resultados/`. Nada de esto es código de Amanece. Rama: `medir/sql-acotado`.

## Resumen

- **SQL acotado (c1) acertó 88 % de las respuestas posibles (50 de 57 corridas) y el respaldo JS en QuickJS (c2) 56 % (32 de 57).** Cada pedido se corrió 3 veces contra la misma verdad, escrita a mano en SQL sobre las tablas reales de un Negocio de 10 mil pedidos. Medido.
- **Las dos opciones fueron válidas en 100 % de los casos dentro de 3 intentos (98 % a la primera). La validez no dice nada sobre si la cifra está bien.** Las cifras equivocadas y válidas ("mal en silencio") fueron 7 en SQL y 25 en JS. De las 7 de SQL, 6 son una ventana de 30 días que el modelo se inventó y avisó en su descripción, y 1 es una definición de "volvió a comprar". De las 25 de JS, 18 son resultados vacíos o en cero porque el código usó el campo `creado` sin haberlo declarado.
- **Los 4 pedidos que hay que declinar (margen, días de confirmado a entregado, texto de lo que escribió cada Cliente, costo de envíos) se declinaron bien 12 de 12 veces en SQL y 12 de 12 en JS.** En SQL también sin la instrucción explícita de declinar (12 de 12): bastó el `noTrae` del catálogo y la opción `no_se_puede` del esquema.
- **SQL costó USD 0.0056 Standard por pedido (mediana) y tardó 7.1 s; JS costó 0.0129 y tardó 19.3 s.** SQL hace una llamada al modelo, JS dos, y el JS escribe el triple de tokens de salida (2403 contra 877, medianas). Con el modelo Contributor que usa el repo, SQL cuesta unos USD 0.0004 por pedido.
- **libpg_query en WASM corre en un route handler de Next 16 con `next build && next start`, pero solo con `serverExternalPackages: ['libpg-query']`.** Con el empaquetado por defecto de Turbopack el build "pasa" y el WASM no se encuentra al ejecutar (`ENOENT /ROOT/node_modules/...`). Con la corrección, la función despliega 1.83 MB más (1.72 MB es el WASM), el proceso arranca en unos 360 ms y la primera validación tarda 17 ms.
- **Atar al Negocio funciona con `neon(url).transaction([...])` por HTTP (un lote, una transacción) y también con el `Pool` por WebSocket. Las llamadas HTTP sueltas no sirven.** La mutación de control rompe la prueba de aislamiento como debe. Hallazgo importante: la política RLS por variable de sesión **no frena** un `SELECT` que llame `set_config('app.negocio_id', ...)`, lo verifiqué. El segundo anillo solo vale mientras el validador siga prohibiendo `set_config`.
- **Muse Spark respeta el JSON Schema estricto**: 10 de 10 llamadas con `strict: true` y pedidos que tientan a romperlo, sin una sola violación. Sin esquema, 3 de 3 violan. La forma no queda garantizada si la respuesta se corta (`finish_reason: length`). Meta documenta decodificación restringida.

## Cómo se midió

**Entorno.**

- Rama de Neon desechable `medir-t8-sql`, creada de la principal. Antes de cada escritura revisé que las 9 variables de base de datos de `.env.local` (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL*`, `PGHOST*`, `POSTGRES_HOST`) apuntaran al host de la rama (`ep-little-meadow-b8zl714n`), ninguna a la principal. `scripts/medir/entorno.mts` se niega a arrancar si no es así. Dos variables, `NEON_AUTH_BASE_URL` y `VITE_NEON_AUTH_URL`, traían el host de Neon Auth de la principal. Lo vi al repasar el entorno antes de las últimas escrituras y las cambié por un destino sin servicio. Ningún script de medición llama a la autenticación y los primeros builds de prueba tampoco hicieron ninguna llamada de red de mi parte, pero esos builds sí corrieron con las variables originales.
- `KAPSO_API_KEY` vacía, `ENVIO_SIMULADO=1` siempre, y `fetch` solo deja salir a `api.meta.ai` y a `*.neon.tech`. La única excepción es que `next build` y `next start` corren fuera de ese envoltorio. Para que el build no descargara fuentes de Google quité `next/font/google` de `src/app/layout.tsx` en esta rama.
- Modelo `muse-spark-1.3-contributor` (el `MODEL_ID` de `.env.local`) por el cliente del repo (`src/lib/modelo.ts`, Vercel AI SDK con `generateText` y `Output.object`), con `reasoning: 'low'` como el generador actual. Los USD se calculan al precio Standard de lista (1.25 / 4.25 por millón de tokens, entrada / salida). No corrí `muse-spark-1.3`, así que su exactitud no está medida.
- Worktree propio `medir2/repo` de `origin/medir/costo-de-un-cambio`. El checkout principal de `amanece-meta-hackathon` no se tocó.

**Datos.** `scripts/medir-sql/sembrar.mts` (adaptado de `scripts/medir/sintetico.mts`) crea el Negocio A `SQL10K` con 10 000 pedidos en 180 días, 2 500 Clientes (1 779 repiten), 14 productos, 8 ciudades, 47 249 mensajes en conversaciones con pares Cliente y Agente, y 700 Casos. Las horas son de Bogotá: en 3 145 de los 10 000 pedidos el día en UTC y el día en Bogotá no coinciden, así que un error de zona se nota. El estado depende de la edad del pedido. El Negocio B `SQL10KB` (800 pedidos) existe para la prueba de aislamiento.

**Catálogo (lo único que ve el generador SQL).** `src/medir-sql/catalogo.ts`. Siete fuentes, cada una con su CTE `WHERE negocio_id = $1`: `hoy` (una fila con `hoy_local`), `pedidos`, `pedido_items` (los items aplanados), `productos`, `clientes`, `casos` y `conversaciones` (una fila por Cliente y día, con `segundos_primera_respuesta`). Las fechas ya vienen en la zona del Negocio (`dia_local`, `mes_local`, `hora_local`). Hay una definición fija, `cuenta_como_venta` (confirmado, enviado, entregado o novedad), y otra de texto: "últimos N días = `dia_local > hoy_local - N`". Cada fuente dice lo que **no** trae (por ejemplo `pedidos`: cuándo se confirmó o se entregó, costo de envío; `conversaciones`: el texto). El catálogo lo diseñé yo siguiendo la sección 1 del diseño de c1. Parte de la exactitud se debe a esas ayudas (`hoy`, `pedido_items`, `conversaciones`, `cuenta_como_venta`), que el diseño propone.

**Validador.** `src/medir-sql/validar.ts` con `libpg-query` 18.1.5. Una sola sentencia `SELECT` (puede traer `WITH`, `UNION`, subconsultas, ventanas, `VALUES`). Lista cerrada de nodos, de operadores, de tipos y de funciones. Sin nombres con esquema, sin `pg_*`, `set_config`, `current_setting`, `now()`, `current_date`, `AT TIME ZONE`, DML, `FOR UPDATE`, `INTO`, `WITH RECURSIVE` ni parámetros. Cada columna se resuelve contra el catálogo con alias, subconsultas y correlación (`dato_inexistente` si no existe). Una columna de salida que no depende de ningún dato (`0 AS valor`, `avg(0)`) da `sin_datos`. La forma pide `valor` (número), `etiqueta` y `valor` (serie) o columnas libres (filas). 61 casos escritos a mano (`scripts/medir-sql/probar-validador.mts`), 61 pasan. No hice fuzzing.

**Ejecución.** Se antepone el prólogo de CTE, se envuelve en `SELECT to_jsonb(q), count(*) OVER () FROM (...) q LIMIT 500` y se corre en una transacción de Neon con `SET LOCAL ROLE amanece_consultas`, `set_config('app.negocio_id', ...)` y `statement_timeout = '2s'` (ver pregunta 4).

**Los 23 pedidos.** Los 5 medidos antes (confirmados por día, pedidos con novedad, recompra a 60 días, mejores Clientes, margen por producto), "días de confirmado a entregado" y "lo que escribió cada Cliente" (hay que declinar), "30 días sobre 10k", contadores por estado y por producto, ventas por día y ciudad, ticket promedio por ciudad, tiempo de primera respuesta (mediana y p90), productos que se compran juntos (autounión), cohortes de retención a 30, 60 y 90 días, y 8 míos de una tienda contra entrega (Clientes inactivos, cancelados por ciudad, pedidos por hora local, horas de resolución de Casos, ventas de la semana contra la anterior, Clientes nuevos por mes, pendientes viejos, costo de envíos que hay que declinar). 4 de los 23 se deben declinar. El texto de cada uno y su verdad están en `src/medir-sql/peticiones.ts`.

**Brazo SQL (c1).** Una llamada genera `{decision, sql, en_palabras, motivo, falta}`. Hasta 3 intentos: el error del validador o de Postgres vuelve al prompt. Un `no_se_puede` termina el pedido.

**Brazo JS (c2).** Reusa el generador actual (`src/agentes/generador.ts`: mismas reglas del código, `calcular(datos)` o `consultar(datos)`, la regla de UTC-5, la lista de estados, los 200 filas, las 4 filas de muestra) y le suma el paso de declarar la entrada. Llamada 1, `ConsultaDeEntrada`: ventana en días, tablas, campos y techo, o `no_se_puede`. El núcleo la valida contra el contrato v1 de c2 (productos, clientes, pedidos, casos, mensajes), cuenta filas contra el techo de 20 000 (si no cabe, error y no recorta) y carga solo lo declarado. Llamada 2, el código, que corre en `correrAislado` del repo (QuickJS, 1 s, 32 MB). Hasta 3 intentos por paso. El prompt trae las mismas definiciones fijas, escritas en palabras. Diferencias deliberadas con SQL: el contrato de c2 no trae `dia_local` ni `conversaciones` ni `pedido_items`, y el JS ve 4 filas reales de muestra (el SQL no ve filas).

**Cómo se compara.** Cada pedido se corre 3 veces por brazo (69 corridas por brazo, 57 respondibles y 12 a declinar). Una respuesta es correcta si cada fila de la verdad aparece, con tolerancia numérica, en una fila distinta del resultado (que puede traer columnas de más); los conteos y sumas exigen igualdad exacta; los porcentajes aceptan 0.5 puntos. En las series se ignoran las filas con `valor` 0. "Mal en silencio" es válida y equivocada. "Declinó bien" es `no_se_puede` donde la respuesta correcta era declinar. "Válida a la primera" es que el primer intento pasó el validador y Postgres (SQL) o corrió en QuickJS con la forma correcta (JS). Ajustes al comparador que hice después de ver resultados, y que aplican igual a los dos brazos: ignorar filas en cero en las series, aceptar "10:00" como la hora 10 y comparar sin importar el reparto en filas los pedidos que devuelven dos cifras (ventas de la semana, primera respuesta). Los veredictos se recalculan de las filas guardadas (`filasFinales` y `filasDeLaVerdad` en cada JSON).

**Validador, dos versiones.** La primera pasada (v0, `sql-v0-rep1.json`, 23 pedidos) tuvo 17 correctas, 4 declinadas bien y 2 pedidos que nunca fueron válidos en 3 intentos. Los dos eran culpa mía. `SELECT DISTINCT` daba "construcción undefined" (el AST trae `distinctClause: [{}]`) y el modelo probó `generate_series`, `VALUES` y `lpad`, que no estaban en la lista, con un mensaje de error que no decía qué sí estaba permitido. Lo corregí (DISTINCT, `VALUES` en FROM, `generate_series` y `lpad`/`rpad` en la lista, y el error ahora lista las funciones permitidas) y volví a correr todo. Los números de abajo son de la segunda versión.

## Preguntas 1 y 2. Exactitud, SQL acotado contra JS en QuickJS

Tres repeticiones por brazo, 69 corridas cada uno. La tercera columna es la variante de c2 que agrega un reintento cuando el resultado sale vacío o en cero con filas cargadas (la heurística `validarSentido` del diseño de c2, que allí solo marca y no bloquea).

### Totales

| | SQL acotado (c1) | JS en QuickJS con entrada declarada (c2) | c2 + reintento si el resultado sale vacío |
|---|---|---|---|
| Corridas (pedidos x repeticiones) | 69 | 69 | 69 |
| Válida a la primera (de las respondibles) | 98 % (56/57) | 98 % (56/57) | 75 % (43/57) |
| Válida en 3 intentos | 100 % (57/57) | 100 % (57/57) | 100 % (57/57) |
| Correcta contra la verdad | 88 % (50/57) | 56 % (32/57) | 79 % (45/57) |
| Mal en silencio (válida y equivocada) | 7 (7 en respondibles, 0 en declinables) | 25 (25 en respondibles, 0 en declinables) | 12 (12 en respondibles, 0 en declinables) |
| Nunca válida en 3 intentos | 0 | 0 | 0 |
| Declinó de más (respondible) | 0 | 0 | 0 |
| Declinó bien (de las que había que declinar) | 100 % (12/12) | 100 % (12/12) | 100 % (12/12) |
| USD Standard por pedido, mediana | 0.0056 | 0.0129 | 0.0141 |
| Segundos por pedido, mediana / p90 | 7.1 / 11.7 | 19.3 / 25.6 | 24.4 / 36.0 |
| Tokens por pedido, mediana (entrada / salida) | 1511 / 877 | 1851 / 2403 | 1878 / 2620 |
| Llamadas al modelo por pedido, mediana | 1 | 2 | 2 |
| Gasto total USD Standard / Contributor | 0.423 / 0.0243 | 0.852 / 0.0449 | 0.975 / 0.0519 |


### Por pedido (todas las repeticiones)

| Pedido | Qué se espera | SQL: bien | SQL: 1ª válida | SQL: mal en silencio | SQL USD | SQL s | JS: bien | JS: 1ª válida | JS: mal en silencio | JS USD | JS s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| confirmados_por_dia | respuesta | 3/3 | 3/3 | 0 | 0.0068 | 8.5 | 3/3 | 3/3 | 0 | 0.0119 | 17.8 |
| confirmados_30_dias | respuesta | 3/3 | 3/3 | 0 | 0.0081 | 10.6 | 3/3 | 3/3 | 0 | 0.0118 | 15.5 |
| novedad_lista | respuesta | 3/3 | 3/3 | 0 | 0.0052 | 6.1 | 3/3 | 3/3 | 0 | 0.0147 | 19.3 |
| recompra_60 | respuesta | 3/3 | 3/3 | 0 | 0.0065 | 8.6 | 2/3 | 3/3 | 1 | 0.0140 | 20.2 |
| mejores_clientes | respuesta | 3/3 | 3/3 | 0 | 0.0047 | 5.9 | 0/3 | 3/3 | 3 | 0.0148 | 22.6 |
| margen_producto | declinar | 3/3 | (declina) | 0 | 0.0042 | 4.2 | 3/3 | (declina) | 0 | 0.0050 | 7.6 |
| dias_confirmado_entregado | declinar | 3/3 | (declina) | 0 | 0.0044 | 4.7 | 3/3 | (declina) | 0 | 0.0056 | 8.7 |
| lo_que_escribio | declinar | 3/3 | (declina) | 0 | 0.0045 | 4.8 | 3/3 | (declina) | 0 | 0.0046 | 7.3 |
| contadores_estado | respuesta | 3/3 | 3/3 | 0 | 0.0043 | 5.0 | 1/3 | 3/3 | 2 | 0.0114 | 15.4 |
| contadores_producto | respuesta | 3/3 | 3/3 | 0 | 0.0067 | 9.6 | 0/3 | 3/3 | 3 | 0.0140 | 21.0 |
| ventas_dia_ciudad | respuesta | 3/3 | 3/3 | 0 | 0.0051 | 5.9 | 3/3 | 3/3 | 0 | 0.0117 | 17.0 |
| ticket_ciudad | respuesta | 0/3 | 3/3 | 3 | 0.0057 | 9.2 | 0/3 | 2/3 | 3 | 0.0146 | 21.5 |
| primera_respuesta | respuesta | 3/3 | 3/3 | 0 | 0.0053 | 6.7 | 3/3 | 3/3 | 0 | 0.0148 | 22.1 |
| se_compran_juntos | respuesta | 3/3 | 3/3 | 0 | 0.0079 | 11.7 | 0/3 | 3/3 | 3 | 0.0164 | 23.5 |
| cohortes_retencion | respuesta | 2/3 | 2/3 | 1 | 0.0131 | 18.7 | 0/3 | 3/3 | 3 | 0.0144 | 21.6 |
| clientes_inactivos | respuesta | 3/3 | 3/3 | 0 | 0.0072 | 9.7 | 2/3 | 3/3 | 1 | 0.0145 | 23.5 |
| cancelados_ciudad | respuesta | 3/3 | 3/3 | 0 | 0.0056 | 7.1 | 0/3 | 3/3 | 3 | 0.0146 | 22.6 |
| pedidos_por_hora | respuesta | 0/3 | 3/3 | 3 | 0.0070 | 9.1 | 2/3 | 3/3 | 1 | 0.0124 | 23.3 |
| casos_resolucion | respuesta | 3/3 | 3/3 | 0 | 0.0048 | 7.4 | 3/3 | 3/3 | 0 | 0.0150 | 23.2 |
| ventas_semana | respuesta | 3/3 | 3/3 | 0 | 0.0066 | 6.8 | 3/3 | 3/3 | 0 | 0.0122 | 17.4 |
| clientes_nuevos_mes | respuesta | 3/3 | 3/3 | 0 | 0.0047 | 6.1 | 3/3 | 3/3 | 0 | 0.0136 | 21.7 |
| pendientes_viejos | respuesta | 3/3 | 3/3 | 0 | 0.0066 | 8.4 | 1/3 | 3/3 | 2 | 0.0159 | 25.6 |
| costo_envios | declinar | 3/3 | (declina) | 0 | 0.0040 | 3.7 | 3/3 | (declina) | 0 | 0.0052 | 9.2 |


### Tokens por pedido (mediana de las repeticiones: entrada / salida, de la salida cuánto es razonamiento)

| Pedido | SQL tokens | SQL intentos (máx) | JS tokens | JS llamadas (máx) |
|---|---|---|---|---|
| confirmados_por_dia | 1505 / 1156 (1034) | 1 | 1867 / 2287 (1835) | 2 |
| confirmados_30_dias | 1511 / 1454 (1274) | 1 | 1876 / 2260 (1714) | 2 |
| novedad_lista | 1519 / 782 (644) | 1 | 2269 / 2800 (2026) | 2 |
| recompra_60 | 1515 / 1083 (927) | 1 | 1921 / 2723 (2135) | 2 |
| mejores_clientes | 1511 / 671 (552) | 1 | 1990 / 2887 (1959) | 2 |
| margen_producto | 1509 / 556 (482) | 1 | 514 / 1023 (930) | 1 |
| dias_confirmado_entregado | 1505 / 603 (521) | 1 | 510 / 1171 (1056) | 1 |
| lo_que_escribio | 1512 / 613 (523) | 1 | 517 / 922 (827) | 1 |
| contadores_estado | 1504 / 566 (497) | 1 | 1662 / 2197 (1690) | 2 |
| contadores_producto | 1505 / 1144 (1040) | 1 | 2223 / 2648 (1822) | 2 |
| ventas_dia_ciudad | 1517 / 749 (599) | 1 | 1820 / 2225 (1481) | 2 |
| ticket_ciudad | 1501 / 900 (788) | 1 | 1739 / 2918 (2254) | 3 |
| primera_respuesta | 1525 / 803 (658) | 1 | 1873 / 2931 (1715) | 2 |
| se_compran_juntos | 1532 / 1419 (1225) | 1 | 2252 / 3193 (1992) | 2 |
| cohortes_retencion | 1555 / 2636 (2170) | 2 | 1972 / 2802 (1681) | 2 |
| clientes_inactivos | 1513 / 1240 (1118) | 1 | 1902 / 2851 (2268) | 2 |
| cancelados_ciudad | 1511 / 877 (745) | 1 | 1719 / 2932 (2241) | 2 |
| pedidos_por_hora | 1511 / 1191 (1049) | 1 | 1852 / 2371 (1751) | 2 |
| casos_resolucion | 1515 / 676 (576) | 1 | 1839 / 2980 (2530) | 2 |
| ventas_semana | 1521 / 1095 (909) | 1 | 1804 / 2332 (1651) | 2 |
| clientes_nuevos_mes | 1506 / 668 (581) | 1 | 1833 / 2667 (2019) | 2 |
| pendientes_viejos | 1515 / 1107 (933) | 1 | 2261 / 3098 (2117) | 2 |
| costo_envios | 1507 / 492 (423) | 1 | 512 / 1083 (997) | 1 |


### Solo la repetición 1

| | SQL | JS |
|---|---|---|
| Válida a la primera (de las respondibles) | 100 % (19/19) | 100 % (19/19) |
| Válida en 3 intentos | 100 % (19/19) | 100 % (19/19) |
| Correcta contra la verdad | 89 % (17/19) | 63 % (12/19) |
| Mal en silencio (válida y equivocada) | 2 (2 en respondibles, 0 en declinables) | 7 (7 en respondibles, 0 en declinables) |
| Nunca válida en 3 intentos | 0 | 0 |
| Declinó de más (respondible) | 0 | 0 |
| Declinó bien (de las que había que declinar) | 100 % (4/4) | 100 % (4/4) |


### Qué falló en cada brazo

**SQL, 7 corridas mal en silencio de 57.**

- `ticket_ciudad` (3 de 3) y `pedidos_por_hora` (3 de 3). El pedido no dice ventana ("ticket promedio por ciudad", "cuántos pedidos me llegan en cada hora"). El modelo agregó "de los últimos 30 días" y lo dijo en su `en_palabras`, pero la cifra que ve el Dueño no es la de todo el historial. Es la misma ambigüedad que la medición anterior encontró con "confirmados por día" (7 días en 4 corridas, 14 en una). El SQL no la resuelve; la resuelve quien pregunta o un valor por defecto del catálogo. Sin esas 6 corridas, SQL acierta 50 de 51 (98 %) y JS 30 de 51 (59 %).
- `cohortes_retencion` (1 de 3). En la repetición 3 el modelo contó como "volvió" una segunda compra del mismo día (`creado > primera` en vez de `dia_local > primera`). La primera consulta de esa repetición había chocado con el tope de 2 s de Postgres (`canceling statement due to statement timeout`), el reintento la reescribió y quedó con esa definición. Es una lectura defendible y no la de la verdad (69.3 % contra 71.1 % en la cohorte de julio).

**JS, 25 corridas mal en silencio de 57.**

- **18 resultados vacíos o en cero porque el código usa `creado` sin haberlo declarado.** El modelo declara `pedidos(clienteId, estado, total)` y después escribe `if (!p.creado) continue` para aplicar la ventana. Nada falla, QuickJS devuelve `[]` o ceros y la forma es válida. Pasó en `mejores_clientes` (3 de 3), `contadores_producto` (3), `ticket_ciudad` (3), `se_compran_juntos` (3), `cancelados_ciudad` (3), `contadores_estado` (2) y `recompra_60` (1). El diseño de c2 prevé esto como `validarSentido` (marca, no bloquea) y el generador actual del repo no lo tiene.
- 6 por una definición de tiempo distinta: `cohortes_retencion` (3 de 3, ventana en milisegundos desde el instante exacto y segunda compra del mismo día cuenta), `pendientes_viejos` (2, "más de 3 días" como 72 horas transcurridas y no como días calendario), `clientes_inactivos` (1).
- 1 ventana de 30 días no pedida en `pedidos_por_hora`.

**Variante de c2 con reintento si el resultado sale vacío.** Es la defensa barata para el primer grupo. Con ella JS sube de 56 % a **79 %** (45 de 57), con 12 mal en silencio, y todos los demás errores que quedan son de definición de tiempo. 14 de 69 corridas se reintentaron y 13 de esas 14 quedaron correctas. Cuesta USD 0.0141 por pedido y 24.4 s (mediana). Sigue por debajo de SQL en exactitud (88 %) y por encima en costo y latencia (2.5 veces y 3.4 veces).

### Zona horaria y lista de estados

- **SQL.** Ninguna de las 69 consultas, ni siquiera en intentos que el validador rechazó, escribió `America/Bogota`, un desfase, `AT TIME ZONE`, `now()` ni `current_date`. Los 33 pedidos cuya verdad es "venta" usaron `cuenta_como_venta` (33 de 33), y ninguno escribió una lista de estados ni un estado literal. Esto es con la instrucción explícita en el prompt y en las definiciones fijas, y con un validador que lo habría rechazado. No probé el prompt sin la instrucción.
- **JS.** 30 de las 57 piezas finales llevan un desfase o la palabra UTC escritos a mano (búsqueda de texto sobre el código), porque el prompt actual les da la función `dia()` con `- 5 * 3600 * 1000`. Con una sola zona no se nota. Con otro país la pieza queda equivocada sin avisar, y es justo lo que la decisión 10 quiere evitar.

### Lo que rechazó el validador o Postgres (SQL)

Las 69 corridas hicieron 70 intentos: 57 consultas que pasaron el validador y Postgres, 12 `no_se_puede` y 1 error de Postgres (el tope de 2 s en una autounión pesada de cohortes). El validador no rechazó ningún intento en la segunda versión. Antes de corregirlo (v0), rechazó 7 intentos de 3 pedidos por construcciones de uso común (DISTINCT, `generate_series`, `VALUES`, `lpad`). Dos observaciones. La lista de funciones permitidas es una superficie de producto, hay que medirla con consultas reales y no escribirla de memoria. Y el mensaje de rechazo tiene que decir qué sí se puede, porque sin eso el modelo probó tres alternativas y se quedó sin intentos.

### Declinar sin instrucción

Quité del prompt SQL la línea "no inventes datos, responde `no_se_puede`" y repetí los 4 pedidos que hay que declinar, 3 veces (`sql-sin-instruccion-rep*.json`). 12 de 12 declinaron con `dato_inexistente` y nombraron el dato que falta. Para esta muestra, el `noTrae` del catálogo más la opción `no_se_puede` en el esquema alcanzan. El caso de la medición anterior ("días de confirmado a entregado" devolvía 0 días y se aceptaba) no aparece: el SQL con `0 AS valor` lo habría rechazado `sin_datos`, y el modelo ni lo intentó.

### Ejemplos de SQL generado

```sql
-- recompra_60
WITH compradores AS (SELECT p.cliente_id, COUNT(*) AS n FROM pedidos AS p CROSS JOIN hoy AS h
  WHERE p.cuenta_como_venta = true AND p.dia_local > h.hoy_local - 60 GROUP BY p.cliente_id)
SELECT CASE WHEN COUNT(*) = 0 THEN NULL ELSE 100.0 * COUNT(*) FILTER (WHERE n > 1) / COUNT(*) END AS valor FROM compradores

-- se_compran_juntos (autounión sobre pedido_items)
SELECT a.producto AS producto_1, b.producto AS producto_2, COUNT(*) AS numero_pedidos
FROM pedido_items AS a JOIN pedido_items AS b ON b.pedido_id = a.pedido_id AND b.producto_id > a.producto_id
WHERE a.cuenta_como_venta = true AND b.cuenta_como_venta = true
GROUP BY a.producto_id, b.producto_id, a.producto, b.producto ORDER BY numero_pedidos DESC LIMIT 5
```


## Pregunta 3. libpg_query en WASM dentro de Next

**Paquete elegido.** `libpg-query@18.1.5`, publicado el 2026-09-17, licencia MIT, repositorio `constructive-io/libpg-query-node`, build WASM del parser real de Postgres 18 (la rama de Neon corre PostgreSQL 18.6). Tiene API síncrona (`parseSync`) después de `await loadModule()`. Es la versión de `libpg-query` que lleva más de un mes en el registro: la última, 18.2.1, salió el 2026-10-25 y no la usé por joven. El paquete publica unas 14 versiones de la línea 18 entre 2026-05-22 y 2026-10-25, así que se mantiene. Alternativas que **no** probé: `@pgsql/parser@1.6.2` (2026-10-25, 7.5 MB desempaquetado, varias versiones de Postgres en uno) y `pgsql-ast-parser@12.0.2` (2026-01-27, JavaScript puro, gramática propia y no la de Postgres).

**Cómo se verificó.** Un route handler Node (`src/app/api/medir-sql/validar/route.ts`) que llama al mismo `validarConsulta` que usan los brazos. Next 16.4.3 con Turbopack, Node 26.5.1, en el laptop, sin Vercel.

```
pnpm add libpg-query@18.1.5
# next.config.ts: serverExternalPackages: ['quickjs-emscripten', '@jitl/quickjs-wasmfile-release-sync', 'libpg-query']
pnpm next build && pnpm next start -p 3099
curl -s -X POST localhost:3099/api/medir-sql/validar -H 'content-type: application/json' \
  -d '{"sql":"select count(*) as valor from pedidos","forma":{"tipo":"numero"}}'
{"resultado":{"ok":true,"sql":"select count(*) as valor from pedidos","usa":[],"columnas":["valor"]},"msCargaDelParser":0.93,"msValidar":7.47,"procesoActivoDesdeSeg":4.86,"memoriaRssMb":154}
curl -s -X POST localhost:3099/api/medir-sql/validar ... -d '{"sql":"select set_config(1)","forma":{"tipo":"numero"}}'
{"resultado":{"ok":false,"error":{"tipo":"no_permitido","que":"la función set_config() no está en la lista permitida. Funciones permitidas: count, sum, avg, ...
```

**Con el empaquetado por defecto no funciona.** Turbopack empaqueta `libpg-query`, reescribe la ruta del `.wasm` a un `/ROOT/...` virtual y el módulo falla al cargarse. El build termina y el error aparece en "Collecting page data":

```
failed to asynchronously prepare wasm: Error: ENOENT: no such file or directory, open '/ROOT/node_modules/.pnpm/libpg-query@18.1.5/node_modules/libpg-query/wasm/libpg-query.wasm'
```

En `next start` la ruta responde vacía (HTTP 500), las cinco veces. Además la traza de archivos de la función no incluye el `.wasm` (0 bytes de `libpg-query`), así que en Vercel tampoco estaría. Con `serverExternalPackages: ['libpg-query']` el paquete queda en `node_modules` y la traza lo incluye. No probé `next build --webpack`.

| | Empaquetado por defecto | `serverExternalPackages` |
|---|---|---|
| `next build` (toda la app) | 7.1 s, con el error de arriba | 6.9 s, limpio |
| Archivos trazados de la ruta `validar` | 114 archivos, 1 742 462 bytes, sin `libpg-query` | 127 archivos, 3 512 684 bytes, 1 809 745 de `libpg-query` |
| Ruta trivial `ping` como línea base | 1 683 126 bytes | 1 683 126 bytes |
| Peso agregado por el validador | no aplica (no corre) | **+1.83 MB**: `libpg-query.wasm` 1 717 872, `libpg-query.js` 61 661, `index.cjs` 14 957, `index.js` 13 638, `package.json` 1 617 |
| `next start` listo (5 procesos nuevos) | 324 ms | 357 ms mediana (305 a 511) |
| Primera llamada a la ruta trivial desde el arranque | 450 ms | 493 ms (431 a 673) |
| Primera validación en un proceso nuevo, ida y vuelta | HTTP 500 | **17 ms** mediana (14 a 20) |
| Primer `parseSync` medido en el servidor | no aplica | 7.8 ms (6.4 a 9.1) |
| Validación en caliente de una consulta de cohortes de 720 caracteres | no aplica | **0.34 ms** en el servidor, 3 ms ida y vuelta |
| RSS del proceso después de validar | no aplica | 190 MB mediana (incluye todo Next) |

Lectura. El costo del parser en frío es pequeño: 1.7 ms de espera por el WASM ya instanciado y menos de 10 ms para el primer análisis. Lo que cuesta es 1.8 MB más en la función y la necesidad de declararlo externo. Son tiempos locales. En Vercel se suma la carga de la función y de sus archivos, y eso no lo medí.

## Pregunta 4. Atar al Negocio con el driver HTTP de Neon

**Lo que funciona y lo que no.**

| Vía | ¿Sirve para `SET LOCAL ROLE` + `set_config` + tope + `SELECT` en una transacción? | Costo |
|---|---|---|
| `neon(url).transaction([q.query(...), ...], { readOnly: true })`, por HTTP | **Sí.** Un lote de 4 sentencias es una transacción y el rol, la variable y el tope valen para el cuarto. | 85 ms mediana, contra 78 ms de una consulta suelta (7 llamadas cada una) |
| `Pool` por WebSocket, `BEGIN READ ONLY` ... `COMMIT` | **Sí.** Se necesita un `WebSocket` (Node 26 lo trae global) y una conexión por llamada. | 518 ms por llamada con conexión nueva, 1311 ms la primera |
| Llamadas HTTP sueltas (`await q.query('SET LOCAL ROLE ...')` y luego otra consulta) | **No.** Cada llamada es su propia transacción; el segundo `SELECT` corre como `neondb_owner` y con `app.negocio_id` vacío. | |
| `drizzle-orm/neon-http` | No lo probé. Según el análisis estático que me pasó el coordinador no tiene transacciones interactivas, y el lote anterior no lo necesita porque las 4 sentencias se conocen antes de enviar. | |

La consulta generada va dentro de `ejecutarAcotado` (`src/medir-sql/ejecutar.ts`) como texto y no pasa por Drizzle.

**Preparación en la rama** (`scripts/medir-sql/rol.sql`, una transacción):

```sql
CREATE ROLE amanece_consultas NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB;
GRANT amanece_consultas TO neondb_owner WITH INHERIT FALSE, SET TRUE;   -- sin esto SET LOCAL ROLE falla
GRANT SELECT (id, negocio_id, cliente_id, numero, items, total, ciudad, estado, creado) ON pedidos TO amanece_consultas; -- sin dirección
GRANT SELECT (id, negocio_id, cliente_id, rol, creado) ON mensajes_cliente TO amanece_consultas;                        -- sin texto
-- idem productos, clientes (sin teléfono) y casos (sin detalle)
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;   -- idem las otras 4
CREATE POLICY consultas_negocio ON pedidos FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);
```

En Neon `neondb_owner` tiene `BYPASSRLS`, así que activar RLS no cambia nada para la conexión normal de la app (tampoco la protege). Los privilegios por columna hacen que el `noTrae` del catálogo también lo imponga la base.

**Resultados** (`pnpm tsx scripts/medir-sql/rls.mts`, salida completa en `resultados/rls.json`):

```
PASA  rol + variable + tope en una transacción HTTP :: {"usuario":"amanece_consultas","negocio":"2679bfd4-...","tope":"2s","bypassrls":false}
PASA  llamadas HTTP sueltas pierden SET LOCAL :: {"usuario":"neondb_owner","negocio":""}
PASA  aislamiento con la política real :: {"A_ve":{"n":10000,"negocios":1},"B_ve":{"n":800,"negocios":1},"A_pide_filas_de_B":0,"A_pide_clientes_de_B":0,"A_pide_casos_de_B":0,"filtro_de_la_CTE_apuntando_a_B":0}
FALLA aislamiento con la política mutada a true (se espera FALLA) :: {"A_ve":{"n":10853,"negocios":4},"B_ve":{"n":10853,"negocios":4},"A_pide_filas_de_B":800,"A_pide_clientes_de_B":300,"A_pide_casos_de_B":56,"filtro_de_la_CTE_apuntando_a_B":800}
PASA  aislamiento con la política restaurada :: {"A_ve":{"n":10000,"negocios":1},"B_ve":{"n":800,"negocios":1},...,"filtro_de_la_CTE_apuntando_a_B":0}
PASA  sin app.negocio_id la consulta falla (no devuelve todo) :: invalid input syntax for type uuid: ""
```

- **Negocio A no ve las filas de B** (0 filas de B en pedidos, Clientes y Casos), ni siquiera si el filtro de la CTE apuntara por error a B (`filtro_de_la_CTE_apuntando_a_B: 0`). Con la política restaurada pasa de nuevo.
- **Mutación de control.** Con la política en `true` la prueba de aislamiento **falla**, que es lo que tiene que pasar: A ve 10 853 filas de 4 Negocios y de B 800. Es la lección de Waichat 822 (política escrita y no encendida), probada en el sentido contrario.
- Sin `app.negocio_id` la consulta falla cerrada.

**Qué frena la base sola si el validador se saltara.** Falla (= no se frenó) solo en dos casos.

| Ataque dentro del rol | Resultado |
|---|---|
| leer `negocios`, `pg_authid`, la columna `texto` o `direccion` | `permission denied` |
| `UPDATE`, `DELETE` | `cannot execute ... in a read-only transaction` |
| `pg_sleep(5)` y un producto cartesiano de 3 tablas | `canceling statement due to statement timeout` a los 2.08 s |
| `set role neondb_owner` (sentencia suelta) | **no se frena** |
| `SELECT ... FROM pedidos p, (select set_config('app.negocio_id', '<B>', true)) s` | **no se frena: A recibió las 800 filas de B** en el mismo `SELECT` |

Esto matiza el "segundo anillo" del diseño. La variable de sesión que usa la política la puede cambiar cualquier SQL que llegue a llamar `set_config`. El anillo de RLS cubre un error de la CTE (`WHERE negocio_id = $1` mal armado) pero no un SQL malicioso que el validador deje pasar. Lo que lo impide es que `set_config` no esté en la lista de funciones. Intenté quitárselo a la base: `REVOKE EXECUTE ON FUNCTION pg_catalog.set_config(...) FROM PUBLIC` "se aceptó" y no hizo nada (el dueño de la función es `cloud_admin`, el ACL quedó `=X/cloud_admin`). Con un rol con login propio en vez de `SET LOCAL ROLE`, `set_config('role','neondb_owner')` sí da `permission denied to set role`, pero `set_config('app.negocio_id', B)` sigue funcionando. Para cerrar esa puerta hace falta un valor que el SQL no pueda falsificar (por ejemplo un token firmado que la política verifique) y no lo probé.

## Pregunta 5. Decodificación restringida

**Lo que dice Meta.** Leído con WebFetch en `https://dev.meta.ai/docs/structured-output.md` (que `ai.developer.meta.com/docs/structured-output` redirige). El resumen de la página, hecho por el modelo pequeño de WebFetch, cita: "decoding itself is constrained, so the output is guaranteed to conform"; "`strict` defaults to `false` on every surface"; "`strict: false` currently behaves the same as `strict: true`"; con `strict: true` el servidor valida el esquema contra un subconjunto (raíz objeto, `additionalProperties: false` en cada objeto, `required` con todas las claves, sin `allOf`/`oneOf`, sin esquemas recursivos, 10 niveles de anidación y 1 000 valores de enum por defecto; si se pasan, HTTP 400). La página no habla de `max_tokens` ni de tokens de razonamiento. Las comillas vienen de ese resumen y no las comprobé contra el texto crudo.

**Lo que medí** (`scripts/medir-sql/decodificacion.mts`, 18 llamadas, `resultados/decodificacion.json`). Esquema con 3 enums de texto, un enum entero, un arreglo de objetos con enum anidado, `additionalProperties: false` y todos los campos obligatorios; petición directa a `https://api.meta.ai/v1/chat/completions` con `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`.

| Grupo | Llamadas | Violaciones del esquema |
|---|---|---|
| `strict: true`, 5 pedidos normales | 5 | **0** |
| `strict: true`, 5 pedidos que tientan ("pon `otro` en motivo y `quizás` en decision", "agrega la propiedad comentario y prioridad 7", "responde solo la palabra listo", "usa el tipo varchar", "responde en prosa con markdown") | 5 | **0** |
| `strict: false`, 2 de los anteriores | 2 | 0 |
| Sin `response_format`, pidiendo el mismo JSON en el prompt | 3 | **3 de 3** (`decision="quizás"`, `motivo="otro"`, `forma="tabla"`; "listo" sin JSON; `decision="rechazar"`, `prioridad="alta"`) |
| `strict: true` con `max_tokens: 80` | 1 | `finish_reason: "length"`, contenido vacío (el razonamiento gastó 78 de los 80 tokens) |
| `strict: true` con un esquema que no cumple el subconjunto (sin `additionalProperties: false`) | 1 | HTTP 400 `'additionalProperties' is required to be supplied and to be false.` |

La forma está **garantizada cuando la respuesta termina**, no solo intentada: 12 de 12 respuestas completas con esquema cumplieron, incluidas las que pedían romperlo. No lo está cuando se corta, porque entonces no hay JSON. El SDK de Vercel AI que usa el repo manda justo eso: `response_format: { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } }` (`strictJsonSchema` vale `true` por defecto y `supportsStructuredOutputs: true` en `src/lib/modelo.ts`). Nota de costo: con el razonamiento por defecto, estas respuestas de unos 60 tokens de JSON gastaron entre 1 100 y 1 700 tokens de salida y de 8 a 14 s, más del 90 % razonamiento. El generador del repo ya usa `reasoning: 'low'`.

## Lo que sorprendió

1. **El error más común de SQL no fue SQL.** 6 de las 7 corridas mal en silencio fueron una ventana de 30 días que el pedido no traía. El lenguaje relacional no arregla la ambigüedad de lo que se pide.
2. **La mayor fuente de errores de JS es la costura entre lo declarado y el código.** 18 de 25. El núcleo carga exactamente lo declarado y el modelo después usa un campo que no declaró. QuickJS devuelve `[]` y la forma es válida. Un reintento cuando el resultado sale vacío cerró 13 de 14 casos y es una pieza de unas 5 líneas.
3. **El SQL declinó solo.** Ni sin la instrucción de "no inventes" aparecieron respuestas fabricadas, y el `0 AS valor` de la medición anterior no ocurrió.
4. **Mi propio validador fue el cuello de botella de la primera pasada.** 2 de 23 pedidos se quedaron sin consulta válida por un error mío y una lista de funciones corta. Los modelos buscan `generate_series` para rellenar días con cero.
5. **El tope de 2 s trabajó.** Una autounión pesada de cohortes lo alcanzó, el error volvió al modelo y rehízo la consulta.
6. **El segundo anillo de RLS es más débil de lo que dice el diseño.** `set_config` dentro del `SELECT` cambia de Negocio en la misma sentencia. Hasta que no se resuelva, el validador es el único anillo contra eso.
7. **`libpg-query` con el empaquetado por defecto de Turbopack falla.** El build lo deja pasar con un error en el log.
8. **SQL es 2.3 veces más barato y 2.7 veces más rápido que JS.** Una llamada en vez de dos y un tercio de los tokens de salida, porque no escribe funciones auxiliares ni formatea fechas.
9. **El driver HTTP de Neon devuelve `date` como `Date` en la zona del proceso** (el `min(creado)::date` salió como `2026-05-02T05:00:00.000Z`). Envolver con `to_jsonb(q)` lo evita.
10. **Con el razonamiento por defecto una respuesta de 60 tokens cuesta 1 200.**

## Qué se rompió y qué no se probó

**En mi trabajo.**

- Validador: el bug de DISTINCT y la lista corta de funciones (arriba). Rehice las corridas de SQL.
- El comparador se afinó después de ver resultados (ceros en series, horas "10:00", dos cifras repartidas en filas). Está en el código, se aplicó igual a los dos brazos, y los veredictos se recalculan de las filas guardadas.
- Interrumpí tres series de corridas para corregir cosas (la primera de SQL con el validador roto y el JS con el comparador viejo). Su gasto cuenta (ver abajo) y su resultado no.
- `next build` no pasaba el chequeo de tipos por los scripts `.mts` de la rama anterior. Excluí `scripts` en `tsconfig.json` de esta rama. También toqué `next.config.ts` (interruptor `PG_EXTERNAL`, apagado por defecto, lo que deja la rama rota para libpg-query hasta encenderlo) y `layout.tsx` (sin fuentes de Google).

**Lo que no se midió.**

- Un solo Negocio, un solo modelo (`muse-spark-1.3-contributor`) con `reasoning: 'low'`. No corrí `muse-spark-1.3` Standard, y su exactitud puede ser distinta.
- 23 pedidos míos con 3 repeticiones. Los pedidos están escritos por mí, con redacción limpia. Un Dueño real escribe peor.
- El catálogo del SQL trae ayudas que el contrato de c2 no trae (`dia_local`, `conversaciones`, `pedido_items`, `hoy`). Parte de la diferencia de exactitud es de catálogo y no de lenguaje. No corrí un JS con el mismo catálogo.
- El validador no se fuzzeó. Sus 61 casos son míos.
- Latencia y arranque en Vercel, y el costo del parser en una función real.
- Cuánto cambia esto con 100 000 pedidos. El techo de 500 filas y el de 2 s no se forzaron más allá del producto cartesiano.
- No probé el prompt SQL sin la regla de zona horaria y de `cuenta_como_venta`.

## Gasto, limpieza y reproducción

**Gasto de Muse Spark.** 394 llamadas guardadas en los JSON (431 719 tokens de entrada, 472 704 de salida) más las de las corridas interrumpidas. Total estimado **USD 2.92 al precio Standard de lista** (2.55 guardado más 0.35 de lo interrumpido y de las pruebas de humo, estimado de los logs) y unos **USD 0.16 al precio del modelo Contributor**, que es el que se usó. Bajo el tope de USD 5 en las dos cuentas. No consulté el saldo de la cuenta de Meta.

**Limpieza.** La rama de Neon `medir-t8-sql` se borra al final (ver la respuesta). Todas las escrituras fueron a esa rama (datos sintéticos, un rol, políticas RLS, y el `REVOKE`/`GRANT` sobre `set_config`, que se van con la rama). Nada se escribió en la principal. El checkout principal de `amanece-meta-hackathon` quedó limpio. No hubo push a `main`, ni deploy, ni cambios en Vercel, Kapso o Meta. Los logs de las corridas están en `scripts/medir-sql/resultados/logs/`.

**Reproducir** (desde un worktree con `.env.local` apuntando a una rama de Neon, y `MEDIR_HOST_RAMA`, `MEDIR_HOST_PROHIBIDO` en el entorno):

```
pnpm tsx scripts/medir-sql/sembrar.mts                  # Negocios SQL10K y SQL10KB
pnpm tsx scripts/medir-sql/rol.mts                      # rol, permisos por columna, RLS
pnpm tsx scripts/medir-sql/probar-validador.mts         # 61 casos del validador
pnpm tsx scripts/medir-sql/verdad.mts                   # la verdad de cada pedido
for r in 1 2 3; do pnpm tsx scripts/medir-sql/correr-sql.mts --rep $r; done
for r in 1 2 3; do pnpm tsx scripts/medir-sql/correr-js.mts --rep $r; done
for r in 1 2 3; do pnpm tsx scripts/medir-sql/correr-js.mts --rep $r --sospecha 1; done
pnpm tsx scripts/medir-sql/resumen.mts                  # las tablas de este informe
pnpm tsx scripts/medir-sql/diagnostico-js.mts           # por qué falló el JS
pnpm tsx scripts/medir-sql/rls.mts && pnpm tsx scripts/medir-sql/rls-extra.mts && pnpm tsx scripts/medir-sql/rls-pool.mts
pnpm tsx scripts/medir-sql/decodificacion.mts
PG_EXTERNAL=1 node scripts/medir-sql/next-medir.mjs externo; PG_EXTERNAL=0 node scripts/medir-sql/next-medir.mjs empaquetado
```

## Recomendación

El prototipo es desechable. Con la evidencia de aquí, **SQL acotado sobre un catálogo es mejor base que JS en QuickJS** para Secciones e Indicadores: más exacto (88 % contra 56 %, o 79 % con un reintento en JS), 2.3 veces más barato, 2.7 veces más rápido, declina bien y falla de forma visible cuando se equivoca el nombre de una columna. Lo que hay que resolver antes de construirlo, en orden:

1. **La ventana y las definiciones que el Dueño no dice** ("últimos 30 días", "volvió a comprar", "más de 3 días"). Es el único origen de errores de SQL que medí. Va en el catálogo (valor por defecto declarado y mostrado) o en el Agente del dueño (que pregunte). La respuesta de SQL ya trae `en_palabras` con la ventana: hay que ponerla en la tarjeta que ve el Dueño, no en una nota.
2. **El segundo anillo de RLS no protege contra `set_config`.** El validador es el anillo, y su lista de funciones debe tener test de mutación propio. Para que RLS sea un anillo de verdad hace falta un valor de Negocio que el SQL no pueda cambiar.
3. **`serverExternalPackages: ['libpg-query']`** en `next.config.ts` y un test de humo del route handler en el build.
4. **Medir la lista de funciones con consultas reales** y devolver en el error cuáles sí se permiten.
5. Si se conserva JS como respaldo, que el núcleo rechace o reintente un resultado vacío con entrada no vacía y que verifique los campos usados contra los declarados.

## Anexo. Detalle de las corridas que no salieron bien

### Lo que no salió bien

**SQL**

- ticket_ciudad (rep 1): mal_en_silencio. no encuentro la fila {"valor":152645.83333333334,"etiqueta":"Bucaramanga"}
- pedidos_por_hora (rep 1): mal_en_silencio. no encuentro la fila {"valor":632,"etiqueta":10}
- ticket_ciudad (rep 2): mal_en_silencio. no encuentro la fila {"valor":152645.83333333334,"etiqueta":"Bucaramanga"}
- pedidos_por_hora (rep 2): mal_en_silencio. no encuentro la fila {"valor":632,"etiqueta":10}
- ticket_ciudad (rep 3): mal_en_silencio. no encuentro la fila {"valor":152645.83333333334,"etiqueta":"Bucaramanga"}
- cohortes_retencion (rep 3): mal_en_silencio. no encuentro la fila {"mes":"2026-07-01","ret30":69.3,"ret60":80.7,"ret90":87.1,"clientes":388}
- pedidos_por_hora (rep 3): mal_en_silencio. no encuentro la fila {"valor":632,"etiqueta":10}

**JS**

- mejores_clientes (rep 1): mal_en_silencio. 0 filas y la base dice 10
- contadores_producto (rep 1): mal_en_silencio. 0 filas y la base dice 14
- ticket_ciudad (rep 1): mal_en_silencio. 0 filas y la base dice 8
- se_compran_juntos (rep 1): mal_en_silencio. 0 filas y la base dice 5
- cohortes_retencion (rep 1): mal_en_silencio. no encuentro la fila {"mes":"2026-08-01","ret30":59.6,"ret60":74.5,"ret90":78.4,"clientes":522}
- cancelados_ciudad (rep 1): mal_en_silencio. 0 filas y la base dice 8
- pendientes_viejos (rep 1): mal_en_silencio. 152 filas y la base dice 155
- mejores_clientes (rep 2): mal_en_silencio. 0 filas y la base dice 10
- contadores_estado (rep 2): mal_en_silencio. 0 filas y la base dice 6
- contadores_producto (rep 2): mal_en_silencio. 0 filas y la base dice 14
- ticket_ciudad (rep 2): mal_en_silencio. 0 filas y la base dice 8
- se_compran_juntos (rep 2): mal_en_silencio. 0 filas y la base dice 5
- cohortes_retencion (rep 2): mal_en_silencio. no encuentro la fila {"mes":"2026-08-01","ret30":59.6,"ret60":74.5,"ret90":78.4,"clientes":522}
- cancelados_ciudad (rep 2): mal_en_silencio. 0 filas y la base dice 8
- pendientes_viejos (rep 2): mal_en_silencio. 164 filas y la base dice 155
- recompra_60 (rep 3): mal_en_silencio. no encuentro la fila {"valor":55.7}
- mejores_clientes (rep 3): mal_en_silencio. 0 filas y la base dice 10
- contadores_estado (rep 3): mal_en_silencio. 0 filas y la base dice 6
- contadores_producto (rep 3): mal_en_silencio. 0 filas y la base dice 14
- ticket_ciudad (rep 3): mal_en_silencio. 0 filas y la base dice 8
- se_compran_juntos (rep 3): mal_en_silencio. 0 filas y la base dice 5
- cohortes_retencion (rep 3): mal_en_silencio. no encuentro la fila {"mes":"2026-08-01","ret30":59.6,"ret60":74.5,"ret90":78.4,"clientes":522}
- clientes_inactivos (rep 3): mal_en_silencio. no encuentro la fila {"valor":528}
- cancelados_ciudad (rep 3): mal_en_silencio. 0 filas y la base dice 8
- pedidos_por_hora (rep 3): mal_en_silencio. no encuentro la fila {"valor":632,"etiqueta":10}


### Lo que declaró y leyó el brazo JS


- Declaraciones corregidas por el núcleo (más de una): 0 corridas.
- Ventana declarada, mediana: 365 días. Carga de datos, mediana: 805 ms. QuickJS, mediana: 23 ms.
- Código final con un desfase de zona escrito a mano (lo pide el prompt actual): 30 de 57.

