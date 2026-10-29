# Medición del turno durable del Agente de clientes

Prototipo desechable para el ticket #13 (de qué base de código partimos y dónde corre). No es código de producción. Se midió el 28 de octubre de 2026 desde Colombia, contra una rama desechable de Neon en `us-east-1` y contra Muse Spark (`muse-spark-1.3-contributor`) con mensajes inventados.

## La pregunta

Hoy el webhook de Kapso (`src/app/api/kapso/webhook/route.ts`) responde 200 y atiende dentro de `after()`. `recibirMensaje` (`src/negocio/whatsapp.ts`) reclama el `wamid` guardando el mensaje antes del turno. Si la función muere después de ese INSERT, el Cliente no recibe respuesta y la reentrega de Kapso se descarta: el turno corre a lo sumo una vez. Las tres bases anteriores de Daniel convergieron en filas de Postgres con claves únicas, un reclamo atómico y un cron que barre lo vencido.

Se mide con código real, en cuatro partes.

1. Cuánto tarda hoy un turno del Agente de clientes y cuánto de eso es modelo y cuánto base de datos.
2. Cuánto cuesta volver durable ese mismo turno con una cola en Postgres.
3. Si esa cola aguanta dos drenadores a la vez, entregas repetidas y fallas inyectadas sin responder dos veces ni perder un mensaje en silencio.
4. Cuánto cuesta una ida y vuelta al driver HTTP de Neon desde aquí, para estimar el costo desde Vercel `iad1`.

## Conclusión

Volver durable el turno con dos tablas de Postgres cuesta 6 escrituras (535 ms en p50 desde Colombia, unos 12 a 48 ms estimados desde `iad1`) sobre un turno de 4,2 s que es 74 % modelo, y en las fallas inyectadas no hubo ni una respuesta duplicada ni una pérdida silenciosa; lo único que el diseño no resuelve solo son las salidas reclamadas sin confirmación, que quedan marcadas `incierta` y visibles.

## Cómo se midió

**Dónde.** Una rama desechable de Neon, copiada de `main` (que es compartida entre desarrollo y producción) y borrada al terminar. El Negocio es Café Ladera, sembrado con `scripts/sembrar.mts`. El script aborta si el host de `DATABASE_URL` no es el de esa rama. El envío es simulado (`ENVIO_SIMULADO=1`) y las llaves de Kapso van vacías, así que no puede salir nada. Los Clientes son inventados: teléfonos inventados con el prefijo `57390` y preguntas genéricas de un Negocio de café. Máquina: Mac con 10 núcleos en Colombia, Node 26, un proceso que espera casi siempre en la red.

**La cola.** Dos tablas (`scripts/medir-turno-durable.sql`). El reclamo de un trabajo dura 30 s y el de una salida 6 s.

- `trabajos(clave UNIQUE, estado, intentos, disponible_desde, reclamado_hasta, carga)`. `estado` pasa de `pendiente` a `en_curso` y a `hecho` (o `muerto` después de cinco intentos). La `clave` es `entrada:<wamid>`.
- `salientes(en_respuesta_a UNIQUE, estado, reclamado_hasta, wamid)`. `estado` pasa de `pendiente` a `enviando` y a `enviada`. Si el reclamo de `enviando` vence sin confirmación, pasa a `incierta`.

Cada operación es una sola petición al driver HTTP de Neon:

| operación | sentencia |
| --- | --- |
| encolar | `INSERT … ON CONFLICT (clave) DO NOTHING` |
| reclamar | `UPDATE trabajos SET estado='en_curso', intentos=intentos+1, reclamado_hasta=now()+… WHERE id = (SELECT id … WHERE estado='pendiente' OR (estado='en_curso' AND reclamado_hasta < now()) … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING …` |
| terminar | `UPDATE … SET estado='hecho' WHERE id=$1 AND estado='en_curso' AND intentos=$2` (`intentos` es la cerca: quien perdió el reclamo no puede cerrar el trabajo de otro) |
| crear la salida | `INSERT … ON CONFLICT (en_respuesta_a) DO UPDATE SET en_respuesta_a=excluded.en_respuesta_a RETURNING …` (devuelve la que ya existía, con su texto) |
| reclamar la salida | `UPDATE salientes SET estado='enviando', reclamado_hasta=now()+… WHERE id=$1 AND estado='pendiente'` |
| marcar enviada | `UPDATE salientes SET estado='enviada', wamid=$2 WHERE id=$1 AND estado IN ('enviando','incierta')` |
| barrer | `UPDATE salientes SET estado='incierta' WHERE estado='enviando' AND reclamado_hasta < now()` |

El barredor es el mismo drenador corriendo cuando vence un reclamo, más la sentencia de barrer. Un trabajo vencido se reclama otra vez por la misma sentencia de reclamar.

**El turno.** `responderComoAgenteDeClientes`, la misma función del Agente de clientes. Alrededor hace lo mismo que `recibirMensaje` (Negocio, sesión, ficha del Cliente, guardar el mensaje, historial, enviar con `enviarAlCliente`), con tres cambios: el mensaje entrante se guarda con un upsert que se puede repetir, la respuesta del modelo se guarda en `salientes` antes de reclamarla, y un reintento que encuentra su salida ya creada no vuelve a llamar al modelo.

**Qué hace un reintento con la salida que encuentra.**

| estado de la salida | acción |
| --- | --- |
| no existe | redactar de nuevo (modelo) |
| `pendiente` | reclamarla y enviarla |
| `enviando`, reclamo vigente | esperar a que venza (no reenviar) |
| `enviando`, reclamo vencido | declararla `incierta` y terminar el trabajo |
| `enviada` o `incierta` | terminar el trabajo sin enviar |

**Latencia (1 y 2).** Veinte pares. En cada par corre un turno por `recibirMensaje` y uno por la cola, con el mismo texto y dos Clientes distintos y nuevos. El orden dentro del par alterna (base y durable, durable y base) para que la deriva del modelo y de la red no favorezca a un lado. Antes de los pares corre un turno de calentamiento por lado que no cuenta. Todas las peticiones HTTP pasan por un `fetch` que las clasifica (`api.meta.ai` es modelo, `neon.tech` es base de datos) y mide su cuerpo entero. Con eso cada turno se reparte en modelo, base de datos y otro, uniendo los intervalos para no contar dos veces lo que corre en paralelo. Después de cada turno, fuera del cronómetro, el script comprueba que el Cliente tiene una sola respuesta que no es una disculpa, que salió un solo envío simulado y que no hubo ningún `console.error`.

**Fallas (3).** Cuatro cortes reales y treinta mensajes en proceso.

- *Cortes reales.* Cuatro procesos hijos reclaman un trabajo cada uno y se matan con `SIGKILL` en cada punto (después de reclamar, antes del modelo; después del modelo, antes de reclamar la salida; después de reclamar la salida, antes de enviar; después de enviar, antes de marcar).
- *Treinta mensajes.* Dos drenadores corren a la vez en un mismo proceso (el de `after()` y el del cron). Cinco `wamid` llegan dos veces, dos al mismo tiempo y tres cuatro segundos después. Nueve mensajes tienen una falla inyectada, cuatro con un error lanzado y cinco con un corte. Los tres puntos pedidos se partieron en cinco: la falla después del modelo cae antes o después de guardar la respuesta (p2x y p2), y la falla después de reclamar la salida cae antes o después de enviar (p3a y p3b). La base no distingue esos dos últimos y el resultado para el Cliente es distinto. Un corte lanza una excepción que nadie atrapa: el drenador no toca la base y el trabajo se queda `en_curso`, como si el proceso hubiera muerto. Otra invocación sigue el trabajo.
- *Barredor.* Cuando termina la primera pasada, el script espera a que venza cada reclamo y vuelve a correr dos drenadores y la sentencia de barrer, hasta que no queda nada pendiente.
- *Qué se afirma.* Se afirma con `afirmar` y el script sale con 1 si algo falla. La verdad de qué envíos salieron de verdad viene del log del envío simulado, no de la base, para que una salida `enviada` o `incierta` se pueda contrastar con lo que pasó.

Para comprobar que las afirmaciones pueden fallar, se corrió el arnés con el modelo simulado y dos sabotajes puntuales. Sin `FOR UPDATE SKIP LOCKED` fallaron 6 afirmaciones (reclamos dobles, solapamiento y la cerca de `terminar`). Con el reenvío a ciegas de lo `enviando` fallaron 4 (envíos duplicados y mensajes del agente repetidos). Con el diseño tal cual, ninguna.

**Red (4).** Treinta `select 1` por el driver HTTP de Neon tras uno de calentamiento, y treinta conexiones TCP al mismo host, antes y después de todo lo demás.

## Resultados

Todas las cifras son milisegundos desde Colombia, con veinte turnos por lado, salvo donde se dice otra cosa. Con n = 20, el p95 es una interpolación entre los dos valores más altos.

### 1 y 2. Un turno, hoy y con la cola

| medida | hoy p50 | hoy p90 | hoy p95 | con la cola p50 | con la cola p90 | con la cola p95 |
| --- | --- | --- | --- | --- | --- | --- |
| desde que entra el mensaje hasta la fila de respuesta | 4197 | 6240 | 7427 | 4543 | 7166 | 8068 |
| de eso, modelo | 3119 | 4938 | 6014 | 3157 | 5522 | 6566 |
| de eso, base de datos | 1111 | 1288 | 1393 | 1386 | 1653 | 1695 |
| de eso, otro (CPU, armado del prompt) | 12 | 14 | 16 | sin separar | sin separar | sin separar |
| `turnos.ms` (modelo más las lecturas del turno) | 3411 | 5231 | 6450 | 3471 | 5805 | 6936 |
| hasta terminar el trabajo (la función sigue viva) | no aplica | no aplica | no aplica | 4716 | 7335 | 8237 |
| peticiones a Neon por turno | 14 | 14 | 15 | 19 | 19 | 19 |

Hoy el turno es 74 % modelo, 26 % base de datos y 0,3 % otra cosa (p50 de cada parte). Con la cola, la base de datos pasa de 14 a 19 peticiones.

### El sobrecosto de la cola, sentencia por sentencia

Es la suma de lo que se cronometró alrededor de cada sentencia durante los mismos veinte turnos.

| medida | p50 | p95 |
| --- | --- | --- |
| encolar (`INSERT … ON CONFLICT DO NOTHING`) | 85 | 167 |
| reclamar (`UPDATE … SKIP LOCKED`) | 86 | 104 |
| terminar | 84 | 99 |
| **sobrecosto de la cola: encolar + reclamar + terminar** | **270** | **341** |
| salida: crear + reclamar + marcar enviada | 267 | 343 |
| **sobrecosto total, 6 sentencias** | **535** | **618** |
| de ese total, lo que el Cliente espera antes de recibir su respuesta (4 sentencias) | 357 | 432 |
| lo que se paga después de que el Cliente ya recibió su respuesta (marcar y terminar; diferencia de p50 entre terminar y responder) | 173 | no medido |

El sobrecosto es 12,7 % del turno actual en p50 (535 de 4197), y 8,5 % lo que el Cliente espera (357 de 4197). Las 6 sentencias son escrituras. Antes de responder hay 4 sentencias nuevas y no 6, y se compensa con una consulta menos: el dedupe de `recibirMensaje` (`SELECT` por `wamid`) ya no hace falta porque la `clave` única lo hace. Por eso la base de datos sube 275 ms (1386 menos 1111), tres idas y vueltas, y no 357.

La diferencia emparejada de punta a punta (con la cola menos hoy) fue +360 ms en p50, pero con un rango de menos 1387 a más 2687 ms. Es ruido del modelo, porque dos llamadas al mismo servicio no tardan lo mismo, y con 20 pares no se separa. No se usa como medida del sobrecosto. La medida es la de las sentencias y la de la base de datos.

Cada sentencia aislada, con la base en reposo (30 repeticiones, otra corrida en un momento de más jitter): p50 entre 92 y 127 ms y mínimo entre 88 y 89 ms para las ocho (`encolar`, `encolar` repetido, `reclamar`, `terminar`, `encolar` ya reclamado, y las tres de la salida). La variante de ingreso que encola ya reclamado en una sola sentencia (`encolar_reclamado`, p50 117 ms) cuesta lo mismo que `encolar` y ahorraría la sentencia `reclamar` del camino de `after()` (inferencia, no se midió el camino completo).

### 3. Fallas

34 mensajes entrantes: 30 con dos drenadores a la vez en un proceso, y 4 en procesos hijos que se mataron con `SIGKILL`. Cinco `wamid` llegaron dos veces. Nueve mensajes de los 30 tuvieron una falla inyectada en cuatro puntos, y los cuatro hijos murieron uno en cada punto.

| punto | dónde cae la falla | cómo |
| --- | --- | --- |
| p1 | después de reclamar el trabajo y guardar el mensaje, antes del modelo | error (f03), corte (f04), `SIGKILL` real |
| p2x | después del modelo, antes de guardar la respuesta en `salientes` | corte (f12) |
| p2 | después de guardar la respuesta, antes de reclamar la salida | error (f10), corte (f11), `SIGKILL` real |
| p3a | después de reclamar la salida, antes de enviar | error (f20), corte (f21), `SIGKILL` real |
| p3b | después de enviar, antes de marcar enviada | error (f25), corte (f26), `SIGKILL` real |

| medida | valor |
| --- | --- |
| mensajes entrantes | 34 |
| entregas repetidas de Kapso descartadas por `clave` (2 a la vez, 3 a los 4 s) | 5 de 5 |
| filas en `trabajos` y filas en `salientes` | 34 y 34 (una por mensaje) |
| trabajos terminados `hecho` | 34 de 34 |
| envíos reales duplicados (log del envío simulado) | 0 |
| Clientes con dos mensajes del agente guardados | 0 |
| trabajos reintentados (intentos mayor que 1) | 13, exactamente los 13 con falla inyectada |
| trabajos sin falla que necesitaron un segundo reclamo | 0 |
| reclamos totales (sin fallas serían 34) | 47 |
| máximo de intentos de un trabajo | 2 |
| salidas `enviada` | 28 |
| salidas `incierta` (reclamadas sin confirmación de envío) | 6 |
| de esas, el mensaje sí había salido (corte tras enviar, p3b) | 3 |
| de esas, el mensaje nunca salió (corte antes de enviar, p3a) | 3 |
| veces que el modelo corrió | 35: una por mensaje y una más por el corte p2x |
| mensajes cuyo modelo corrió dos veces | 1 (f12, cortado antes de guardar la respuesta). Con la respuesta ya guardada (p2, p3a, p3b) el reintento no volvió a llamarlo |
| trabajos atendidos por dos drenadores a la vez (en el proceso de los 30) | 0 |
| terminar que perdió su reclamo | 0 |

Son 24 afirmaciones con `afirmar` y ninguna falló (el script sale con 0). En el camino actual, la afirmación equivalente confirma el hueco: si el proceso muere después de guardar el `wamid`, la reentrega se descarta y el Cliente queda sin respuesta.

**Qué hace el diseño con las salidas `incierta`.** Una salida reclamada que no se confirma no se reenvía. Cuando su reclamo vence (6 s en esta prueba), el barredor la pasa de `enviando` a `incierta`, el trabajo se cierra `hecho` y la fila queda a la vista con su texto y el vencimiento de su reclamo. El script las lista. El estado esconde dos casos que desde la base no se distinguen: en 3 de las 6 el mensaje sí había salido y en 3 nunca salió, y eso solo se supo porque el arnés cuenta los envíos simulados. Reenviar a ciegas habría duplicado 3 mensajes; no reenviar dejó a 3 Clientes sin respuesta, pero visibles para un humano. Si una confirmación llega tarde (quien envió sí marca), la salida pasa de `incierta` a `enviada`.

**La corrida real no necesitó rondas del barredor.** La primera pasada duró 92 s, más que el reclamo de 30 s, y los dos drenadores en vuelo recogieron por la misma sentencia de reclamar todo lo vencido. Las rondas separadas del barredor (esperar el vencimiento, declarar `incierta`, volver a drenar) se ejercitaron en las corridas del arnés con el modelo simulado en la capa HTTP, que no gastan llamadas al modelo: 3 rondas en la primera corrida y 5 en la última, con las mismas 24 afirmaciones en verde.

**Las afirmaciones pueden fallar.** Con el modelo simulado se sabotearon dos cosas. Sin `FOR UPDATE SKIP LOCKED` fallaron 6 afirmaciones (reclamos dobles, solapamiento de drenadores, la cerca de `terminar`). Con el reenvío a ciegas de lo `enviando` fallaron 4 (envíos duplicados, mensajes del agente repetidos, inciertas distintas de lo esperado). Aun sin `SKIP LOCKED` no hubo envíos duplicados, porque la salida se reclama aparte con `WHERE estado = 'pendiente'`: el reclamo de la salida protege al Cliente aunque el de la cola falle.

### 4. Red

| medida | p50 | p90 | p95 | mín |
| --- | --- | --- | --- | --- |
| `select 1` por el driver HTTP de Neon, antes de todo (30) | 85,9 | 161 | 162 | 82,6 |
| `select 1`, al terminar (30) | 85,3 | 159 | 160 | 82,1 |
| TCP connect al mismo host, antes (30) | 88,5 | 156 | 157 | 81,6 |
| TCP connect, al terminar (30) | 90,2 | 156 | 158 | 81,7 |

La ida y vuelta de una consulta trivial es de unos 85 ms (p50 de 60 repeticiones, 85,7) y es casi toda red: el TCP connect tarda lo mismo (89,5) y la diferencia de mínimos es 0,4 ms, así que el proxy y el cómputo de Neon no se distinguen de la red desde aquí. Hay ráfagas de jitter en las que la consulta tarda 160 ms.

### Estimación desde Vercel `iad1`

Es una estimación, no una medición. Una sentencia desde `iad1` costaría la ida y vuelta dentro de la región (supuesto: 1 a 2 ms) más el trabajo de Neon. El trabajo de Neon se infiere de comparar el mínimo de las escrituras con el de `select 1` en la misma máquina: entre 1 ms (corrida de latencia: 82,6 a 83,6 contra 82,6) y 6 ms (corrida aislada: 88 a 89 contra 82,6).

| qué | desde Colombia (medido, p50) | desde `iad1` (estimado) |
| --- | --- | --- |
| una sentencia | 85 | 2 a 8 |
| las 4 sentencias que el Cliente espera | 357 | 8 a 32 |
| las 6 sentencias | 535 | 12 a 48 |
| base de datos del turno actual (14 peticiones) | 1111 | 28 a 112 |

Con eso, el sobrecosto de la cola antes de responder sería del orden de 0,2 a 0,8 % de un turno de 4,2 s, y la base de datos pasaría de 26 % a menos de 3 % del turno. Lo que queda es el modelo, sea cual sea su tiempo desde `iad1`, que no se midió.

## Qué limita los números

- **Cada sentencia cuesta una ida y vuelta de red.** 85 ms es la ida y vuelta a `us-east-1`. Los turnos pasan 12 ms en CPU propia (columna "otro") y el resto esperando red. Por eso las 14 peticiones del turno actual suman 1,1 s y las 5 de más (3 antes de responder y 2 después) suman unos 0,4 s. No es CPU ni es Postgres.
- **El modelo es lo que más varía.** El tiempo de modelo de un turno va de 1,7 a 7,7 s. Por eso el emparejamiento por pares no separa 350 ms de sobrecosto de la variación entre dos llamadas, y por eso las sentencias se cronometran una a una.
- **Ningún turno fue una disculpa.** Después de cada turno se comprobó que el Cliente tenía una sola respuesta que no es la disculpa técnica ni el texto de respaldo, que salió un solo envío simulado, y que no hubo ningún `console.error` (`recibirMensaje` se traga los fallos y manda una disculpa, así que un modelo caído se vería como un envío normal).
- **El orden alterna.** En cada par corre primero la línea base o primero la cola, para que la deriva del modelo y de la red no favorezca a un lado. Un turno de calentamiento por lado no cuenta.
- **Carga de la máquina.** Promedio de carga 4,4 en 10 núcleos durante las pruebas. El trabajo es de espera en red, no de CPU.

## Lo que NO se midió

- **Vercel de verdad.** Ni `iad1`, ni Fluid, ni arranque en frío, ni el `after()` real, ni `maxDuration`, ni lo que pasa cuando Vercel corta una función. Los cortes se hicieron con `SIGKILL` a un proceso local, que deja la base en el mismo estado, pero no es lo mismo que el corte de Vercel. La estimación de `iad1` sale de aquí y de supuestos.
- **Kapso de verdad.** Ningún envío salió; no se probó cuánto tarda `enviarTexto`, ni qué responde Kapso ante un reintento, ni si se puede preguntar a Kapso qué mensajes salieron de un número (la forma de resolver una salida `incierta` sin reenviar). El envío a Kapso cuenta como 0 ms; lo que sí se midió del envío son las dos consultas de `enviarAlCliente`.
- **El modelo desde `iad1`** y el modelo Standard. Se usó el Contributor desde Colombia, con razonamiento `low`.
- **Carga.** Dos drenadores y 34 mensajes. No se probó la contención de `SKIP LOCKED` con decenas de drenadores, ni qué pasa cuando llegan cien mensajes a la vez, ni los límites del modelo por minuto.
- **Mensajes que escriben.** Todos los mensajes fueron preguntas informativas. Un reintento de un turno que llame a `crear_pedido` o `abrir_caso` después de morir a medias podría repetir esa escritura; el código actual tiene una guarda para pedidos pendientes iguales, que no se probó con la cola.
- **Lo que hoy no pasa por `recibirMensaje`.** El mensaje sin Negocio (`SIN_NEGOCIO`) deduplica en memoria y no deja fila con la que enlazar una salida; el trabajo de segundo plano de `abrir_caso` (`traerCasoAlDueno`) no es durable aquí.
- **Errores conocidos antes de enviar.** `enviarAlCliente` puede lanzar `fuera_de_ventana` antes de enviar. El prototipo no distingue ese error de uno incierto: dejaría la salida `enviando` y luego `incierta`. Un diseño real lo marcaría como no enviada.
- **Reclamos largos.** El reclamo fue de 30 s y el turno más lento de 9,2 s. En producción el reclamo tiene que superar el peor turno; si no, un drenador lento y uno nuevo atenderían el mismo trabajo (la salida única los protege, pero el modelo correría dos veces).
- **El Agente del dueño y el aislamiento entre Negocios.** Eso lo deciden #15 y #12. Esta medición solo muestra que un trabajo y una salida cuestan seis escrituras; no dice dónde viven los datos de cada Negocio.
- **Estadística.** Veinte pares en una sola máquina y una sola conexión. Es suficiente para el orden de magnitud y no para distinguir sobrecostos de menos de 100 ms.

El gasto de llamadas al modelo fue de 86 peticiones (4 de humo, 45 en la latencia y 37 en las fallas, contando las de los hijos), dentro del tope de unas 100.

## Cómo repetirlo

```sh
neonctl branches create --project-id "$NEON_PROJECT_ID" --name medir-turno-durable --parent main
# .env.local con DATABASE_URL, DATABASE_URL_UNPOOLED y PG* de esa rama, MEDIR_HOST_ESPERADO=<endpoint de la rama>,
# ENVIO_SIMULADO=1, sin llaves de Kapso ni NEON_AUTH_*
pnpm tsx scripts/medir-turno-durable.mts --fase=red
pnpm tsx scripts/medir-turno-durable.mts --fase=micro
MEDIR_TOPE_MODELO=48 pnpm tsx scripts/medir-turno-durable.mts --fase=latencia
MEDIR_TOPE_MODELO=40 pnpm tsx scripts/medir-turno-durable.mts --fase=fallas
MEDIR_SIN_MODELO=1 pnpm tsx scripts/medir-turno-durable.mts --fase=fallas   # el arnés sin gastar llamadas
pnpm tsc --noEmit
neonctl branches delete medir-turno-durable --project-id "$NEON_PROJECT_ID"
```

El script aborta si el host de `DATABASE_URL` no es el de `MEDIR_HOST_ESPERADO`, y borra las filas de `trabajos` y `salientes` al empezar. Corre solo en una rama desechable.

Archivos: `scripts/medir-turno-durable.mts` (el arnés y el prototipo de la cola), `scripts/medir-turno-durable.sql` (las dos tablas) y este documento. `pnpm tsc --noEmit` sale con 0.

## Salida real

Es la salida de las cuatro corridas, sin las líneas con el texto de las respuestas del modelo ni las líneas `[envío simulado a …]`, y con las pasadas por pares abreviadas.

```text
$ pnpm tsx scripts/medir-turno-durable.mts --fase=red
Medición del turno durable · modelo muse-spark-1.3-contributor · rama desechable de Neon · corrida 5442
Reclamo del trabajo 30 s, reclamo de la salida 6 s, máximo de intentos 5. ENVIO_SIMULADO=1.
### Red (al empezar): host de la rama desechable, 30 repeticiones tras una de calentamiento
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| select 1 por el driver HTTP de Neon | 30 | 85.9 | 161 | 162 | 82.6 | 165 |
| TCP connect al puerto 443 (solo red) | 30 | 88.5 | 156 | 157 | 81.6 | 160 |
### Red (al terminar): host de la rama desechable, 30 repeticiones tras una de calentamiento
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| select 1 por el driver HTTP de Neon | 30 | 85.3 | 159 | 160 | 82.1 | 162 |
| TCP connect al puerto 443 (solo red) | 30 | 90.2 | 156 | 158 | 81.7 | 162 |
Lectura de la red (60 repeticiones, antes y después): la consulta trivial tarda 85.7 ms (p50) y un TCP connect al mismo host 89.5 ms (p50). Diferencia de p50: -3.9 ms. Diferencia de mínimos: 0.4 ms. El proxy y el cómputo de Neon no se distinguen de la red desde aquí.
Peticiones al modelo en este proceso: 0
0 casos, 0 fallaron.

$ pnpm tsx scripts/medir-turno-durable.mts --fase=micro
Medición del turno durable · modelo muse-spark-1.3-contributor · rama desechable de Neon · corrida 9987
Reclamo del trabajo 30 s, reclamo de la salida 6 s, máximo de intentos 5. ENVIO_SIMULADO=1.
### Cada sentencia por separado, base en reposo (30 repeticiones, desde esta máquina)
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| encolar | 30 | 120 | 178 | 179 | 88.8 | 179 |
| encolar_duplicado | 30 | 127 | 175 | 177 | 87.9 | 180 |
| reclamar | 30 | 104 | 167 | 175 | 88.1 | 430 |
| terminar | 30 | 92.5 | 175 | 178 | 88.7 | 181 |
| encolar_reclamado | 30 | 117 | 172 | 179 | 89.2 | 517 |
| saliente_crear | 30 | 126 | 179 | 202 | 89.1 | 219 |
| saliente_reclamar | 30 | 125 | 166 | 178 | 89.0 | 179 |
| saliente_marcar | 30 | 125 | 169 | 177 | 87.9 | 178 |
| saliente_barrer | 1 | 89.7 | 89.7 | 89.7 | 89.7 | 89.7 |
Peticiones al modelo en este proceso: 0
0 casos, 0 fallaron.

$ MEDIR_TOPE_MODELO=48 pnpm tsx scripts/medir-turno-durable.mts --fase=latencia
  par 1/20: base 7334 ms · durable 7068 ms hasta la respuesta, 7237 ms hasta terminar
  par 2/20: base 3797 ms · durable 5169 ms hasta la respuesta, 5428 ms hasta terminar
  par 3/20: base 3403 ms · durable 4540 ms hasta la respuesta, 4707 ms hasta terminar
  …
  par 20/20: base 4633 ms · durable 5325 ms hasta la respuesta, 5514 ms hasta terminar
Medición del turno durable · modelo muse-spark-1.3-contributor · rama desechable de Neon · corrida 9725
Reclamo del trabajo 30 s, reclamo de la salida 6 s, máximo de intentos 5. ENVIO_SIMULADO=1.
Calentamiento de cada lado (no cuenta)…
  ✓ latencia: cada turno dejó una fila en `turnos`
  ✓ latencia: cada Cliente recibió una sola respuesta, que no es una disculpa, y salió un solo envío simulado
  ✓ latencia: ningún `console.error` durante los turnos (recibirMensaje se traga los fallos)
### 1. Línea base: `recibirMensaje` tal cual (20 turnos, modelo muse-spark-1.3-contributor)
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| desde que entra hasta la fila de respuesta | 20 | 4197 | 6240 | 7427 | 2710 | 9184 |
|   de eso, modelo (peticiones a api.meta.ai) | 20 | 3119 | 4938 | 6014 | 1675 | 7692 |
|   de eso, base de datos (peticiones a Neon) | 20 | 1111 | 1288 | 1393 | 1023 | 1478 |
|   de eso, otro (CPU, armado del prompt, esperas) | 20 | 12.3 | 14.2 | 15.7 | 9.2 | 19.1 |
| `turnos.ms` (modelo + lecturas del turno) | 20 | 3411 | 5231 | 6450 | 1932 | 8124 |
| peticiones a Neon por turno (cuenta) | 20 | 14.0 | 14.1 | 15.0 | 14.0 | 15.0 |
| peticiones al modelo por turno (cuenta) | 20 | 1.0 | 1.1 | 2.0 | 1.0 | 2.0 |
### 2. Camino durable: los mismos 20 turnos por `trabajos` y `salientes`
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| de punta a punta, hasta la fila de respuesta | 20 | 4543 | 7166 | 8068 | 3319 | 8388 |
| de punta a punta, hasta terminar el trabajo | 20 | 4716 | 7335 | 8237 | 3490 | 8568 |
|   hasta la respuesta, de eso modelo | 20 | 3157 | 5522 | 6566 | 1969 | 6590 |
|   hasta la respuesta, de eso base de datos | 20 | 1386 | 1653 | 1695 | 1302 | 1788 |
| `turnos.ms` (modelo + lecturas del turno) | 20 | 3471 | 5805 | 6936 | 2228 | 6973 |
| peticiones a Neon por turno, hasta terminar (cuenta) | 20 | 19.0 | 19.0 | 19.1 | 19.0 | 20.0 |
| encolar | 20 | 85.3 | 165 | 167 | 82.8 | 173 |
| reclamar | 20 | 85.7 | 103 | 104 | 83.6 | 106 |
| terminar | 20 | 84.3 | 96.1 | 99.3 | 82.6 | 105 |
| sobrecosto de la cola: encolar + reclamar + terminar | 20 | 270 | 339 | 341 | 251 | 346 |
| salida: crear + reclamar + marcar enviada | 20 | 267 | 328 | 343 | 253 | 345 |
| sobrecosto total (cola + salida), 6 sentencias | 20 | 535 | 611 | 618 | 505 | 691 |
| sobrecosto que el Cliente espera (antes de responder, 4 sentencias) | 20 | 357 | 429 | 432 | 335 | 444 |
| diferencia emparejada: durable (hasta la respuesta) menos base | 20 | 360 | 2045 | 2305 | -1386.6 | 2687 |
Peticiones al modelo en esta fase: 45 (42 turnos).
Peticiones al modelo en este proceso: 45
3 casos, 0 fallaron.
exit 0

$ MEDIR_TOPE_MODELO=40 pnpm tsx scripts/medir-turno-durable.mts --fase=fallas
Medición del turno durable · modelo muse-spark-1.3-contributor · rama desechable de Neon · corrida 1218
Reclamo del trabajo 30 s, reclamo de la salida 6 s, máximo de intentos 5. ENVIO_SIMULADO=1.
### 3. Fallas
-- Camino actual: el proceso muere después de guardar el wamid y Kapso reentrega
  ✓ camino actual: la reentrega de un wamid ya reclamado se descarta y el Cliente queda sin respuesta (el hueco que cierra la cola)
-- Cortes reales: cuatro procesos hijos se matan con SIGKILL, uno en cada punto
  ✓ corte real en p1: el proceso murió por SIGKILL
  ✓ corte real en p2: el proceso murió por SIGKILL
  ✓ corte real en p3a: el proceso murió por SIGKILL
  ✓ corte real en p3b: el proceso murió por SIGKILL
  ✓ cortes reales: cada hijo reclamó un trabajo distinto antes de morir
Puntos de muerte por wamid: h0=p1 h2=p2 h1=p3a h3=p3b · peticiones al modelo de los hijos antes de morir: 3
-- 30 mensajes con dos drenadores a la vez, 5 wamid entregados dos veces y fallas inyectadas
Primera pasada en 91680 ms: [{"nombre":"A (after)","reclamos":22,"hechos":17,"fallas":2,"cortes":3,"diferidos":0,"perdidos":0},{"nombre":"B (cron)","reclamos":21,"hechos":17,"fallas":2,"cortes":2,"diferidos":0,"perdidos":0}]
(el barredor no tuvo nada que hacer)
Duración de la fase: 91941 ms.
  ✓ reentrega: las 5 entregas repetidas (2 a la vez, 3 tarde) fueron descartadas por `clave`
  ✓ reentrega: la cola tiene exactamente una fila por wamid
  ✓ todo trabajo terminó `hecho` (ninguno pendiente, en curso ni muerto)
  ✓ cada mensaje entrante tiene exactamente una respuesta (una fila en `salientes`)
  ✓ ningún wamid produjo dos envíos (envíos simulados por Cliente)
  ✓ ningún Cliente tiene dos mensajes del agente guardados
  ✓ no hay pérdida silenciosa: todo wamid sin envío real quedó `incierta` y visible
  ✓ toda salida `enviada` corresponde a exactamente un envío real
  ✓ las salidas inciertas son exactamente las reclamadas sin confirmar (cortes en 3a y 3b)
  ✓ después del barredor no quedan salidas `enviando` por declarar
  ✓ se reintentaron exactamente los 13 trabajos con falla inyectada
  ✓ los trabajos sin falla se atendieron en el primer reclamo
  ✓ el modelo corrió 35 veces: una por mensaje y una más por el corte antes de persistir la salida (p2x)
  ✓ en proceso, solo el corte antes de persistir la salida repitió el modelo; con la salida persistida el reintento no lo llama otra vez
  ✓ ningún trabajo fue atendido por dos drenadores a la vez
  ✓ ningún reclamo se repitió (cada trabajo e intento salió una sola vez)
  ✓ los dos drenadores trabajaron a la vez (los dos hicieron reclamos en la primera pasada)
  ✓ ningún `terminar` perdió su reclamo (la cerca por `intentos` no se activó)
Resultado de las fallas:
| medida | valor |
| --- | --- |
| mensajes entrantes (30 en proceso + 4 cortes reales) | 34 |
| entregas repetidas de Kapso descartadas por `clave` | 5 |
| trabajos reintentados (intentos > 1) | 13 |
| reclamos totales (sin fallas serían 34) | 47 |
| máximo de intentos de un trabajo | 2 |
| salidas `enviada` | 28 |
| salidas `incierta` (reclamadas sin confirmación de envío) | 6 |
|   de esas, el mensaje sí había salido (corte tras enviar, 3b) | 3 |
|   de esas, el mensaje nunca salió (corte antes de enviar, 3a) | 3 |
| envíos reales duplicados | 0 |
| turnos del modelo (filas en `turnos`) | 35 |
| peticiones al modelo de este proceso en la fase | 34 |
Salidas inciertas, visibles para quien las revise (el diseño no las reenvía):
| en respuesta a | estado | envíos reales | texto |
| --- | --- | --- | --- |
| wamid.MEDIR.1218.h3 | incierta | 1 | Hola, qué más. Por ahora solo recibimos  |
| wamid.MEDIR.1218.h1 | incierta | 0 | Hola, qué más ☕ Claro que sí, enviamos a |
| wamid.MEDIR.1218.f26 | incierta | 1 | Hola, qué bueno que escribiste ☕  El cla |
| wamid.MEDIR.1218.f25 | incierta | 1 | Hola! Qué bueno verte por aquí ☕  Tenemo |
| wamid.MEDIR.1218.f21 | incierta | 0 | Hola, qué bueno que escribiste ☕ Sí hace |
| wamid.MEDIR.1218.f20 | incierta | 0 | Hola, qué bueno verte por aquí ☕ Te cuen |
Peticiones al modelo en este proceso: 34
24 casos, 0 fallaron.
exit 0
```
