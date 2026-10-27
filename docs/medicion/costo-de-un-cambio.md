# Cuánto cuesta y cuánto tarda un Cambio con Muse Spark

Medición del paso "medir" de la decisión "Cómo queda funcionando un Cambio". Es un prototipo desechable. Lo que queda como artefacto son los números, los scripts de `scripts/medir/` y los JSON de `scripts/medir/resultados/`. Nada de esto es código de Amanece.

## Resumen

- **Un Cambio cuesta entre USD 0.0023 y 0.0030 con el modelo que usa hoy el repo** (`muse-spark-1.3-contributor`, tabla de precios del código) y entre USD 0.033 y 0.043 al precio de lista Standard de `muse-spark-1.3`. La estimación de "~USD 1 por Cambio" queda unas 23 veces por encima del peor caso Standard y entre 330 y 430 veces por encima del caso Contributor. Medido, con tokens y respuestas reales.
- **Un Cambio tarda unos 21 segundos de máquina desde el mensaje del Dueño hasta que queda aplicado** (mediana 20.5 s regla, 21.9 s Indicador, 21.3 s Sección), sin contar lo que el Dueño tarde en leer y decir que sí. Es el camino real, con dos turnos del Agente del dueño.
- **El generador de código es la fase más larga de un Indicador o una Sección (8.6 y 11.3 s de unos 21), pero no es lo que más cuesta.** El 62 % (regla) o el 77 % (Indicador y Sección) del gasto es el Agente del dueño conversando, y sus cuatro llamadas suman entre 11 y 13 s. El 67 % al 83 % del gasto son tokens de entrada, porque cada llamada reenvía el prompt de sistema y las herramientas. El 74 % de los tokens de salida es razonamiento, y los tokens de salida mandan sobre la latencia (unos 6.5 ms por token).
- **QuickJS no es un cuello de botella.** 0.8 ms sobre los datos sembrados, 25 ms sobre un Negocio de 10 mil pedidos (porque `datosDelNegocio` solo le entrega 2000), 98 ms con 10 mil pedidos reales en memoria. El límite de 32 MB aguanta 50 mil pedidos (justo) y se rompe con 100 mil.
- **El riesgo no es que un Cambio falle, es que salga mal sin avisar.** 0 de 35 Cambios por el Hilo fallaron y el generador nunca tuvo que reintentar. Pero con 10 mil pedidos un Indicador de "últimos 30 días" mostró 1656 donde la base dice 2752 (40 % menos), a la primera y sin error. El aislamiento entre Negocios sí se sostuvo: nada cambió en el Negocio B (14 tablas, prompt del Agente de clientes, Panel) tras cuatro Cambios aplicados en A.
- **La medición que el sistema guarda subestima.** `cambios.costoUsd` captura el 23 % del costo real de un Indicador o una Sección y el 38 % de una regla. `msHastaAplicado` mezcla tiempo de máquina con el tiempo que el Dueño tarda en leer. La página `/medicion` muestra esos números.

## Cómo se midió

**Camino medido.** El Dueño escribe a su Agente del dueño (`responderEnElHilo`, el mismo código que usa el Panel). El agente propone, el generador escribe el código, QuickJS lo corre sobre los datos del Negocio, el Cambio queda `propuesto`. En un segundo turno el Dueño dice "Sí, aplícalo." y el agente llama `aplicar_cambio`. Cada corrida usa un Dueño nuevo con un Hilo vacío. Después de cada corrida se revierte el Cambio para que la siguiente parta del mismo estado.

**Instrumento.** `scripts/medir/entorno.mts` envuelve `fetch` antes de cargar `src/`. Anota cada llamada a `api.meta.ai` y a Neon con hora de inicio, primer byte, fin, estado HTTP y el `usage` de la respuesta. Clasifica cada llamada al modelo por quién la hizo (Agente del dueño, generador, Agente de clientes) mirando el prompt. Los tokens y el tiempo salen de ahí, no de lo que el código guarda. Todas las llamadas al modelo respondieron 200 (199 de 199 en las corridas por el Hilo).

**Definición de las fases.**

| Fase | Qué incluye |
|---|---|
| entender | Mensaje del Dueño hasta que la primera llamada del Agente del dueño termina de decidir la herramienta. En una regla incluye escribir el texto de la regla y la pregunta de prueba. |
| generar | Llamadas al generador. No aplica a la regla. |
| vista previa | Resto de la herramienta `proponer_*`. En Indicador y Sección son las lecturas a Neon, QuickJS y el guardado. En la regla son las dos simulaciones del Agente de clientes, en paralelo. |
| explicar | Respuesta final del Agente del dueño al Dueño. |
| confirmar | Primera llamada del turno 2, hasta que decide llamar `aplicar_cambio`. |
| aplicar | La herramienta `aplicar_cambio`, que es solo base de datos. |
| hasta aplicado (máquina) | Turno 1 completo, más confirmar, más aplicar. Sin tiempo humano entre turnos. |

**Entorno.**

- Modelo `muse-spark-1.3-contributor` (el `MODEL_ID` de `.env.local`), reasoning por defecto del Agente del dueño y `low` en generador y Agente de clientes, tal como está el código.
- Neon: rama desechable `medir-t8`, creada de la principal. Las 15 variables de base de datos de la rama apuntan al host de la rama (`ep-damp-scene-b8louqpz`), ninguna al de la principal. `entorno.mts` se niega a arrancar si alguna apunta fuera de la rama o a la principal. La rama trajo copiados los Negocios sembrados LADERA (41 pedidos) y TRIGO (12 pedidos).
- Envío: `ENVIO_SIMULADO=1` en todas las corridas. Antes de la primera corrida leí `enviarAlCliente` en `src/negocio/whatsapp.ts`. Todo texto saliente pasa por `mandar()`, y `mandar()` devuelve antes de llamar a `enviarTexto` si `ENVIO_SIMULADO === '1'`. `enviarTexto` solo se importa en ese archivo. Como segunda capa, `KAPSO_API_KEY` quedó vacía en la rama y `fetch` bloquea cualquier host que no sea `api.meta.ai` o Neon (ninguna corrida lo disparó). Prueba viva en `scripts/medir/envio.mts`. `enviarAlCliente` imprimió `[envío simulado a 570000000777] ...`, devolvió `wamid: null` y no hizo llamadas de red fuera de Neon.
- No se usó Neon Auth. Los scripts llaman las funciones del servidor con el Negocio ya resuelto, como los `probar-*`.
- Máquina: laptop del desarrollador hacia Neon en us-east-1 y hacia `api.meta.ai`. Los tiempos de Neon (unos 85 a 110 ms por consulta HTTP) son de esa ruta, no de Vercel.

**De dónde sale el precio.** La tabla `PRECIOS` de `src/lib/modelo.ts` (USD por millón de tokens, entrada / salida) trae `muse-spark-1.3` a 1.25 / 4.25 y `muse-spark-1.3-contributor` a 0.10 / 0.20. Leí la página de precios de Meta (`dev.meta.ai/docs/pricing-rate-limits`) y coincide con esos cuatro números, así que es el precio de lista real. Tres matices.

1. La página cobra los tokens de entrada que coinciden con un prefijo en caché a otra tarifa (0.15 en Standard, 0.002 en Contributor). `costoUsd` cobra todo a tarifa plena. El código sobreestima. Con los tokens en caché que devolvió la API, el costo de estas corridas habría sido entre 30 % y 37 % menor en Standard y entre 40 % y 49 % menor en Contributor. El caché acertó el prefijo fijo del Agente del dueño (3313 tokens de prompt y herramientas) en 100 de 134 llamadas, con las corridas una tras otra. Con tráfico espaciado el acierto sería menor, así que las cifras "con la tarifa de caché" son un piso optimista.
2. La página no distingue tokens de razonamiento. Se cobran como salida, igual que hace el código.
3. El nivel Contributor es más barato a cambio de que Meta pueda usar el contenido para entrenar modelos futuros. Con clientes reales eso puede pesar más que el precio.

Cuando la tabla dice "USD Standard" son los mismos tokens medidos con el modelo Contributor, multiplicados por la tarifa Standard. No corrí `muse-spark-1.3`, así que su latencia y su calidad no están medidas.

## Resultados por tipo de Cambio

Cinco corridas de cada tipo, intercaladas (regla, Indicador, Sección, regla, ...). Todas por el Hilo, en Café Ladera.

### Medianas

| | Regla | Indicador | Sección |
|---|---|---|---|
| Pedido | "Si preguntan por envíos fuera de la ciudad, no prometas fecha y abre un Caso." | "Quiero ver los pedidos confirmados por día." | "Quiero ver una lista de los pedidos con novedad." |
| Llamadas al modelo | 7 | 5 | 5 |
| Tokens de entrada / salida (de razonamiento) | 25 110 / 2638 (2057) | 17 969 / 2566 (1886) | 18 754 / 2741 (1829) |
| **USD, tabla del código (Contributor)** | **0.00304** | **0.00231** | **0.00242** |
| USD con la tarifa de caché (Contributor) | 0.00181 | 0.00131 | 0.00124 |
| **USD al precio Standard de lista** | **0.0426** | **0.0333** | **0.0351** |
| USD Standard con la tarifa de caché | 0.0297 | 0.0218 | 0.0222 |
| **Hasta aplicado, máquina (s)** | **20.5** (18.7 a 46.5) | **21.9** (16.5 a 24.9) | **21.3** (18.1 a 25.6) |
| Hasta ver "aplicado" en el chat (s) | 22.1 | 24.3 | 23.1 |
| Turno 1 / turno 2 (s) | 18.7 / 3.8 | 19.3 / 5.0 | 19.2 / 4.3 |
| Aplicado a la primera, sin reintentos | 5 de 5 | 5 de 5 | 5 de 5 |
| Gasto del Agente del dueño / del resto | 62 % / 38 % (simulaciones) | 77 % / 23 % (generador) | 77 % / 23 % (generador) |
| Parte del gasto que son tokens de entrada (Contributor / Standard) | 83 % / 74 % | 78 % / 67 % | 77 % / 67 % |

### Fases, medianas en segundos

| | entender | generar | vista previa | explicar (t1) | confirmar | aplicar | explicar (t2) |
|---|---|---|---|---|---|---|---|
| Regla | 5.4 | no aplica | 8.6 (dos simulaciones) | 5.0 | 1.9 | 0.3 | 1.7 |
| Indicador | 4.1 | 8.6 | 0.8 (QuickJS 5 ms) | 5.0 | 1.9 | 0.3 | 2.3 |
| Sección | 3.2 | 11.3 | 0.8 (QuickJS 6 ms) | 3.7 | 1.9 | 0.3 | 2.0 |

"Vista previa en el intérprete aislado" de un Indicador o una Sección es 0.8 s, y de eso QuickJS es 5 ms. El resto son lecturas a Neon por HTTP y el guardado. Aplicar es 0.3 s. Lo que se siente lento son las llamadas al modelo, no el intérprete ni la base.

### Regla, corrida por corrida

| # | resultado | llamadas | tokens entrada / salida (razonamiento) | USD código | USD Standard | turno 1 (s) | turno 2 (s) | hasta aplicado (s) | a la primera | reintentos |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | aplicado | 7 | 25 095 / 2950 (2357) | 0.00310 | 0.0439 | 21.6 | 4.7 | 24.2 | sí | 0 |
| 2 | aplicado | 7 | 25 119 / 2094 (1490) | 0.00293 | 0.0403 | 16.8 | 3.8 | 18.7 | sí | 0 |
| 3 | aplicado | 7 | 25 035 / 2468 (1889) | 0.00300 | 0.0418 | 18.3 | 3.6 | 20.4 | sí | 0 |
| 4 | aplicado | 7 | 25 110 / 3068 (2505) | 0.00312 | 0.0444 | 44.2 | 5.8 | 46.5 | sí | 0 |
| 5 | aplicado | 7 | 25 127 / 2638 (2057) | 0.00304 | 0.0426 | 18.7 | 3.4 | 20.5 | sí | 0 |

| # | entender | vista previa | explicar t1 | confirmar | aplicar | explicar t2 | consultas a Neon / segundos |
|---|---|---|---|---|---|---|---|
| 1 | 5.1 | 9.4 | 6.8 | 2.4 | 0.2 | 2.0 | 18 / 2.1 |
| 2 | 3.4 | 8.6 | 4.4 | 1.6 | 0.3 | 1.7 | 18 / 1.8 |
| 3 | 5.4 | 7.6 | 5.0 | 1.9 | 0.3 | 1.3 | 18 / 2.2 |
| 4 | 6.4 | 32.3 | 5.2 | 2.0 | 0.2 | 3.3 | 18 / 2.1 |
| 5 | 6.8 | 7.3 | 4.3 | 1.6 | 0.3 | 1.4 | 18 / 2.2 |

La corrida 4 es un valor atípico de la API (una simulación del Agente de clientes tardó 31.7 s, las demás entre 4 y 9 s). No se repitió. En 15 corridas es la que dice cuál es la cola de la latencia, no la mediana. La regla funcionó en las cinco: la simulación "antes" no llamó `abrir_caso` y la simulación "después" sí. La pregunta de prueba que inventó el Agente del dueño cambió cada vez (Medellín, Bucaramanga, Cali, Cali, Bucaramanga). La regla quedó redactada en general ("fuera de la ciudad") sin preguntar cuál es la ciudad del Negocio.

### Indicador, corrida por corrida

| # | resultado | llamadas | tokens entrada / salida (razonamiento) | USD código | USD Standard | turno 1 (s) | turno 2 (s) | hasta aplicado (s) | a la primera | reintentos |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | aplicado | 5 | 18 248 / 3288 (2614) | 0.00248 | 0.0368 | 22.8 | 4.3 | 24.9 | sí | 0 |
| 2 | aplicado | 5 | 17 931 / 2479 (1858) | 0.00229 | 0.0329 | 18.1 | 4.2 | 20.6 | sí | 0 |
| 3 | aplicado | 5 | 17 969 / 2413 (1751) | 0.00228 | 0.0327 | 14.9 | 6.0 | 16.5 | sí | 0 |
| 4 | aplicado | 5 | 17 998 / 3033 (2329) | 0.00241 | 0.0354 | 22.2 | 9.9 | 24.1 | sí | 0 |
| 5 | aplicado | 5 | 17 949 / 2566 (1886) | 0.00231 | 0.0333 | 19.3 | 5.0 | 21.9 | sí | 0 |

| # | entender | generar | vista previa | QuickJS (ms) | explicar t1 | confirmar | aplicar | explicar t2 | consultas a Neon / segundos |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 4.1 | 11.0 | 0.8 | 43 | 6.5 | 1.9 | 0.3 | 2.0 | 20 / 2.2 |
| 2 | 3.5 | 8.6 | 0.7 | 7 | 5.0 | 2.2 | 0.2 | 1.6 | 20 / 2.2 |
| 3 | 2.3 | 7.0 | 0.7 | 5 | 4.5 | 1.4 | 0.3 | 4.1 | 20 / 2.3 |
| 4 | 5.5 | 10.6 | 1.7 | 3 | 4.2 | 1.6 | 0.3 | 7.7 | 20 / 4.1 |
| 5 | 4.2 | 7.1 | 1.0 | 4 | 6.6 | 2.3 | 0.3 | 2.3 | 20 / 3.5 |

Corrección del resultado. Las cinco series coinciden con la verdad sacada de la base con SQL, si "confirmados" se cuenta como el código del generador lo define (confirmado, enviado, entregado y novedad). Con la lectura estricta (solo `confirmado`) no coincide ninguna. Cuatro corridas tomaron 7 días como ventana y una tomó 14, porque el pedido no dice cuántos.

### Sección, corrida por corrida

| # | resultado | llamadas | tokens entrada / salida (razonamiento) | USD código | USD Standard | turno 1 (s) | turno 2 (s) | hasta aplicado (s) | a la primera | reintentos |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | aplicado | 5 | 18 751 / 2741 (1829) | 0.00242 | 0.0351 | 18.8 | 4.3 | 21.0 | sí | 0 |
| 2 | aplicado | 5 | 18 754 / 2534 (1600) | 0.00238 | 0.0342 | 19.2 | 3.8 | 21.3 | sí | 0 |
| 3 | aplicado | 5 | 18 797 / 3667 (2574) | 0.00261 | 0.0391 | 23.6 | 4.9 | 25.6 | sí | 0 |
| 4 | aplicado | 5 | 18 791 / 2905 (1856) | 0.00246 | 0.0358 | 19.6 | 5.1 | 22.0 | sí | 0 |
| 5 | aplicado | 5 | 18 699 / 2298 (1422) | 0.00233 | 0.0331 | 16.0 | 3.8 | 18.1 | sí | 0 |

| # | entender | generar | vista previa | QuickJS (ms) | explicar t1 | confirmar | aplicar | explicar t2 | consultas a Neon / segundos |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 4.0 | 10.4 | 0.8 | 6 | 3.2 | 1.9 | 0.2 | 2.0 | 20 / 2.4 |
| 2 | 3.2 | 11.4 | 0.7 | 6 | 3.7 | 1.8 | 0.3 | 1.5 | 20 / 2.2 |
| 3 | 5.9 | 11.7 | 0.8 | 5 | 4.9 | 1.7 | 0.3 | 2.8 | 20 / 2.5 |
| 4 | 2.6 | 11.3 | 0.8 | 7 | 4.5 | 2.2 | 0.3 | 2.5 | 20 / 2.2 |
| 5 | 2.5 | 9.2 | 0.7 | 2 | 3.4 | 1.9 | 0.3 | 1.5 | 20 / 2.2 |

Corrección. Las cinco devolvieron 4 filas y la base tiene 4 pedidos con novedad. Las columnas cambian de una corrida a otra (entre 6 y 7).

## Dónde se va el costo y el tiempo

**Costo.** Medianas de las 15 corridas, en USD con la tabla del código.

| | Agente del dueño | Generador | Simulaciones del Agente de clientes |
|---|---|---|---|
| Regla | 0.00188 | no aplica | 0.00116 |
| Indicador | 0.00180 | 0.00053 | no aplica |
| Sección | 0.00186 | 0.00057 | no aplica |

El Agente del dueño hace 4 llamadas por Cambio (dos por turno: decidir la herramienta y explicar el resultado). Cada una lleva un prompt de sistema con 11 herramientas, unos 3.9 mil tokens de entrada en mediana en 98 llamadas. Cuando acierta la caché de Meta, unos 3.3 mil de esos tokens se cobran a la tarifa de caché (ver arriba). La regla agrega 3 llamadas del Agente de clientes (la simulación sin regla, y la simulación con regla que hace una vuelta de herramienta), cada una con un prompt de unos 3.2 mil tokens.

**Tiempo.** Con las 131 llamadas al modelo de las corridas principales y difíciles, el tiempo de una llamada se ajusta a `ms = 1172 + 6.5 × tokens de salida` (r = 0.74), es decir unos 154 tokens por segundo. Los tokens de entrada no explican el tiempo (correlación -0.47). El 74 % de todos los tokens de salida es razonamiento (83 % en el Agente del dueño, 59 % en el generador, 73 % en el Agente de clientes). Una llamada de humo sin ajuste de razonamiento, "Di hola en una palabra", devolvió 11 tokens de texto y 487 de razonamiento. Neon aporta unas 20 consultas HTTP por Cambio y unos 2.2 s en total (entre 9 % y 11 % del tiempo), por esta ruta de red.

**Experimento, razonamiento `low` en el Agente del dueño.** El generador y el Agente de clientes ya usan `reasoning: 'low'`; el Agente del dueño no pasa ninguno. Apliqué un parche de una línea en el worktree (`scripts/medir/razonamiento-dueno.patch`, ya revertido) y corrí 3 Cambios de cada tipo.

| | Hasta aplicado (s) | Tokens de salida | USD (código) | Aplicados / herramienta correcta |
|---|---|---|---|---|
| Regla | 20.5 a 14.9 (-27 %) | 2638 a 1505 | 0.00304 a 0.00281 (-8 %) | 3 de 3 / 3 de 3 |
| Indicador | 21.9 a 15.8 (-28 %) | 2566 a 1737 | 0.00231 a 0.00214 (-7 %) | 3 de 3 / 3 de 3 |
| Sección | 21.3 a 16.4 (-23 %) | 2741 a 1896 | 0.00242 a 0.00225 (-7 %) | 3 de 3 / 3 de 3 |

Son 3 corridas por tipo, así que el efecto sobre la calidad no queda demostrado, solo que no apareció un caso malo. El ahorro de tiempo es grande y el de dinero es chico, porque el dinero lo mandan los tokens de entrada.

**Hilo largo.** Tres Cambios seguidos en el mismo Hilo (Indicador, Sección, regla, cada uno con su "Sí, aplícalo."). La primera llamada del Agente del dueño de cada turno recibió 3386, 3878, 4086, 4845, 5073 y 5591 tokens de entrada: unos 0.7 a 1 mil tokens más por cada Cambio acumulado. Costo por Cambio en el hilo (sus dos turnos): 0.0024, 0.0026 y 0.0036 USD. El Agente del dueño ve como máximo 40 mensajes por turno (`MENSAJES_QUE_VE_EL_MODELO`), así que el crecimiento tiene techo. No medí un Hilo de producción tras el alta, que arrastra la entrevista del modo `armando`.

## Fallas, reintentos y lo que salió mal sin avisar

**Fallas duras.** En 35 Cambios por el Hilo (15 principales, 8 de los 10 pedidos difíciles, 9 del experimento de razonamiento y 3 del hilo largo) los 35 quedaron `aplicado`. De las 26 piezas (Indicador o Sección), las 26 corrieron en QuickJS al primer intento. El reintento de `proponerPieza` (hasta 2 correcciones con el error a la vista) no se ejecutó nunca con un modelo real. Solo se ha ejercido con código malo a propósito en `probar-dueno.mts` (caso 3b).

**Pedidos difíciles**, dos corridas de cada uno, en Café Ladera.

| Pedido | Qué pasó | ¿Está bien? |
|---|---|---|
| "Margen de ganancia por producto" | Ninguna propuesta. El agente miró el negocio y pidió el costo de cada producto (corrida 1) o llamó `registrar_capacidad_faltante` (corrida 2). | Sí. Es el comportamiento esperado. |
| "Porcentaje de clientes que me compró más de una vez en 60 días" | Indicador aplicado, 63.6 % (7 de 11). | Sí. SQL da 11 clientes con compra y 7 repiten. |
| "Mis mejores clientes por total comprado" | Sección aplicada, 12 filas, primera Camila Rojas con 12 pedidos y 1 339 000 COP. | Sí. SQL da lo mismo. En la corrida 1 el generador repitió la columna `nota` en cada fila. |
| "Días promedio de confirmado a entregado" | Indicador aplicable con valor 0 días. | **No.** `pedidos` solo tiene `creado`, sin fecha de confirmación ni de entrega (lo comprobé con `information_schema`). El agente lo explicó en las dos corridas y preguntó "¿Lo aplico?". El sistema lo acepta y un Panel mostraría "0 días". |
| "Conversaciones de hoy con lo que escribió cada cliente" | Sección aplicable, 0 filas, columnas de conteos. | **A medias.** `datosDelNegocio` no entrega el `texto` de los mensajes. En la corrida 1 el agente dijo que la lista mostraba "lo que escribió", lo cual no es cierto. En la corrida 2 lo aclaró. |

**Negocio de 10 mil pedidos** (`SINTETICO`: 10 000 pedidos en 90 días, 12 000 mensajes, 700 Casos, 400 Clientes, creado en la rama). `datosDelNegocio` le pasa al código 2000 pedidos (los más recientes, de 2026-10-09 a 2026-10-27), 5000 mensajes y 500 Casos. Pedí tres veces "los pedidos confirmados por día en los últimos 30 días", directo por `proponerPieza` y `aplicarCambio`.

| Corrida | resultado | Indicador calculó | SQL dice | días con valor distinto | generar (s) | QuickJS (ms) | Panel con la pieza (ms) |
|---|---|---|---|---|---|---|---|
| 1 | propuesto, 1 intento | 1656 | 2752 | 12 de 30 | 7.9 | 61 | 875 |
| 2 | propuesto, 1 intento | 1656 | 2752 | 12 de 30 | 5.2 | 47 | 912 |
| 3 | propuesto, 1 intento | 1656 | 2752 | 12 de 30 | 7.3 | 36 | 965 |

El resultado tiene la forma correcta, el generador no se entera de nada y el Dueño vería 1656. Solo los últimos 18 días están completos. Con "una lista de todos mis pedidos" y "todos los entregados este mes" la Sección devolvió 200 filas en el primer intento, y `totalFilas` dice 200 porque se cuenta después de recortar, así que el recorte no se ve.

## QuickJS: tiempo y memoria

Código generado en las 10 corridas Indicador y Sección, 5 repeticiones por combinación, con los mismos límites de `aislado.ts` (1000 ms, 32 MB, 1 MB de pila).

| Conjunto | filas (pedidos / mensajes / casos) | JSON | carga desde Neon (ms) | pieza | cargar datos en QuickJS (ms) | calcular (ms) | total QuickJS, mediana [mín a máx] (ms) | `correrAislado` (ms) | memoria retenida (MB) | límite mínimo que pasa (MB) |
|---|---|---|---|---|---|---|---|---|---|---|
| Café Ladera | 41 / 182 / 4 | 0.04 MB | 161 | Indicador | 0.5 | 0.2 | 0.8 [0.7 a 3.7] | 1 | 0.2 | 1 |
| Café Ladera | 41 / 182 / 4 | 0.04 MB | 161 | Sección | 0.5 | 0.1 | 0.7 [0.6 a 1.0] | 1 | 0.2 | 1 |
| Trigo y Leña | 12 / 48 / 1 | 0.01 MB | 158 | Indicador | 0.2 | 0.1 | 0.3 [0.2 a 0.5] | 0 | 0.1 | 1 |
| Trigo y Leña | 12 / 48 / 1 | 0.01 MB | 158 | Sección | 0.2 | 0.1 | 0.3 [0.2 a 0.3] | 0 | 0.1 | 1 |
| Sintético (10 mil en la base, 2000 / 5000 / 500 tras los topes) | 2000 / 5000 / 500 | 1.45 MB | 557 | Indicador | 21.7 | 3.7 | 25.3 [24.2 a 35.1] | 27 | 2.7 | 2 |
| Sintético (idem) | 2000 / 5000 / 500 | 1.45 MB | 557 | Sección | 21.3 | 2.7 | 24.2 [22.9 a 26.1] | 26 | 2.7 | 2 |

Casi todo el tiempo de QuickJS es meter los datos (`JSON.parse` del literal): 21.7 de 25.3 ms. Calcular cuesta 3 ms. Hay una carga única de WebAssembly de 6 ms en el primer `getQuickJS()` del proceso. El heap de WebAssembly del módulo es 16 MB. Con los datos reales, leer los datos de Neon (557 ms) cuesta 20 veces lo que cuesta correr el código.

**Sin los topes de `datosDelNegocio`** (datos en memoria con la forma de LADERA, mensajes = 2.5 veces los pedidos, el primer Indicador generado):

| pedidos (mensajes) | JSON | total QuickJS (ms) | cargar datos (ms) | memoria retenida (MB) | límite mínimo que pasa (MB) | `correrAislado` real |
|---|---|---|---|---|---|---|
| 1000 (2500) | 0.6 MB | 10 | 8 | 1.1 | 1 | ok, 10 ms |
| 2000 (5000) | 1.1 MB | 19 | 17 | 2.1 | 2 | ok, 22 ms |
| 5000 (12 500) | 2.9 MB | 50 | 42 | 5.2 | 4 | ok, 54 ms |
| 10 000 (25 000) | 5.7 MB | 98 | 84 | 10.2 | 8 | ok, 113 ms |
| 20 000 (50 000) | 11.4 MB | 203 | 186 | 20.4 | 16 | ok, 227 ms |
| 50 000 (125 000) | 28.5 MB | 504 | 438 | 50.8 | 32 | ok, 564 ms |
| 100 000 (250 000) | 57.0 MB | 331 | 338 | sin dato | más de 256 | falla, `InternalError: out of memory` |

El tiempo crece lineal, unos 10 ms por cada mil pedidos (con sus 2500 mensajes), y la memoria unos 1 MB por cada mil. Este código de cálculo es simple, así que el límite que se rompe antes es el de memoria, a unos 50 mil pedidos. Un código generado que haga trabajo cuadrático rompería el de 1 s mucho antes, y eso no se probó. Qué haría `proponerPieza` si el límite se rompe lo leí en el código (tres intentos y luego `descartado`), no lo ejecuté.

**Costo de pintar el Panel.** Cada vista del Panel llama `piezasActivas`, que carga `datosDelNegocio` y corre cada pieza en un runtime nuevo. Con una pieza en el Negocio sintético midió entre 875 y 965 ms. Con las dos piezas de Café Ladera, QuickJS tardó 4 y 9 ms cada una y la carga de datos tarda unos 160 ms, así que la carga domina (no medí el total de ese Panel).

## Aislamiento entre Negocios

**Qué se hizo.** Con A = Café Ladera y B = Panadería Trigo y Leña. Se tomó la huella de B (conteo de filas y md5 de sus filas, tabla por tabla), el md5 de `datosDelNegocio(B)` sin el reloj, el prompt de sistema que de verdad recibe el modelo del Agente de clientes de B (tomado de la petición HTTP, sin la línea de la hora), y lo que ve el Agente del dueño de B. Después se aplicaron en A cuatro Cambios (una regla, un Indicador, una Sección y un cambio de conocimiento con horario nuevo y un producto nuevo), y se repitió todo. Script: `scripts/medir/aislamiento.mts`. Salida completa: `scripts/medir/resultados/aislamiento.json`.

La consulta de la huella, una por tabla:

```sql
select count(*)::int as n,
       md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as h
from <tabla> t
where negocio_id = '<B>'   -- en negocios: where id = '<B>'
```

**B antes y después** (las 14 tablas con `negocio_id`):

| Tabla | antes | después | igual |
|---|---|---|---|
| negocios | 1 fila 78854a890918 | 1 fila 78854a890918 | sí |
| duenos | 0 filas | 0 filas | sí |
| productos | 7 filas d42f073aac52 | 7 filas d42f073aac52 | sí |
| clientes | 5 filas cbd41794f795 | 5 filas cbd41794f795 | sí |
| mensajes_cliente | 48 filas 0c2cadce8e4b | 48 filas 0c2cadce8e4b | sí |
| pedidos | 12 filas 189e370d6748 | 12 filas 189e370d6748 | sí |
| casos | 1 fila 46d462edab1f | 1 fila 46d462edab1f | sí |
| cambios, reglas, piezas, mensajes_dueno, capacidades_faltantes, turnos, sesiones_whatsapp | 0 filas | 0 filas | sí |

**A, para comprobar que la huella sí detecta cambios.** `negocios` (md5 fc63033c0902 a d0f24bcb4e9d), `duenos` 27 a 28, `productos` 8 a 9, `cambios` 27 a 31, `reglas` 6 a 7, `piezas` 21 a 23, `turnos` 96 a 98. Cambiaron. `clientes`, `pedidos`, `casos` y `mensajes_cliente` no cambiaron, como corresponde.

**Lo que ve cada agente.**

| Comprobación | Resultado |
|---|---|
| `datosDelNegocio(B)`, md5 antes / después | 2793610c7f31 / 2793610c7f31, igual |
| Prompt del Agente de clientes de B, md5 antes / después | 72d22f7afabf / 72d22f7afabf, igual. Diff de líneas: 0 quitadas, 0 agregadas |
| Prompt del Agente de clientes de A | cambió: horario nuevo, el café de aislamiento con su precio, la regla como regla 1 |
| ¿El texto de la regla de A está en el prompt de B? | no (en el de A, sí) |
| ¿"Café de aislamiento" está en el prompt de B? | no (en el de A, sí) |
| `reglasActivas(B)`, `piezasActivas(B)` (lo que pinta el Panel de B) | 0, 0 (`piezasActivas(A)` da 2) |
| `ver_negocio` del Agente del dueño de B | 0 reglas, 0 piezas, 7 productos, su horario original. Igual que antes |
| `listar_cambios` del Agente del dueño de B | `[]` |
| Misma pregunta a los dos, "¿Me pueden enviar a Cali y cuánto demora?" | A, con la regla: llamó `abrir_caso` y le dijo al Cliente que ya se lo pasó al Dueño. B: no llamó herramientas y contestó con su propia política ("solo entregamos en Bogotá"). |

**Desde B se intentó tocar los Cambios de A.**

```
obtenerCambio(B, cambio propuesto de A)         -> null
aplicarCambio(B, cambio propuesto de A)         -> rechazado: No encontré ese Cambio propuesto en este Negocio
revertirCambio(B, cambio aplicado de A)         -> rechazado: No encontré ese Cambio aplicado en este Negocio
listarCambios(B)                                -> 0 filas
estado del cambio de A tras el intento          -> propuesto (sin tocar)
estado de la regla de A tras intentar revertirla -> aplicado (sin tocar)
```

Después de esos intentos la huella de B siguió igual. Lo que esta prueba no cubre. Probó el camino con el Negocio ya resuelto (como los `probar-*`), no la puerta de sesión de `duenoActual()`. Probó un Cambio de cada tipo, no concurrencia entre dos Dueños.

## Qué se rompió

**En mi trabajo.**

1. Mi harness de QuickJS abortó en la primera corrida con `Assertion failed: list_empty(&rt->gc_obj_list)`. Fue un descuido mío. Leí la memoria con `runtime.computeMemoryUsage()` y no liberé el handle. `correrAislado` no llama eso, así que el código del repo no se ve afectado. Corregido y repetido.
2. `neonctl connection-string medir-t8` sin `--pooled` devuelve el host directo, no el del pooler. Para el pooled hay que pasar `--pooled`. Lo vi al comparar hosts antes de la primera escritura.
3. Mi primer cálculo de tokens por segundo falló para las llamadas sin streaming, donde el primer byte coincide con el fin. Lo recalculé con el tiempo total de la llamada.

**En el producto, durante unas 45 propuestas (35 por el Hilo, 5 directas al Negocio sintético, 5 de aislamiento).** Más una corrida de prueba inicial por el Hilo, que borré. Ninguna cayó en `descartado` y ninguna devolvió un error de QuickJS. Nada se rompió de forma visible. Lo que salió mal salió bien según el sistema (ver la sección siguiente).

## Qué del diseño actual hizo que un Cambio costara más o saliera mal

Cada punto dice si está medido o inferido.

1. **Cada llamada reenvía todo el contexto, y eso es el gasto.** 18 a 25 mil tokens de entrada por Cambio, 67 % a 83 % del gasto. El Agente del dueño manda su prompt y las 11 herramientas en 4 llamadas por Cambio (medido). Una consulta mínima al Agente del dueño ya cuesta unos 3.4 mil tokens (medido).
2. **El Cambio gasta dos turnos de conversación aunque sea una operación sin ambigüedad.** El 62 % al 77 % del gasto es el Agente del dueño decidiendo y explicando, no el generador. Aplicar es una escritura de 0.3 s, pero llega dentro de un turno completo de 4 a 5 s con dos llamadas más al modelo (medido).
3. **El Agente del dueño usa el razonamiento por defecto del modelo.** El 83 % de sus tokens de salida es razonamiento. Con `low`, el tiempo hasta aplicado bajó 23 a 28 % y la salida 31 a 43 %, con 9 de 9 Cambios correctos. El dinero bajó 7 a 8 % (medido, 3 corridas por tipo).
4. **El código ignora la tarifa de caché.** `costoUsd` cobra todo a tarifa plena. Con los tokens en caché que devuelve la API, el costo real de estas corridas fue 30 % a 37 % menor en Standard y 40 % a 49 % menor en Contributor (medido con el `usage` y la página de precios). La caché acertó el prefijo fijo en 100 de 134 llamadas del Agente del dueño con las corridas seguidas, y con tráfico espaciado acertaría menos (inferido).
5. **Lo que el sistema mide de un Cambio no es el Cambio.** `cambios.costoUsd` y `tokens*` solo suman las llamadas dentro de `proponerPieza` o `proponerRegla`. Falta el Agente del dueño (medido: 23 % del costo real en Indicador y Sección, 38 % en regla). Los turnos del Agente del dueño están en `turnos`, pero sin vínculo con el Cambio, y las simulaciones de la regla no están en `turnos`. Si se suman las dos fuentes, el generador cuenta dos veces. `msHastaAplicado` suma `msHastaPropuesta` más el tiempo desde que se creó el Cambio, así que incluye lo que el Dueño tarde en leer y no incluye la primera llamada de entender (el valor guardado en estas corridas fue 15.6, 18.1 y 18.5 s de mediana, frente a 20.5, 21.9 y 21.3 s medidos). `docs/diseno.md` promete "desde el pedido hasta que queda aplicado". Hoy no se cumple. `/medicion` muestra "Costo medio" de un Indicador en 0.0005 USD.
6. **Los topes de `datosDelNegocio` recortan en silencio.** 2000 pedidos, 5000 mensajes, 500 Casos. Con 10 mil pedidos un Indicador de 30 días sale 40 % bajo, a la primera y sin error (medido). Una Sección recorta a 200 filas y `totalFilas` dice 200 (medido). Nada de eso llega al Agente del dueño ni al Dueño. Un Negocio con volumen empieza a pasar esto desde unos 2000 pedidos.
7. **Nada valida que el resultado tenga sentido.** `validarForma` revisa la forma, no el significado. Un Indicador que no puede saber la respuesta (días de entrega, sin fechas en `datos`) devuelve 0 y pasa. La honestidad depende de que el modelo lo diga en su explicación, y no siempre lo hizo. En las 4 corridas de "días de entrega" y "conversaciones" el agente lo advirtió en 3 y en 1 no (medido).
8. **La ambigüedad de "confirmados" y de "por día" la resuelve el generador, sin preguntar.** La regla del prompt cuenta confirmado, enviado, entregado y novedad como confirmados. La ventana elegida fue 7 días en 4 corridas y 14 en una. El Dueño recibe una cifra. La nota con la definición vive en el resultado, no en la explicación del agente (medido).
9. **Cada Panel pagado paga la carga de datos.** `piezasActivas` lee `datosDelNegocio` entero (5 consultas, 160 ms con datos chicos, 557 ms con el tope lleno) y crea un runtime por pieza. QuickJS no pesa (medido), pero el costo escala con las piezas y el volumen, no con lo que cambia (el escalado a más piezas es inferido).
10. **El reintento del generador es lo que no se probó con un modelo real.** Está pensado para errores de código, y el error más probable en un Negocio grande es de datos o de memoria, que el generador no puede corregir. Lo leí en el código, no lo corrí.

## Gasto, limpieza y reproducción

**Gasto.** Unas 223 llamadas a Muse Spark, unos 0.80 millones de tokens de entrada y 0.11 millones de salida, contando las corridas, la prueba de humo, las pruebas de aislamiento y las dos de lista (las de aislamiento y humo están estimadas, el resto se suma de los JSON). Eso es unos **USD 0.10** a la tarifa Contributor, que es la que se usó, y unos **USD 1.5** si se cobrara a tarifa Standard. Bajo el tope de USD 5 en ambos casos. No consulté el saldo real de la cuenta de Meta.

**Limpieza.** La rama de Neon `medir-t8` se borra al final (ver el estado en la respuesta). Ninguna escritura fue a la base principal. El checkout principal de `amanece-meta-hackathon` no se tocó (su `git status` quedó limpio). No se hizo push a `main`, no hubo deploy, no se tocaron variables de Vercel, Kapso ni Meta.

**Reproducir.** Desde un worktree del repo con `.env.local` que apunte a una rama de Neon:

```
export MEDIR_HOST_RAMA=<host de la rama> MEDIR_HOST_PROHIBIDO=<host de main>
  pnpm tsx scripts/medir/cambios.mts --n 5            # 15 Cambios por el Hilo
  pnpm tsx scripts/medir/cambios.mts --n 2 --tipos margen,recompra,clientes,entrega,conversaciones --salida scripts/medir/resultados/dificiles.json
  pnpm tsx scripts/medir/cambios.mts --hilo-largo true --salida scripts/medir/resultados/hilo-largo.json
  pnpm tsx scripts/medir/sintetico.mts 10000                # crea el Negocio sintético
  pnpm tsx scripts/medir/quickjs.mts                        # QuickJS sobre el código generado
  pnpm tsx scripts/medir/sintetico-cambio.mts 3
  pnpm tsx scripts/medir/aislamiento.mts
  pnpm tsx scripts/medir/resumen.mts                        # tablas en Markdown
```

**Lo que no se midió.**

- `muse-spark-1.3` (Standard): solo se reprecian los tokens, no se corrió.
- Latencia desde Vercel: las consultas a Neon van desde un laptop.
- Frío de la función (arranque en frío de Next y de QuickJS).
- Hilos de producción largos, otros Dueños en paralelo y límites de tasa de la API (ningún 429 en 199 llamadas).
- El tiempo humano entre turnos.
