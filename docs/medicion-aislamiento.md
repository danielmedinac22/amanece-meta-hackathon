# Medición del aislamiento entre Negocios

Prototipo desechable para el ticket #12 (cómo se aíslan los Negocios entre sí). No es código de producción. Se midió el 29 de octubre de 2026 desde Colombia, contra una rama desechable de Neon en `us-east-1` creada sin datos (`--schema-only`) y con 10 Negocios inventados. No llama a ningún modelo ni a Kapso.

## La pregunta

El ticket #12 pregunta cómo se aíslan los Negocios entre sí en datos, despliegue y fallas, para que el Cambio de un Negocio, o un agente suyo que se descontrola, nunca afecte a los otros nueve. El diseño de #8 ya fijó un solo despliegue, una base compartida con `negocio_id` en toda tabla y las Secciones y los Indicadores como SQL acotado con RLS. #13 midió una cola en Postgres con un reclamo FIFO global. Falta saber si eso aguanta a un Negocio que se descontrola.

Se mide con código real contra Postgres, en tres partes.

1. **M1. Cola justa por Negocio.** Si el reclamo FIFO de #13 deja esperando a los otros Negocios cuando uno encola 1.000 trabajos de golpe, cuánto cuestan los reclamos justos por Negocio, qué índices piden y si el tope por Negocio se respeta bajo concurrencia.
2. **M2. Cupo atómico por Negocio.** Si una sola sentencia de reserva impide pasarse del tope con 500 reservas concurrentes por el driver HTTP, si el Negocio caliente frena a los demás y si devolver lo no usado deja el saldo cuadrado.
3. **M3. RLS más CTE bajo carga.** Si el ligado de #8 (rol `amanece_consultas`, `set_config('app.negocio_id')`, tope de 2 s, CTE con `WHERE negocio_id = $1`) filtra filas de otro Negocio bajo 500 lotes concurrentes, qué frena la base si el validador se saltara, si la política usa el índice y cuánto cuesta envolver una lectura simple del núcleo en ese lote, para saber si RLS en toda la app es viable.

## Conclusión

Las tres piezas aguantan en la rama de prueba: un reclamo justo por Negocio (cerrojo asesor, `SKIP LOCKED` y dos índices parciales) baja la espera de B y C detrás de una campaña de 1.000 trabajos de 96 a 195 s a menos de 0,5 s, por 0,4 a 1,0 ms más de servidor por reclamo; una sentencia `UPDATE … WHERE usado + n <= tope` no se pasó del tope ni una vez en 500 reservas a la vez (leer y después escribir se pasó entre 4.219 y 15.426 tokens según la corrida) y la fila del Negocio caliente no mueve el p50 de los otros nueve más allá del ruido; y el lote de #8 no filtró ni una fila de otro Negocio en 5.500 lotes concurrentes, con RLS sumando 1,7 ms a una lectura simple. Lo que no resuelven solas la base ni RLS es que lo que una petición fija sin `LOCAL` (`set_config(…, false)`, `SET ROLE`) sobrevive en las siguientes: el validador sigue siendo el anillo, y cada lote debe abrir con `RESET ALL` y `RESET ROLE`.

- **M1.** El FIFO global de #13 deja a B y C esperando 988 reclamos (195 s con 2 drenadores, 96 s con 4); los reclamos justos los atienden en 2 a 436 ms. El tope por Negocio solo se respeta con cerrojo: sin él, A llegó a 20 en curso de 24 reclamos a la vez con tope 2.
- **M2.** Cero tokens por encima del tope con 500 reservas a la vez, saldo exacto y devolución idempotente; leer y escribir se pasó y descuadró el saldo. La fila caliente movió el p50 de los demás entre -4 % y +44 % en tres corridas, que es el ruido entre corridas.
- **M3.** Cero filas de otro Negocio y totales iguales a la verdad; falla cerrado; la política usa el índice; RLS suma 1,7 ms en p50 a una lectura simple (0,6 ms de servidor, todo por tener más sentencias en el lote) y, con 50 lecturas a la vez en 1 CU, 77 ms (43 %).

## Cómo se midió

**Dónde.** Una rama desechable de Neon, creada desde `main` (compartida entre desarrollo y producción) con `neonctl branches create --schema-only`: trae el esquema de la app y ninguna fila, así que no hay datos de Clientes ni se leyó ni se mostró ninguno. Se borró al terminar. No se escribió nada en la base `main`. Región `aws-us-east-1`, Postgres 18, compute fijo de 1 CU (1 vCPU, 4 GB) y `max_connections` de 450. Los 10 Negocios son inventados (`AISL01` a `AISL10`), con Clientes, pedidos y mensajes generados por `generate_series`. El script aborta si el host de `DATABASE_URL` no es el de esa rama, si la base trae un Negocio que no es de los inventados, si hay llaves de Kapso o del modelo, o si las `NEON_AUTH_*` no van vacías. Reemplaza `fetch` para que lo único que salga de la máquina sea una petición a `*.neon.tech`. No llama a ningún modelo ni a Kapso y corre con `ENVIO_SIMULADO=1`. Máquina: Mac en Colombia, Node 26, driver `@neondatabase/serverless` por HTTP, el mismo de la app. Los milisegundos incluyen la ida y vuelta a `us-east-1`, que es de unos 75 a 83 ms (`select 1`, p50); se resta donde se dice.

**M1. La cola.** Una tabla `trabajos` con la forma de `scripts/medir-turno-durable.sql` más `negocio_id`, y una tabla `cola_negocios` con una fila por Negocio (cuándo se le atendió por última vez). Cinco reclamos, todos con `FOR UPDATE SKIP LOCKED`:

| reclamo | cómo elige |
| --- | --- |
| `fifo` | el de #13 tal cual: el trabajo más viejo de todos |
| `fifo+tope` | el mismo FIFO con el tope por Negocio contado en la misma sentencia (`count(*)` de los `en_curso` del Negocio), sin cerrojo. Es lo primero que se escribe |
| `rr` | round-robin: el Negocio que lleva más tiempo sin turno, y de él su trabajo más viejo |
| `tope` | tope duro de `en_curso` por Negocio; entre los que están bajo el tope, el que tiene menos en curso y, a igualdad, el que lleva más sin turno |
| `blando` | como `tope`, pero el tope solo vale mientras otro Negocio tiene trabajo pendiente; si no, el Negocio usa todos los drenadores |

Los tres justos (`rr`, `tope`, `blando`) viajan en un lote HTTP de dos sentencias: `select pg_advisory_xact_lock(7001)` y el reclamo. El cerrojo es necesario porque en `READ COMMITTED` cada sentencia toma su foto al empezar, así que contar `en_curso` dentro de la misma sentencia que espera un cerrojo vería un conteo viejo; en el lote, la segunda sentencia empieza cuando el cerrojo ya es suyo. Cada reclamo dura 30 s; terminar es el de #13 (`WHERE estado='en_curso' AND intentos=$2`). Cada trabajo simula 200 ms de turno. Los relojes de reclamo y de terminado son `clock_timestamp()` del servidor, y de ahí salen las esperas y el máximo de trabajos de un Negocio en curso a la vez (barrido de eventos: suma uno al reclamar y resta uno al terminar).

- *Escenario.* A encola 1.000 trabajos de golpe; 2 s después B y C encolan uno cada uno. Dos y cuatro drenadores. Con dos, el tope es 1; con cuatro, 2. La corrida sigue hasta que B y C estén `hecho` y hayan pasado 12 s. Se mide para B y C cuántos reclamos ocurrieron mientras esperaban y cuántos ms pasaron hasta su reclamo y hasta `hecho`.
- *Dobles reclamos.* Ocho drenadores sin espera sobre 200 trabajos de tres Negocios: ningún trabajo se reclama dos veces y los 200 terminan.
- *Carrera del tope.* Veinticuatro reclamos a la vez sobre A (100 pendientes, tope 2), cinco rondas: cuántos de A quedan en curso.
- *Lo que cuesta el tope.* A solo con 200 trabajos y cuatro drenadores, dos vueltas en orden inverso.
- *La sentencia.* Cuarenta reclamos seguidos (cada uno seguido de su `terminar`, sin cronometrar) con 0, 1.000 y 10.000 pendientes de A más 100 de B y 100 de C, y con 10.000 repartidos en los 10 Negocios. Cada reclamo viaja con un `clock_timestamp()` antes y otro después, así que se informa el tiempo por HTTP (restando el RTT) y el del servidor. Después, sin los dos índices por Negocio, y el `EXPLAIN (ANALYZE, BUFFERS)` por un `Pool` con `BEGIN … ROLLBACK`.

**M2. Los cupos.** Una tabla `cupos(negocio_id, recurso, ventana, tope, usado)` con clave primaria en las tres primeras y una `reservas` para el libro. La reserva es `UPDATE cupos SET usado = usado + $n WHERE … AND usado + $n <= tope RETURNING usado`: sin fila devuelta es que no cabe. La variante que crea la ventana en su primer uso es `INSERT … SELECT … WHERE $n <= tope ON CONFLICT DO UPDATE SET usado = usado + $n WHERE usado + $n <= tope`. Las variantes ingenuas leen `usado` y deciden en JS, y después suman `n` (*leer, decidir y sumar*) o escriben lo leído más `n` (*leer y escribir lo leído*).

- *Escenario.* Diez Negocios con tope de 3.000 tokens cada uno y 500 reservas de 20 a 120 tokens lanzadas a la vez: 266 del Negocio caliente y 26 de cada uno de los otros nueve (el caliente pide 10,2 veces más). La demanda de cada uno de los nueve (unos 1.800 tokens) cabe en el tope; la del caliente (unos 18.600) no.
- *¿El caliente frena a los demás?* Latencia de las reservas de los otros nueve en tres condiciones: sin el caliente (234 reservas), con el caliente repartido en 266 filas (500 reservas, la misma carga HTTP sin punto caliente) y con el caliente en una sola fila. La segunda condición separa el efecto de la fila caliente del de la carga de red y de servidor. Cinco rondas de cada una en orden rotado, a dos escalas (266 y 66 reservas del caliente) y con un sondeo de `pg_stat_activity` cada 30 ms para ver cuántas sesiones están activas y cuántas esperan un candado.
- *Devolver lo no usado.* Un Negocio con tope de 100.000: 150 turnos reservan 1.000 tokens a la vez; cada turno consume entre 100 y 900 y se liquida. La liquidación es una sola sentencia con CTE: marca la reserva `liquidada` solo si seguía `reservada` y devuelve `cantidad − consumido` a `cupos`, así que liquidar dos veces no devuelve dos veces.

**M3. RLS.** El rol `amanece_consultas` (`NOLOGIN NOBYPASSRLS`, `GRANT … WITH INHERIT FALSE, SET TRUE` a `neondb_owner`, `SELECT` por columna sin el texto de los mensajes ni la dirección) con una política `negocio_id = current_setting('app.negocio_id')::uuid` en `pedidos`, `clientes` y `mensajes_cliente`, como en `scripts/medir-sql/rol.sql` de la rama `medir/sql-acotado`. Un segundo rol, `amanece_nucleo`, con la misma política y `SELECT` completo, hace de la app con RLS en todas partes. Diez Negocios con 9.000 a 11.250 pedidos cada uno (101.250 en total), de 420 a 600 Clientes y 30 mensajes para 300 Clientes de cada Negocio. Cada Negocio se distingue por sus totales; la verdad (cuántas ventas, suma, los últimos 50 pedidos) se calcula antes con consultas del dueño de la base, que no pasan por RLS.

El lote es el de #8: `SET LOCAL ROLE`, `set_config('app.negocio_id', $1, true)`, `SET LOCAL statement_timeout = '2s'` y la consulta, con la CTE por fuente y el envoltorio `SELECT to_jsonb(q), count(*) OVER () … LIMIT 500`, en `transaction([...], { readOnly: true })`. Dos formas de consulta, alternadas: un agregado por ciudad (totales) y los últimos 50 pedidos (filas con su `negocio_id`).

- *Carga.* 500 lotes (50 por Negocio) en 10 ráfagas de 50 en paralelo, con los Negocios mezclados dentro de cada ráfaga. En cada respuesta se cuenta cuántas filas son de otro Negocio (fugas) y si los totales o la lista coinciden con la verdad. Con RLS y sin RLS (el mismo lote sin `SET LOCAL ROLE` ni `set_config`), cinco rondas de cada una, alternando cuál corre primero. Además, la CTE sin `WHERE` con RLS (el error de un generador) y, como mutación de control, la misma con la política en `true`.
- *Falla cerrado.* Un lote con el rol y sin `set_config`, con cadena vacía y con un valor que no es uuid, con la política estricta y con una tolerante (`current_setting(…, true)`); y cien lotes sin `set_config` mezclados con cien con él, para ver si una conexión reutilizada arrastra el Negocio anterior.
- *Qué frena la base sola.* Veinte intentos desde dentro del rol, sin `readOnly`, para que lo que frene una escritura sea el privilegio y no la transacción.
- *Estado de sesión.* Si lo que una petición fija sin `LOCAL` (la variable con `is_local = false`, `SET ROLE`) sobrevive en otra petición, y si abrir el lote con `RESET ALL` y `RESET ROLE` lo neutraliza.
- *EXPLAIN.* Tres planes dentro del lote, con el rol y el Negocio puestos.
- *Costo en una lectura simple.* Los últimos 20 mensajes de un Cliente, 150 repeticiones de cada forma en orden aleatorio: suelta (una petición con `WHERE negocio_id = $1`), lote sin RLS, lote con RLS con ese `WHERE`, lote con RLS solo con la política, lote con RLS precedido de `RESET ALL` y `RESET ROLE`, y un lote sin RLS con tres `select 1` de relleno para separar el costo de tener más sentencias del costo del rol y la política. Cada forma se mide por HTTP y con relojes de Postgres antes y después del lote. Después, 30 ráfagas de 50 lecturas a la vez de cuatro de las formas, en orden rotado.

**Afirmaciones y sabotajes.** Cada medición afirma con `afirmar` de `scripts/afirmar.mts` y el script sale con 1 si una falla. Cuatro sabotajes (`--sabotaje=`) rompen una pieza a propósito y la afirmación correspondiente tiene que fallar: el reclamo FIFO que lee y después escribe sin `SKIP LOCKED`, el reclamo con tope sin el cerrojo, la reserva atómica cambiada por leer y después escribir, y las políticas RLS en `true`. Además, la corrida normal lleva controles: el FIFO global tiene que dejar esperando a B y C, el tope ingenuo tiene que pasarse en la carrera, la reserva ingenua tiene que pasarse del tope y una mutación (CTE sin `WHERE` con la política en `true`) tiene que producir fugas.

## Resultados

Milisegundos desde Colombia, con un `select 1` de 75 a 83 ms (p50). M1, M2 y M3 son de la última corrida de cada una, con el script que se commitea. Con n de 150 a 2.500, el p95 es una interpolación entre los valores más altos.

### M1. Cola justa por Negocio

**1. A encola 1.000 trabajos de golpe; 2 s después B y C encolan uno cada uno.** «Reclamos» es cuántos reclamos de otros trabajos ocurrieron mientras el de B o el de C esperaba. «A hechos» es lo que A había terminado al parar: las corridas justas paran 12 s después de arrancar, y FIFO, cuando B y C terminan.

| reclamo | drenadores | tope | B: reclamos | B: ms hasta el reclamo | B: ms hasta hecho | C: reclamos | C: ms hasta el reclamo | C: ms hasta hecho | máx. de A en curso | A hechos | duración (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fifo` | 2 | - | **988** | **194.873** | 195.152 | **989** | **194.874** | 195.152 | 2 | 1000 | 198 |
| `fifo+tope` | 2 | 1 | 3 | 436 | 730 | 1 | 79,5 | 359 | **2** | 47 | 12,1 |
| `rr` | 2 | - | 1 | 373 | 651 | 0 | 371 | 651 | 2 | 60 | 12,1 |
| `tope` | 2 | 1 | 1 | 209 | 490 | 0 | 45,9 | 324 | 1 | 33 | 12,2 |
| `blando` | 2 | 1 (blando) | 1 | 358 | 723 | 0 | 2,0 | 280 | 2 | 62 | 12,5 |
| `fifo` | 4 | - | **978** | **95.693** | 95.993 | **977** | **95.386** | 95.667 | 4 | 1000 | 98,4 |
| `fifo+tope` | 4 | 2 | 1 | 46,1 | 367 | 0 | 44,0 | 367 | **4** | 78 | 12,1 |
| `rr` | 4 | - | 1 | 7,9 | 287 | 0 | 5,5 | 287 | 4 | 126 | 12,6 |
| `tope` | 4 | 2 | 1 | 6,2 | 289 | 0 | 4,0 | 288 | 2 | 73 | 12,9 |
| `blando` | 4 | 2 (blando) | 1 | 50,8 | 328 | 0 | 48,8 | 328 | 4 | 126 | 12,5 |

Con FIFO global, B y C esperan a que salga casi toda la campaña: 195 s con dos drenadores y 96 s con cuatro, con turnos de 200 ms. Con turnos de 4 s serían unos 33 y 17 minutos. Los tres reclamos justos y el ingenuo los atienden en el siguiente reclamo; la diferencia entre ellos (2 a 436 ms) es en qué punto de su ciclo de 370 ms estaba cada drenador. El tope ingenuo (`fifo+tope`) también los atiende, pero **se pasa del tope**: A llegó a 2 en curso con tope 1 y a 4 con tope 2. Ningún trabajo se reclamó dos veces en ninguna corrida.

**2. Dobles reclamos con ocho drenadores sin espera y 200 trabajos de tres Negocios.**

| reclamo | reclamos | trabajos reclamados dos veces | intentos > 1 | máx. de A en curso (tope 2) |
| --- | --- | --- | --- | --- |
| `fifo` | 200 | 0 | 0 | - |
| `fifo+tope` | 200 | 0 | 0 | - |
| `rr` | 200 | 0 | 0 | - |
| `tope` | 200 | 0 | 0 | 2 |
| `blando` | 200 | 0 | 0 | - |

**3. El tope bajo una carrera:** 24 reclamos a la vez sobre A (100 pendientes, tope 2), cinco rondas.

| reclamo | trabajos de A en curso tras cada ronda | máximo |
| --- | --- | --- |
| `fifo+tope` (sin cerrojo) | 8, 13, 20, 20, 20 | 20 |
| `tope` (con cerrojo) | 2, 2, 2, 2, 2 | 2 |

**4. Lo que cuesta el tope:** A solo con 200 trabajos y cuatro drenadores, turno de 200 ms (dos vueltas en orden inverso).

| reclamo | segundos para vaciar 200 (vuelta 1 / 2) | trabajos por segundo | máx. de A en curso |
| --- | --- | --- | --- |
| `fifo` | 22,2 / 19,8 | 9,0 / 10,1 | 4 |
| `rr` | 22,9 / 19,8 | 8,7 / 10,1 | 4 |
| `blando` | 19,8 / 19,9 | 10,1 / 10,0 | 4 |
| `tope` (duro, 2 de 4) | 38,5 / 39,1 | 5,2 / 5,1 | 2 |

El ideal con cuatro drenadores y 370 ms por ciclo es 18,5 s. El tope duro deja la mitad de los drenadores ociosos cuando A está solo: A drena a la mitad del ritmo.

**5. La sentencia de reclamo.** Cuarenta reclamos por fila, cada uno en un lote HTTP con reloj del servidor. «Servidor» es de la primera a la última sentencia del lote (incluye lo que tarda el proxy en mandar cada sentencia a Postgres, unos 0,2 ms por sentencia). «HTTP menos RTT» resta el `select 1` de la misma corrida.

| reclamo | pendientes | HTTP p50 (ms) | HTTP p95 | HTTP p50 menos RTT | servidor p50 (ms) | servidor p95 |
| --- | --- | --- | --- | --- | --- | --- |
| `fifo` | 0 | 78,6 | 131 | 1,5 | 0,8 | 1,0 |
| `fifo` | A 1.000 | 79,2 | 135 | 2,2 | 0,9 | 1,1 |
| `fifo` | A 10.000 | 79,2 | 139 | 2,2 | 0,8 | 1,2 |
| `fifo` | repartido 10.000 | 79,2 | 87,1 | 2,2 | 1,1 | 1,8 |
| `rr` | 0 | 78,4 | 133 | 1,3 | 1,2 | 1,5 |
| `rr` | A 1.000 | 79,5 | 149 | 2,4 | 1,4 | 1,9 |
| `rr` | A 10.000 | 79,6 | 82,8 | 2,5 | 1,9 | 2,1 |
| `rr` | repartido 10.000 | 79,3 | 88,1 | 2,3 | 1,5 | 1,7 |
| `tope` | 0 | 79,0 | 132 | 1,9 | 1,4 | 1,8 |
| `tope` | A 1.000 | 80,6 | 136 | 3,6 | 1,9 | 2,1 |
| `tope` | A 10.000 | 112 | 223 | 34,5 | 1,6 | 1,8 |
| `tope` | repartido 10.000 | 115 | 178 | 38,3 | 1,6 | 2,0 |
| `blando` | 0 | 117 | 144 | 40,1 | 1,3 | 1,5 |
| `blando` | A 1.000 | 80,0 | 132 | 3,0 | 1,5 | 1,7 |
| `blando` | A 10.000 | 80,3 | 137 | 3,2 | 1,5 | 1,6 |
| `blando` | repartido 10.000 | 79,5 | 83,6 | 2,5 | 1,6 | 1,7 |

(`fifo+tope`: servidor p50 de 0,8 a 0,9 ms en las cuatro filas.) Las tres filas con 34 a 40 ms de HTTP por encima del RTT tienen 1,3 a 1,6 ms de servidor: son picos de red, no del reclamo. «A 1.000 / 10.000» son 1.000 o 10.000 pendientes de A más 100 de B y 100 de C.

El reclamo justo cuesta de 0,4 a 1,0 ms más de servidor que el FIFO y **no crece con los pendientes**: de 0 a 10.000 se queda en 1,2 a 1,9 ms. `EXPLAIN (ANALYZE, BUFFERS)` con 10.000 pendientes de A, segunda ejecución: `fifo` 0,15 ms, `rr` 0,26, `tope` 0,28 y `blando` 0,26. El plan de los justos usa `Index Only Scan using trabajos_negocio_pendiente` para saber qué Negocios tienen trabajo, `Index Scan using trabajos_negocio_en_curso` para contar y `Index Scan using trabajos_negocio_pendiente` con `negocio_id = (InitPlan)` para tomar el trabajo más viejo del elegido.

**5b. Sin los dos índices por Negocio** (solo `trabajos_cola` de #13), con 10.000 pendientes de A y 100 de B y de C:

| reclamo | HTTP p50 (ms) | HTTP p95 | servidor p50 (ms) | servidor p95 | `EXPLAIN` (ms) |
| --- | --- | --- | --- | --- | --- |
| `rr` | 83,4 | 127 | 4,4 | 6,1 | 3,4 |
| `tope` | 85,9 | 141 | 7,8 | 8,5 | 6,7 |

Sin los índices el plan recorre en secuencial los 10.200 pendientes (`Seq Scan on trabajos p (actual rows=10199)`) y el costo ya es de 2 a 5 veces y **crece con el backlog**. Los dos índices que pide el reclamo justo son `(negocio_id, disponible_desde) WHERE estado = 'pendiente'` y `(negocio_id) WHERE estado = 'en_curso'`.

**Dos tropiezos en el camino, que dejan lección.** (1) La primera forma del reclamo justo juntaba los trabajos con el Negocio elegido por un `JOIN`, y el planificador recorría el índice FIFO descartando 10.000 filas de A para llegar a un trabajo de B (3,8 ms en el servidor con 10.000 repartidos, contra 1,9 ms con A solo). Se resolvió con `t.negocio_id = (select negocio_id from elegido)`, que usa el índice por Negocio. (2) La segunda forma llevaba el `EXISTS` de «tiene trabajo pendiente» en la lista de columnas; con 1.000 pendientes de A costaba 2,8 ms (`rr`) y 2,9 ms (`tope`) y con 10.000 pasó a 6,9 y 7,0 ms, porque el planificador cambió a un hash de todos los pendientes. Con el `EXISTS` en el `WHERE` (un semi-join por el índice) queda en 1,9 y 1,6 ms. Cualquiera de los dos cambios de plan se ve en un `EXPLAIN` con 10.000 pendientes y no con 1.000: la medición con un backlog chico los habría dejado pasar.

### M2. Cupo atómico por Negocio

**1. 500 reservas a la vez por el driver HTTP**, 266 del Negocio caliente y 26 de cada uno de los otros nueve, tope de 3.000 tokens por Negocio.

| reserva | Negocios por encima del tope | tokens por encima | saldo ≠ suma de lo concedido (tokens) | concedidas | denegadas | denegadas con sitio | p50 (ms) | p95 (ms) | las 500 en (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **atómica:** `UPDATE … WHERE usado + n <= tope` | **0** | **0** | **0** | 277 | 223 | 0 | 479 | 1.496 | 1.576 |
| ingenua: leer, decidir y sumar | 1 | **4.219** | 0 | 336 | 164 | 0 | 626 | 765 | 1.050 |
| ingenua: leer y escribir lo leído más n | 0 | 0 | **32.810** | 500 | 0 | 0 | 732 | 1.050 | 1.052 |

La atómica se pasó del tope 0 veces, el saldo final es exactamente la suma de lo concedido en cada Negocio, ninguna reserva que cupiera se negó («denegadas con sitio» es 0), y los nueve Negocios que pedían menos que su tope recibieron todo lo que pidieron. Leer, decidir y sumar dejó al caliente con 7.219 tokens usados contra un tope de 3.000 (4.219 de más; en otras tres corridas, 5.446, 11.689 y 15.426 de más). Leer y escribir lo leído concedió las 500 y dejó un saldo que no cuadra por 32.810 tokens (actualizaciones perdidas). Los p50 de esta tabla (479 a 732 ms) son de 500 peticiones simultáneas desde una máquina contra 1 CU, no de una reserva sola.

**2. ¿El Negocio caliente frena a los demás?** Latencia de las reservas de los otros nueve (26 cada uno), con la misma carga HTTP, con la fila caliente y sin ella. Cinco rondas por condición, en orden rotado (1.170 reservas por fila). «Pico» es el máximo que vio un sondeo de `pg_stat_activity` cada 30 ms durante las rondas.

| simultáneas | condición | p50 (ms) | p90 | p95 | máx | pico de sesiones activas | pico esperando un candado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 234 | sin el caliente | 355 | 495 | 511 | 525 | 29 | 18 |
| 500 | el caliente repartido en 266 filas (sin punto caliente) | 512 | 756 | 799 | 894 | 41 | 14 |
| 500 | el caliente en una sola fila | 491 | 709 | 768 | 920 | 11 | 3 |
| 234 | sin el caliente | 359 | 854 | 936 | 1.015 | 51 | 30 |
| 300 | el caliente repartido en 66 filas | 341 | 520 | 521 | 600 | 41 | 31 |
| 300 | el caliente en una sola fila (66 reservas) | 340 | 975 | 1.015 | 1.094 | 42 | 33 |

Pasar de 234 a 500 reservas simultáneas sube el p50 de los otros nueve de 355 a 512 ms: es la carga de red y de servidor, sin tocar la misma fila. Que el caliente use una sola fila no lo sube (491 contra 512 ms con 266 reservas del caliente; 340 contra 341 ms con 66). El p95 se mueve en las dos direcciones entre rondas (768 contra 799 ms con 266; 1.015 contra 521 ms con 66). En dos corridas anteriores con tres rondas, la fila caliente subió el p50 de los demás 4 % y 44 % (392 a 407 ms y 436 a 628 ms) y el p95, 10 % y 100 %. El efecto de la fila caliente sobre los demás es del orden del ruido entre corridas. Los sondeos no vieron más de 33 sesiones esperando un candado ni más de 51 activas, lejos de las 405 del pool (0,9 por `max_connections`): no hay indicio de que las 266 reservas de la fila caliente agoten las conexiones. Es inferencia, no medición: en producción las reservas de un Negocio salen de los drenadores, y el tope por Negocio de M1 limita cuántas pueden esperar a la vez la misma fila.

**3. Una reserva sola** (40 repeticiones, sin concurrencia; `select 1` de 81,1 ms):

| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| `UPDATE … WHERE` (atómica) | 40 | 82,1 | 113 | 115 | 80,1 | 120 |
| `INSERT … ON CONFLICT DO UPDATE … WHERE` (crea la ventana) | 40 | 81,7 | 118 | 119 | 80,0 | 166 |
| `UPDATE` con libro de reservas (CTE) | 40 | 81,9 | 116 | 118 | 80,4 | 120 |
| leer y después escribir (2 peticiones) | 40 | 163 | 200 | 201 | 161 | 202 |

La reserva atómica cuesta una ida y vuelta (1,0 ms sobre el `select 1`); la ingenua, dos.

**4. Las mismas 500 reservas con `INSERT … ON CONFLICT`** (la ventana no existe antes): 0 Negocios por encima del tope, saldo cuadrado, 277 concedidas y 223 denegadas, p50 de 404 ms y p95 de 1.446 ms. Una primera reserva más grande que el tope se niega.

**5. Reservar 1.000 tokens y devolver lo que sobró** (tope 100.000, 150 turnos a la vez):

| paso | valor |
| --- | --- |
| reservas de 1.000 concedidas de 150 | 100 |
| saldo tras la primera ola | 100.000 |
| tokens consumidos de verdad (suma de las 100) | 49.762 |
| saldo tras liquidar | 49.762 |
| liquidaciones repetidas que devolvieron algo (100 reintentos a la vez) | 0 |
| reservas concedidas en la segunda ola (cabían 49) | 49 |
| saldo final | 99.762 |

El saldo cuadra al token. Si el consumo real supera lo reservado no se devuelve nada (y el exceso no se cobra: es una decisión que falta). El saldo de `cupos` coincide con el libro de reservas.

### M3. RLS + CTE bajo carga

**1. El ligado.** El lote corre como `amanece_consultas`, sin `BYPASSRLS`, con `app.negocio_id` de A, tope de 2 s, y solo ve los 9.000 pedidos de A.

**2. Un lote sin `set_config` falla cerrado.**

| caso | resultado |
| --- | --- |
| política estricta (como #8): sin `set_config` | error: `invalid input syntax for type uuid: ""` |
| política estricta: `set_config` con cadena vacía | el mismo error |
| política estricta: `set_config` con un valor que no es uuid | error de uuid |
| política tolerante (`current_setting(…, true)`): sin `set_config` | 0 errores, 0 filas |
| 100 lotes con `set_config` de A mezclados con 100 sin él (conexiones reutilizadas) | los 100 sin él cerraron; los 100 con él vieron exactamente los 9.000 pedidos de A |

La política estricta falla con error (que se ve); la tolerante devuelve 0 filas (que se parece a «no hay datos»). El mensaje es `invalid input syntax …` porque la conexión ya había tenido la variable (queda en cadena vacía); en una conexión que nunca la tuvo, `current_setting` sin `missing_ok` da `unrecognized configuration parameter` (no se vio en esta corrida). Ninguno de los dos devuelve filas.

**3. Qué frena la base sola**, con el Negocio A puesto y sin `readOnly`:

| intento desde dentro del rol | resultado |
| --- | --- |
| leer una tabla sin permiso (`negocios`) | frenado (`permission denied`) |
| leer una columna no concedida (texto de los mensajes, dirección del pedido) | frenado |
| `update`, `delete`, `insert` | frenado |
| leer `pg_authid`, `pg_shadow`, `pg_read_file` | frenado |
| ver las consultas de otras sesiones (`pg_stat_activity.query`) | frenado (0 visibles) |
| pedir las filas o los Clientes de B con el Negocio A puesto | 0 filas |
| `pg_sleep(5)` y un producto cartesiano de pedidos | cancelados a los 2.080 ms por el tope de 2 s |
| `SET ROLE neon_superuser`, `SET ROLE cloud_admin` | frenado |
| listar los nombres de las tablas (`pg_class`) y de los roles (`pg_roles`) | **no se frena** (metadatos públicos) |
| `SET ROLE neondb_owner`, `SET ROLE amanece_nucleo` | **no se frena**: el dueño de la sesión es miembro de ambos |
| `select set_config('app.negocio_id', B, true)` dentro de un `SELECT` | **no se frena**: A ve los 9.250 pedidos de B (el hallazgo de #8) |

De los 20 intentos, 16 los frena la base. Los otros cuatro (metadatos de tablas y de roles, y `SET ROLE` a roles de los que el dueño de la sesión es miembro) y el `set_config` dentro del `SELECT` son un límite conocido: el validador de #8 es el único anillo contra ellos.

**3b. El estado de sesión sobrevive entre peticiones.** Es un hallazgo nuevo.

| qué se hizo | resultado |
| --- | --- |
| 120 peticiones sueltas fijan `app.negocio_id` = B con `is_local = false`; luego 120 lotes con `SET LOCAL ROLE` y sin `set_config` | **80 de 120** lotes vieron filas (B tiene 9.250 pedidos) |
| lo mismo, con `RESET ALL` y `RESET ROLE` como primeras sentencias del lote | 0 de 120 |
| 360 peticiones sueltas dejan la variable en cadena vacía; se repiten los lotes | 0 de 120 |
| 360 peticiones sueltas hacen `SET ROLE amanece_nucleo` sin `LOCAL`; luego 120 `select current_user` | 0 de 120 (con 120 peticiones en vez de 360, en otras dos corridas: 5 y 63 de 120) |
| 720 peticiones sueltas hacen `RESET ROLE`; se repite el `select current_user` | 0 de 120 |

El camino HTTP de Neon reutiliza las conexiones entre peticiones sin reiniciar la sesión: un `set_config(…, false)` o un `SET ROLE` sin `LOCAL` de una petición llega a las siguientes, de quien use esa conexión después. Con `SET LOCAL` y `set_config(…, true)`, que es lo que hace el lote de #8, no. Dos consecuencias: el validador tiene que prohibir `SET`, `RESET` y `set_config` (no solo `set_config` dentro del `SELECT`), y el lote debe abrir con `RESET ALL` y `RESET ROLE`, que cuesta 0,6 ms más de servidor y neutralizó el contagio en las 120 pruebas.

**4. ¿La política usa el índice?** Sí. `select count(*) from pedidos` con solo la política: `Index Only Scan using pedidos_negocio on pedidos`, `Index Cond: (negocio_id = (current_setting('app.negocio_id'))::uuid)`, 59 buffers y 1,3 ms. La consulta del Indicador con la política y la CTE a la vez: `Bitmap Index Scan on pedidos_negocio` y `clientes_negocio_telefono`, con un `One-Time Filter` que compara la variable con el `$1` de la CTE (si no coinciden, 0 filas sin leer nada), 5,9 ms por 6.000 filas. Los últimos 20 mensajes de un Cliente con solo la política: `Bitmap Index Scan on mensajes_cliente_cliente` (el índice es de `cliente_id`) y la política como `Filter` sobre las 30 filas del Cliente, 0,13 ms.

**5. 500 lotes concurrentes** (50 por Negocio, 10 ráfagas de 50 en paralelo con los Negocios mezclados):

| configuración | lotes | errores | filas de otro Negocio | totales ≠ verdad | p50 (ms) | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| con RLS + CTE (producción) | 2.500 | 0 | **0** | **0** | 599 | 825 | 899 | 97,5 | 1.351 |
| sin RLS, solo CTE | 2.500 | 0 | 0 | 0 | 554 | 816 | 900 | 98,6 | 1.281 |
| CTE sin `WHERE` + RLS (un error de la CTE) | 500 | 0 | **0** | **0** | 468 | 745 | 821 | 157 | 897 |
| CTE sin `WHERE` + política en `true` (mutación de control) | 500 | 10 | **13.170** | 490 | 1.870 | 2.249 | 2.491 | 799 | 2.568 |

La mutación de control confirma que la prueba de fugas puede fallar: con la política en `true`, 490 de 500 lotes dan totales distintos de la verdad y 13.170 filas son de otro Negocio. Los 10 errores aparecen solo en esta configuración, donde cada lote recorre los 101.250 pedidos.

Con RLS contra sin RLS, p50 por ronda de 500 lotes (el orden alterna):

| ronda | primero corrió | con RLS p50 | sin RLS p50 | diferencia | con RLS p95 | sin RLS p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | con RLS | 599 | 526 | +73 | 969 | 762 |
| 2 | sin RLS | 601 | 672 | -71 | 897 | 1.205 |
| 3 | con RLS | 595 | 539 | +55 | 1.275 | 788 |
| 4 | sin RLS | 605 | 598 | +7 | 900 | 1.204 |
| 5 | con RLS | 596 | 525 | +71 | 893 | 826 |

Junto, RLS suma 45 ms al p50 (8 %) y 1 ms menos al p95. Por ronda va de -71 a +73 ms, así que el efecto es del orden del ruido de la medición. Otras tres corridas con dos rondas dieron +89, +18 y +188 ms en p50.

**6. Una lectura simple del núcleo: los últimos 20 mensajes de un Cliente** (150 repeticiones por forma en orden aleatorio).

| forma | HTTP p50 (ms) | HTTP p95 | servidor p50 (ms) | servidor p95 |
| --- | --- | --- | --- | --- |
| suelta: una petición con `WHERE negocio_id = $1` | 76,3 | 137 | 0,9 | 1,3 |
| lote sin RLS (transacción de solo lectura con tope) | 77,6 | 138 | 1,2 | 1,5 |
| lote con RLS: rol + variable + tope + `WHERE negocio_id = $1` | 78,1 | 138 | 1,8 | 2,3 |
| lote con RLS, solo la política (sin `negocio_id` en el `WHERE`) | 78,3 | 138 | 1,8 | 2,1 |
| lote con RLS precedido de `RESET ALL` y `RESET ROLE` | 78,6 | 138 | 2,4 | 3,1 |
| lote sin RLS con tres `select 1` de relleno | 78,0 | 139 | 1,8 | 2,4 |

Envolver la lectura en el lote con RLS suma 1,7 ms en p50 por HTTP (2,2 %) y 0,9 ms de servidor sobre la suelta. De esos 0,9 ms, 0,3 son la transacción y 0,6 las tres sentencias más del lote; el rol, la variable y la política suman 0,0 ms (el lote con tres `select 1` de relleno cuesta lo mismo, 1,8 ms). Quitar el `negocio_id` del `WHERE` y dejar solo la política cuesta lo mismo.

Con 50 lecturas a la vez en 1 CU (30 ráfagas por forma, orden rotado):

| forma | n | p50 (ms) | p90 | p95 | mediana de las medianas por ráfaga | mejor ráfaga | peor ráfaga |
| --- | --- | --- | --- | --- | --- | --- | --- |
| suelta | 1.500 | 178 | 374 | 518 | 170 | 163 | 711 |
| lote sin RLS | 1.500 | 213 | 374 | 468 | 211 | 174 | 725 |
| lote con RLS | 1.500 | 255 | 434 | 652 | 254 | 178 | 951 |
| lote con RLS y `RESET ALL`, `RESET ROLE` | 1.500 | 257 | 376 | 451 | 245 | 184 | 864 |

Con 50 lecturas simultáneas, el lote con RLS cuesta 77 ms más que la suelta en p50 (43 %); 35 ms son del lote mismo y el resto, de las sentencias del prólogo. Es la cola en un compute de 1 vCPU que recibe 50 transacciones de 4 sentencias a la vez: a cada una le toca esperar a las demás. No se midió si con más CU baja.

### Los sabotajes

Cada uno rompe una pieza con `--sabotaje=` y corre solo las secciones que la ejercitan. El script sale con 1 en los cuatro.

| sabotaje | qué rompe | afirmaciones que fallan | lo que se vio |
| --- | --- | --- | --- |
| `reclamo-en-dos-pasos` | el reclamo FIFO lee el id y después lo escribe, sin `SKIP LOCKED` ni guarda de estado | 1 de 7 (dobles reclamos) | 975 reclamos repetidos y 189 trabajos con `intentos > 1` entre 200, con 8 drenadores |
| `sin-cerrojo` | el reclamo con tope sin `pg_advisory_xact_lock` | 3 de 11 (el tope en el escenario, con 8 drenadores y en la carrera) | A llegó a 4 en curso con tope 2 |
| `cupo-ingenuo` | la reserva atómica se cambia por leer, decidir y sumar | 1 de 19 (ningún Negocio por encima del tope) | un Negocio terminó 15.426 tokens por encima de 3.000 |
| `politica-true` | las políticas RLS de `pedidos` y `clientes` en `true` | 10 de 38 (ligado, falla cerrado, ataques que piden filas de B, `RESET ALL`, anillo) | los lotes ven los 101.250 pedidos de los 10 Negocios |

Con la política en `true` y la CTE con `WHERE` (producción), «0 fugas» sigue pasando: la CTE es el primer anillo y RLS el segundo. Lo que lo delata es la configuración «CTE sin `WHERE`».

## Qué decide cada resultado

| resultado | decide | no decide |
| --- | --- | --- |
| M1: FIFO global deja a B y C esperando 988 reclamos | El reclamo de #13 no se usa tal cual con más de un Negocio: el reclamo es por Negocio. | Cuántos drenadores corren ni de dónde (#5). |
| M1: cerrojo asesor en el mismo lote que el reclamo | El tope por Negocio solo se respeta con cerrojo (un contador en una fila que se bloquea sería la alternativa; no se midió). Sin cerrojo, A llegó a 20 en curso con tope 2. | Que el cerrojo sea el mecanismo definitivo: serializa los reclamos justos (1 a 2 ms de servidor cada uno), sobrado para 10 Negocios, no para miles. |
| M1: costo de 0,4 a 1,0 ms más y constante de 0 a 10.000 pendientes, con dos índices parciales | Los dos índices por Negocio entran con la cola; sin ellos el costo crece con el backlog. | La forma de la sentencia sirve para otras colas: los dos tropiezos de plan muestran que hay que mirar el `EXPLAIN` con un backlog grande. |
| M1: tope duro deja a A solo a la mitad de ritmo; blando no | Entre tope duro (capacidad reservada para los demás) y blando (A usa todo hasta que aparece otro Negocio): con turnos de 200 ms no se distinguen (B espera de 2 a 436 ms con ambos). Por construcción (no se midió con turnos de 4 s), con turnos de 4 s el blando hace esperar a B hasta un turno y el duro no. Si se quiere que un Negocio descontrolado nunca ocupe todos los drenadores, es el duro; si se quiere no desperdiciar capacidad, el blando. | Cuál de los dos conviene: depende del turno real y de cuánto cuesta un drenador ocioso. |
| M2: `UPDATE … WHERE usado + n <= tope` no se pasó con 500 reservas a la vez, devolución idempotente | El cupo vive en una fila de Postgres por (Negocio, recurso, ventana) y se reserva con una sentencia; se reserva el estimado antes del turno y se liquida con lo real después. No hace falta Redis ni cerrojo. Una reserva cuesta una ida y vuelta. | Cuánto vale cada recurso ni qué tope tiene cada Negocio (#16). Qué pasa cuando el consumo real supera lo reservado (hoy no se cobra el exceso). |
| M2: la fila caliente mueve el p50 de los demás entre -4 % y +44 % | No hay evidencia de que un Negocio caliente frene a los demás por contención de fila a 266 reservas simultáneas. | Qué pasa con una fila caliente de miles de reservas por segundo, ni con más reservas simultáneas que conexiones del pool (no se midió). |
| M3: 0 fugas y totales iguales en 5.500 lotes, falla cerrado | El ligado de #8 (rol, `set_config` local, tope, CTE) no filtra bajo concurrencia. La CTE sola ya liga bien; RLS es el segundo anillo y cubre el error de una CTE sin `WHERE`. | Que RLS frene un SQL malicioso: un `set_config` dentro del `SELECT` cambia de Negocio. |
| M3: el estado de sesión sobrevive entre peticiones | El validador prohíbe `SET`, `RESET` y `set_config` enteros, y cada lote abre con `RESET ALL` y `RESET ROLE`. Es el segundo anillo que sí se puede poner. | Un valor de Negocio que el SQL no pueda falsificar (un token firmado que la política verifique): no se probó. |
| M3: RLS cuesta 1,7 ms por HTTP en una lectura simple y 0,0 ms por la política | RLS en toda la app no es inviable por latencia de lectura: lo que cuesta es tener más sentencias en el lote, y el mismo costo lo pagaría cualquier lote. Si se decide RLS en toda la app, el costo de lectura no lo frena. | Escrituras (`WITH CHECK`), un rol de la app con login, el `Pool` por WebSocket, ni cuánto sube bajo mucha concurrencia con más de 1 CU. Con 50 lecturas a la vez en 1 CU, el lote con RLS suma 77 ms (43 %). |

## Qué limita los números

- **Cada sentencia cuesta una ida y vuelta.** Desde Colombia, 75 a 83 ms de ida y vuelta a `us-east-1` pesan más que casi cualquier sentencia: el reclamo cuesta 1 a 2 ms en el servidor y 78 a 80 ms por HTTP. Por eso se informa el tiempo del servidor aparte, con `clock_timestamp()` dentro del lote. Ese tiempo incluye lo que tarda el proxy en mandar cada sentencia a Postgres, que ronda 0,2 ms por sentencia del lote.
- **Un solo cliente y 1 CU.** Todas las ráfagas salen de un proceso y de una máquina, contra un compute de 1 vCPU. Las latencias de las ráfagas de 50 y de 500 (cientos de ms) son sobre todo cola en el servidor y en el cliente, no el costo de una sentencia: se comparan entre sí, no con una latencia en producción. Una prueba aparte (no incluida) mostró que 400 `pg_sleep(0,5)` simultáneos terminan en 1,1 s, así que el pool del proxy no limita a 500 peticiones.
- **Ruido entre corridas.** La comparación de 500 lotes con y sin RLS dio +89, +18, +188 y, con cinco rondas alternadas, +45 ms. Por eso las comparaciones de M3 alternan el orden y se informan por ronda. Con n de 150 a 2.500, el p95 es una interpolación entre los valores más altos, y un pico de red de 160 ms lo mueve.
- **El turno es de 200 ms.** Un turno real del Agente de clientes dura unos 4 s (#13). Con turnos de 4 s, lo que B espera cuando los drenadores están todos con A y no hay tope duro es de hasta un turno, no de 200 ms.
- **Datos sintéticos, pocos Negocios.** Diez Negocios, 100 mil pedidos. El reclamo justo recorre `cola_negocios` entera en cada reclamo; con diez filas no importa y con mil habría que cambiarlo.
- **Dos versiones del reclamo justo.** M1 se corrió dos veces porque la primera versión tenía el plan que cambiaba con el backlog (ver M1, dos tropiezos). Las cifras son de la segunda corrida completa, con la versión final.

## Lo que NO se midió

- **Vercel de verdad.** Ni `iad1`, ni Fluid, ni el `after()` real, ni cuántos drenadores corren a la vez en producción. La latencia desde `iad1` sería de 2 a 8 ms por sentencia, no de 80.
- **El modelo y Kapso.** Ningún turno real, ningún envío, ni el saldo compartido de Kapso ni las cuotas de Meta por portafolio. El cupo mide la forma de reservar, no cuánto vale cada recurso ni cuál es el tope de cada Negocio; eso lo decide #16.
- **Cuántos drenadores y qué tope.** Se midió con dos y cuatro drenadores y un tope de la mitad. No se midió la contención de `SKIP LOCKED` con decenas de drenadores ni el cerrojo con cientos de reclamos por segundo (el cerrojo serializa los reclamos justos; cada uno dura 1 a 2 ms en el servidor).
- **Un reclamo vencido.** El reclamo justo no recoge los `en_curso` con `reclamado_hasta` vencido, y el de #13 sí. Hace falta el barrido que los devuelve a `pendiente`; no se midió.
- **Escrituras bajo RLS.** Las políticas son de `SELECT`. RLS en toda la app también significa `INSERT` y `UPDATE` con `WITH CHECK`, un rol de la app con login (`neondb_owner` tiene `BYPASSRLS`) y transacciones por WebSocket (`Pool`) para `aprobar`. No se midió. La medición de la lectura simple dice cuánto cuesta leer.
- **Un valor de Negocio que el SQL no pueda falsificar.** `set_config('app.negocio_id')` dentro de un `SELECT` cambia de Negocio (se confirmó otra vez). No se probó un token firmado que la política verifique, ni un rol con login propio por Negocio, ni `FORCE ROW LEVEL SECURITY`.
- **El `RESET ALL` con otras fuentes de contagio.** Se probó contra `set_config(…, false)` y `SET ROLE`; no contra otros parámetros de sesión ni contra sentencias preparadas.
- **Retención y supresión, logs de Vercel, Meta Model API.** Eso es de las otras dos preguntas del ticket (#12 tiene tres) y no es de esta medición.
- **Carga larga.** Todo duró minutos. No se midió el sangrado de la tabla `trabajos` (`VACUUM`, índices parciales con millones de filas `hecho`) ni el tamaño de `cupos` y `reservas` en un año.
- **Más de un compute.** La rama tiene un solo compute de 1 CU fijo; no se midió autoescala ni réplicas de lectura.

## Cómo repetirlo

```sh
neonctl branches create --project-id "$NEON_PROJECT_ID" --name medir-aislamiento --parent main --schema-only
# .env.local con DATABASE_URL (pooled) y DATABASE_URL_UNPOOLED de esa rama, MEDIR_HOST_ESPERADO=<endpoint de la rama>,
# ENVIO_SIMULADO=1, NEON_AUTH_BASE_URL y NEON_AUTH_COOKIE_SECRET vacías, sin llaves de Kapso ni del modelo
pnpm tsx scripts/medir-aislamiento.mts --fase=todo        # unos 50 min; los procesos no se corren en paralelo
pnpm tsx scripts/medir-aislamiento.mts --fase=m1 --m1=2,3 # solo dobles reclamos y carrera del tope
pnpm tsx scripts/medir-aislamiento.mts --fase=m1 --m1=1 --solo=tope:4,blando:4
pnpm tsx scripts/medir-aislamiento.mts --fase=m2
pnpm tsx scripts/medir-aislamiento.mts --fase=m3
pnpm tsx scripts/medir-aislamiento.mts --fase=m3 --sabotaje=politica-true   # tiene que salir con 1
neonctl branches delete medir-aislamiento --project-id "$NEON_PROJECT_ID"
```

El script aplica `scripts/medir-aislamiento.sql` al empezar (idempotente). Solo corre en una rama desechable: aborta si el host no es el de `MEDIR_HOST_ESPERADO`. Los cuatro sabotajes salen con 1 (ver «Los sabotajes» en los resultados). Una `--fase` desconocida sale con 2.

Archivos: `scripts/medir-aislamiento.mts` (el arnés y los prototipos de la cola, el cupo y el ligado), `scripts/medir-aislamiento.sql` (tablas, roles y políticas) y este documento.

## Salida real

Es la salida de tres corridas (M1, M2 y M3), sin los planes de `EXPLAIN` completos ni las líneas de siembra.

```text
$ pnpm tsx scripts/medir-aislamiento.mts --fase=m1
Medición del aislamiento · rama desechable de Neon · ENVIO_SIMULADO=1 · fase m1
Sin modelo y sin Kapso: el único destino de red permitido es Neon.
### Red (al empezar): select 1 por el driver HTTP de Neon, 30 repeticiones tras una de calentamiento
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| select 1 por el driver HTTP | 30 | 77.0 | 138 | 139 | 75.9 | 373 |
## M1. Cola justa por Negocio
-- FIFO global (el reclamo de #13) · 2 drenadores · turno de 200 ms
   listo en 198 s: B esperó 988 reclamos y 194873 ms; C 989 y 194874 ms; máximo de A en curso 2
-- FIFO global + tope por Negocio contado en la misma sentencia, sin cerrojo (ingenuo) · 2 drenadores · turno de 200 ms
   listo en 12.1 s: B esperó 3 reclamos y 436 ms; C 1 y 79.5 ms; máximo de A en curso 2
-- round-robin por Negocio (el que lleva más tiempo sin turno), SKIP LOCKED, cerrojo · 2 drenadores · turno de 200 ms
   listo en 12.1 s: B esperó 1 reclamos y 373 ms; C 0 y 371 ms; máximo de A en curso 2
-- tope duro de en_curso por Negocio + el que tiene menos en curso, SKIP LOCKED, cerrojo · 2 drenadores · turno de 200 ms
   listo en 12.2 s: B esperó 1 reclamos y 209 ms; C 0 y 45.9 ms; máximo de A en curso 1
-- tope blando: el tope solo vale mientras otro Negocio tiene trabajo; si no, usa todo (SKIP LOCKED, cerrojo) · 2 drenadores · turno de 200 ms
   listo en 12.5 s: B esperó 1 reclamos y 358 ms; C 0 y 2.0 ms; máximo de A en curso 2
-- FIFO global (el reclamo de #13) · 4 drenadores · turno de 200 ms
   listo en 98.4 s: B esperó 978 reclamos y 95693 ms; C 977 y 95386 ms; máximo de A en curso 4
-- FIFO global + tope por Negocio contado en la misma sentencia, sin cerrojo (ingenuo) · 4 drenadores · turno de 200 ms
   listo en 12.1 s: B esperó 1 reclamos y 46.1 ms; C 0 y 44.0 ms; máximo de A en curso 4
-- round-robin por Negocio (el que lleva más tiempo sin turno), SKIP LOCKED, cerrojo · 4 drenadores · turno de 200 ms
   listo en 12.6 s: B esperó 1 reclamos y 7.9 ms; C 0 y 5.5 ms; máximo de A en curso 4
-- tope duro de en_curso por Negocio + el que tiene menos en curso, SKIP LOCKED, cerrojo · 4 drenadores · turno de 200 ms
   listo en 12.9 s: B esperó 1 reclamos y 6.2 ms; C 0 y 4.0 ms; máximo de A en curso 2
-- tope blando: el tope solo vale mientras otro Negocio tiene trabajo; si no, usa todo (SKIP LOCKED, cerrojo) · 4 drenadores · turno de 200 ms
   listo en 12.5 s: B esperó 1 reclamos y 50.8 ms; C 0 y 48.8 ms; máximo de A en curso 4
### 1. A encola 1.000 trabajos de golpe; 2 s después B y C encolan uno cada uno
| reclamo | drenadores | tope | B: reclamos que esperó | B: ms hasta el reclamo | B: ms hasta hecho | C: reclamos | C: ms hasta el reclamo | C: ms hasta hecho | A hechos | máx. de A en curso | dobles | duración (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fifo | 2 | - | 988 | 194873 | 195152 | 989 | 194874 | 195152 | 1000 | 2 | 0 | 198 |
| fifo+tope | 2 | 1 | 3 | 436 | 730 | 1 | 79.5 | 359 | 47 | 2 | 0 | 12.1 |
| rr | 2 | - | 1 | 373 | 651 | 0 | 371 | 651 | 60 | 2 | 0 | 12.1 |
| tope | 2 | 1 | 1 | 209 | 490 | 0 | 45.9 | 324 | 33 | 1 | 0 | 12.2 |
| blando | 2 | 1 (blando) | 1 | 358 | 723 | 0 | 2.0 | 280 | 62 | 2 | 0 | 12.5 |
| fifo | 4 | - | 978 | 95693 | 95993 | 977 | 95386 | 95667 | 1000 | 4 | 0 | 98.4 |
| fifo+tope | 4 | 2 | 1 | 46.1 | 367 | 0 | 44.0 | 367 | 78 | 4 | 0 | 12.1 |
| rr | 4 | - | 1 | 7.9 | 287 | 0 | 5.5 | 287 | 126 | 4 | 0 | 12.6 |
| tope | 4 | 2 | 1 | 6.2 | 289 | 0 | 4.0 | 288 | 73 | 2 | 0 | 12.9 |
| blando | 4 | 2 (blando) | 1 | 50.8 | 328 | 0 | 48.8 | 328 | 126 | 4 | 0 | 12.5 |
  ✓ M1 [fifo, 2 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [fifo, 2 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [fifo, 2 drenadores]: control: con FIFO global B y C esperan detrás de la campaña (más de 300 reclamos)
  ✓ M1 [fifo+tope, 2 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [fifo+tope, 2 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [fifo+tope, 2 drenadores]: B y C se atienden de inmediato (a lo sumo 4 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [rr, 2 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [rr, 2 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [rr, 2 drenadores]: B y C se atienden de inmediato (a lo sumo 4 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [tope, 2 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [tope, 2 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [tope, 2 drenadores]: B y C se atienden de inmediato (a lo sumo 4 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [tope, 2 drenadores]: el tope se respeta bajo concurrencia (A nunca más de 1 en curso; máximo visto 1)
  ✓ M1 [blando, 2 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [blando, 2 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [blando, 2 drenadores]: B y C se atienden de inmediato (a lo sumo 4 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [fifo, 4 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [fifo, 4 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [fifo, 4 drenadores]: control: con FIFO global B y C esperan detrás de la campaña (más de 300 reclamos)
  ✓ M1 [fifo+tope, 4 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [fifo+tope, 4 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [fifo+tope, 4 drenadores]: B y C se atienden de inmediato (a lo sumo 6 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [rr, 4 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [rr, 4 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [rr, 4 drenadores]: B y C se atienden de inmediato (a lo sumo 6 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [tope, 4 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [tope, 4 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [tope, 4 drenadores]: B y C se atienden de inmediato (a lo sumo 6 reclamos y menos de 1,5 s hasta el reclamo)
  ✓ M1 [tope, 4 drenadores]: el tope se respeta bajo concurrencia (A nunca más de 2 en curso; máximo visto 2)
  ✓ M1 [blando, 4 drenadores]: ningún trabajo reclamado dos veces (intentos > 1: 0, repetidos en la bitácora: 0)
  ✓ M1 [blando, 4 drenadores]: nada quedó en curso ni se perdió un `terminar`
  ✓ M1 [blando, 4 drenadores]: B y C se atienden de inmediato (a lo sumo 6 reclamos y menos de 1,5 s hasta el reclamo)
### 2. Dobles reclamos con mucha concurrencia: 8 drenadores sin espera, 200 trabajos de tres Negocios
  ✓ M1 dobles [fifo]: 200 trabajos, 8 drenadores, ningún trabajo reclamado dos veces (bitácora 200 reclamos)
  ✓ M1 dobles [fifo]: los 200 terminaron `hecho`
  ✓ M1 dobles [fifo+tope]: 200 trabajos, 8 drenadores, ningún trabajo reclamado dos veces (bitácora 200 reclamos)
  ✓ M1 dobles [fifo+tope]: los 200 terminaron `hecho`
  ✓ M1 dobles [rr]: 200 trabajos, 8 drenadores, ningún trabajo reclamado dos veces (bitácora 200 reclamos)
  ✓ M1 dobles [rr]: los 200 terminaron `hecho`
  ✓ M1 dobles [tope]: 200 trabajos, 8 drenadores, ningún trabajo reclamado dos veces (bitácora 200 reclamos)
  ✓ M1 dobles [tope]: los 200 terminaron `hecho`
  ✓ M1 dobles [blando]: 200 trabajos, 8 drenadores, ningún trabajo reclamado dos veces (bitácora 200 reclamos)
  ✓ M1 dobles [blando]: los 200 terminaron `hecho`
| reclamo | reclamos | trabajos reclamados dos veces | intentos > 1 | máx. de A en curso (tope 2) |
| --- | --- | --- | --- | --- |
| fifo | 200 | 0 | 0 | - |
| fifo+tope | 200 | 0 | 0 | - |
| rr | 200 | 0 | 0 | - |
| tope | 200 | 0 | 0 | 2 |
| blando | 200 | 0 | 0 | - |
  ✓ M1 dobles [tope]: con 8 drenadores A nunca pasa de 2 en curso
### 3. El tope bajo una carrera: 24 reclamos a la vez sobre A (100 pendientes, tope 2), cinco rondas
| reclamo | trabajos de A en curso tras cada ronda | máximo |
| --- | --- | --- |
| fifo+tope | 8, 13, 20, 20, 20 | 20 |
| tope | 2, 2, 2, 2, 2 | 2 |
  ✓ M1 carrera [tope]: con 24 reclamos a la vez A queda en exactamente 2 en curso en cada ronda
  ✓ M1 carrera: control: el tope ingenuo (sin cerrojo) SÍ se pasa de 2 al menos en una ronda
### 4. Lo que cuesta el tope: A solo con 200 trabajos y 4 drenadores (turno de 200 ms)
| reclamo | vuelta | segundos para vaciar 200 | trabajos por segundo | máx. de A en curso |
| --- | --- | --- | --- | --- |
| blando | 1 | 19.8 | 10.1 | 4 |
| blando | 2 | 19.9 | 10.0 | 4 |
| fifo | 1 | 22.2 | 9.0 | 4 |
| fifo | 2 | 19.8 | 10.1 | 4 |
| rr | 1 | 22.9 | 8.7 | 4 |
| rr | 2 | 19.8 | 10.1 | 4 |
| tope | 1 | 38.5 | 5.2 | 2 |
| tope | 2 | 39.1 | 5.1 | 2 |
### 5. Costo de la sentencia de reclamo con 0, 1.000 y 10.000 pendientes de A (más 100 de B y 100 de C), o repartidos en 10 Negocios (40 reclamos cada fila; cada uno, en un lote HTTP con reloj del servidor)
| reclamo | pendientes | reclamos con trabajo | HTTP p50 (ms) | HTTP p95 | HTTP p50 menos RTT | servidor p50 (ms) | servidor p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| fifo | vacío 0 | 0 | 78.6 | 131 | 1.5 | 0.8 | 1.0 |
| fifo | campaña 1000 | 43 | 79.2 | 135 | 2.2 | 0.9 | 1.1 |
| fifo | campaña 10000 | 43 | 79.2 | 139 | 2.2 | 0.8 | 1.2 |
| fifo | repartido 10000 | 43 | 79.2 | 87.1 | 2.2 | 1.1 | 1.8 |
| fifo+tope | vacío 0 | 0 | 78.2 | 134 | 1.2 | 0.8 | 0.9 |
| fifo+tope | campaña 1000 | 43 | 78.6 | 80.2 | 1.6 | 0.9 | 1.0 |
| fifo+tope | campaña 10000 | 43 | 78.6 | 82.6 | 1.5 | 0.9 | 1.2 |
| fifo+tope | repartido 10000 | 43 | 78.9 | 137 | 1.8 | 0.9 | 1.0 |
| rr | vacío 0 | 0 | 78.4 | 133 | 1.3 | 1.2 | 1.5 |
| rr | campaña 1000 | 43 | 79.5 | 149 | 2.4 | 1.4 | 1.9 |
| rr | campaña 10000 | 43 | 79.6 | 82.8 | 2.5 | 1.9 | 2.1 |
| rr | repartido 10000 | 43 | 79.3 | 88.1 | 2.3 | 1.5 | 1.7 |
| tope | vacío 0 | 0 | 79.0 | 132 | 1.9 | 1.4 | 1.8 |
| tope | campaña 1000 | 43 | 80.6 | 136 | 3.6 | 1.9 | 2.1 |
| tope | campaña 10000 | 43 | 112 | 223 | 34.5 | 1.6 | 1.8 |
| tope | repartido 10000 | 43 | 115 | 178 | 38.3 | 1.6 | 2.0 |
| blando | vacío 0 | 0 | 117 | 144 | 40.1 | 1.3 | 1.5 |
| blando | campaña 1000 | 43 | 80.0 | 132 | 3.0 | 1.5 | 1.7 |
| blando | campaña 10000 | 43 | 80.3 | 137 | 3.2 | 1.5 | 1.6 |
| blando | repartido 10000 | 43 | 79.5 | 83.6 | 2.5 | 1.6 | 1.7 |
### 5b. Sin los índices por Negocio (solo el índice FIFO de #13): 10.000 pendientes de A y 100 de B y de C
| reclamo | HTTP p50 (ms) | HTTP p95 | servidor p50 (ms) | servidor p95 |
| --- | --- | --- | --- | --- |
| rr | 83.4 | 127 | 4.4 | 6.1 |
| tope | 85.9 | 141 | 7.8 | 8.5 |
### 5c. EXPLAIN (ANALYZE, BUFFERS) del reclamo con 10.000 pendientes de A (y B y C con uno), con los índices
Peticiones HTTP a Neon en este proceso: 16275
45 casos, 0 fallaron.
exit 0

$ pnpm tsx scripts/medir-aislamiento.mts --fase=m2
Medición del aislamiento · rama desechable de Neon · ENVIO_SIMULADO=1 · fase m2
Sin modelo y sin Kapso: el único destino de red permitido es Neon.
### Red (al empezar): select 1 por el driver HTTP de Neon, 30 repeticiones tras una de calentamiento
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| select 1 por el driver HTTP | 30 | 81.1 | 117 | 120 | 79.3 | 121 |
## M2. Cupo atómico por Negocio
### 1. 500 reservas a la vez por el driver HTTP: 266 del Negocio caliente y 234 de los otros nueve (26 cada uno), tope de 3000 tokens por Negocio
| reserva | Negocios por encima del tope | tokens por encima | saldo ≠ suma de lo concedido (tokens) | concedidas | denegadas | denegadas con sitio | p50 (ms) | p95 (ms) | las 500 en (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| atómica: UPDATE … WHERE usado + n <= tope | 0 | 0 | 0 | 277 | 223 | 0 | 479 | 1496 | 1576 |
| ingenua: leer, decidir y sumar | 1 | 4219 | 0 | 336 | 164 | 0 | 626 | 765 | 1050 |
| ingenua: leer y escribir lo leído más n | 0 | 0 | 32810 | 500 | 0 | 0 | 732 | 1050 | 1052 |
  ✓ M2 atómica: ningún Negocio termina por encima del tope (0 veces se pasa)
  ✓ M2 atómica: cada `usado` que devolvió una reserva concedida es menor o igual al tope
  ✓ M2 atómica: el saldo final es exactamente la suma de lo concedido, en cada Negocio
  ✓ M2 atómica: no se niega nada que cupiera (toda negación habría pasado el tope con el saldo final)
  ✓ M2 atómica: el caliente no le quita nada a los otros nueve (todo lo que pidieron se concedió, su demanda cabía)
  ✓ M2 atómica: el caliente termina lleno (pidió mucho más que su tope)
  ✓ M2 control: leer, decidir y sumar SÍ se pasa del tope con 500 reservas a la vez
  ✓ M2 control: leer y escribir lo leído deja un saldo que no cuadra con lo concedido
### 2. ¿El Negocio caliente frena a los demás? Latencia de las 234 reservas de los otros nueve, con la misma carga HTTP, con la fila caliente y sin ella; 5 rondas por condición
| simultáneas | condición | reservas de los otros nueve | p50 (ms) | p90 | p95 | máx | pico de sesiones activas | pico esperando un candado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 234 reservas | sin el caliente | 1170 | 355 | 495 | 511 | 525 | 29 | 18 |
| 500 reservas | el caliente repartido en filas distintas (sin punto caliente) | 1170 | 512 | 756 | 799 | 894 | 41 | 14 |
| 500 reservas | el caliente en una sola fila | 1170 | 491 | 709 | 768 | 920 | 11 | 3 |
| 234 reservas | sin el caliente | 1170 | 359 | 854 | 936 | 1015 | 51 | 30 |
| 300 reservas | el caliente repartido en filas distintas (sin punto caliente) | 1170 | 341 | 520 | 521 | 600 | 41 | 31 |
| 300 reservas | el caliente en una sola fila | 1170 | 340 | 975 | 1015 | 1094 | 42 | 33 |
  ✓ M2: con la fila caliente el p50 de los otros nueve no se multiplica por más de 3 (512 ms con el caliente repartido contra 491 ms con el caliente en una fila)
### 3. Una reserva sola, 40 repeticiones (sin concurrencia), para restar la red
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| UPDATE … WHERE (atómica) | 40 | 82.1 | 113 | 115 | 80.1 | 120 |
| INSERT … ON CONFLICT DO UPDATE … WHERE (crea la ventana) | 40 | 81.7 | 118 | 119 | 80.0 | 166 |
| UPDATE con libro de reservas (CTE) | 40 | 81.9 | 116 | 118 | 80.4 | 120 |
| leer y después escribir (2 peticiones) | 40 | 163 | 200 | 201 | 161 | 202 |
RTT de select 1 (p50 de la fase de red): 81.1 ms.
### 4. Las 500 reservas con la sentencia INSERT … ON CONFLICT (la ventana no existe antes)
| reserva | Negocios por encima del tope | saldo ≠ suma de lo concedido | concedidas | denegadas | p50 (ms) | p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| INSERT … ON CONFLICT DO UPDATE … WHERE | 0 | 0 | 277 | 223 | 404 | 1446 |
  ✓ M2 upsert: sin pasarse del tope, con el saldo cuadrado, aun creando la ventana en el primer uso
  ✓ M2 upsert: una primera reserva más grande que el tope se niega
### 5. Reservar 1.000 tokens por turno y devolver lo que sobró (tope 100.000 en un Negocio; 150 turnos a la vez)
  ✓ M2 devolución: de 150 reservas de 1.000 con tope 100.000 caben exactamente 100
  ✓ M2 devolución: ninguna reserva vio un saldo por encima del tope
  ✓ M2 devolución: tras liquidar las 100, el saldo es exactamente lo consumido (49762 de 100.000 reservados)
  ✓ M2 devolución: liquidar otra vez la misma reserva no devuelve nada (idempotente, 100 reintentos a la vez)
  ✓ M2 devolución: si el consumo real supera lo reservado no se devuelve nada
  ✓ M2 devolución: lo devuelto se puede reservar de nuevo (cabían 49 y se concedieron 49)
  ✓ M2 devolución: el saldo final es lo consumido, más la reserva cuyo consumo superó lo reservado, más lo que sigue reservado sin liquidar, y no pasa del tope
  ✓ M2 devolución: el saldo de `cupos` coincide con el libro de reservas (lo consumido hasta lo reservado, o lo reservado si sigue abierta)
| paso | valor |
| --- | --- |
| reservas de 1.000 concedidas de 150 (tope 100.000) | 100 |
| saldo tras la primera ola | 100000 |
| tokens consumidos de verdad (suma de las 100) | 49762 |
| saldo tras liquidar | 49762 |
| liquidaciones repetidas que devolvieron algo | 0 |
| reservas concedidas en la segunda ola | 49 |
| saldo final | 99762 |
Peticiones HTTP a Neon en este proceso: 15146
19 casos, 0 fallaron.
exit 0

$ pnpm tsx scripts/medir-aislamiento.mts --fase=m3
Medición del aislamiento · rama desechable de Neon · ENVIO_SIMULADO=1 · fase m3
Sin modelo y sin Kapso: el único destino de red permitido es Neon.
### Red (al empezar): select 1 por el driver HTTP de Neon, 30 repeticiones tras una de calentamiento
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| select 1 por el driver HTTP | 30 | 75.7 | 144 | 145 | 74.5 | 149 |
## M3. RLS + CTE bajo carga
Sembrando 10 Negocios inventados (pedidos, Clientes y mensajes sintéticos)…
| Negocio | pedidos | ventas (confirmado, enviado, entregado, novedad) | suma de ventas (COP inventados) |
| --- | --- | --- | --- |
| AISL01 | 9000 | 6000 | 704442500 |
| AISL02 | 9250 | 6168 | 717089162 |
| AISL03 | 9500 | 6334 | 732714003 |
| AISL04 | 9750 | 6500 | 751294375 |
| AISL05 | 10000 | 6668 | 773265037 |
| AISL06 | 10250 | 6834 | 798130628 |
| AISL07 | 10500 | 7000 | 825896250 |
| AISL08 | 10750 | 7168 | 857190912 |
| AISL09 | 11000 | 7334 | 871057253 |
| AISL10 | 11250 | 7500 | 881528125 |
### 1. El lote aplica rol, variable y tope juntos
  ✓ M3 ligado: el lote corre como amanece_consultas, sin BYPASSRLS, con el Negocio de la sesión, tope de 2 s y solo ve los pedidos de A
### 2. Un lote sin `set_config` falla cerrado
  ✓ M3 falla cerrado: sin `set_config`, con cadena vacía y con un valor inválido nunca devuelve filas (error o 0 filas)
  ✓ M3 falla cerrado: con la política tolerante, sin `set_config` devuelve 0 filas (no error)
  ✓ M3 falla cerrado: 100 lotes sin `set_config` mezclados con 100 con él (conexiones reutilizadas) nunca ven filas
  ✓ M3 falla cerrado: los lotes con `set_config` de A ven exactamente los pedidos de A
| caso | resultado |
| --- | --- |
| política estricta (como #8): sin `set_config` | error: invalid input syntax for type uuid: "" |
| política estricta: `set_config` con cadena vacía | error: invalid input syntax for type uuid: "" |
| política estricta: `set_config` con un valor que no es uuid | error: invalid input syntax for type uuid: "no-es-un-uuid" |
| política tolerante (`current_setting(…, true)`): sin `set_config` | 0 errores, 0 filas visibles |
| 100 lotes con `set_config` de A y luego 100 sin él, mezclados a la vez (conexiones reutilizadas) | los 100 sin él: 100 cerraron; los 100 con él: 100 vieron exactamente los 9000 pedidos de A |
### 3. Qué frena la base sola, si el validador se saltara (el rol, ya con el Negocio A puesto)
  ✓ M3 ataque: leer una tabla sin permiso (`negocios`) → lo frena la base
  ✓ M3 ataque: leer una columna no concedida (texto de los mensajes) → lo frena la base
  ✓ M3 ataque: leer una columna no concedida (dirección del pedido) → lo frena la base
  ✓ M3 ataque: escribir (`update`) → lo frena la base
  ✓ M3 ataque: borrar (`delete`) → lo frena la base
  ✓ M3 ataque: insertar → lo frena la base
  ✓ M3 ataque: leer `pg_authid` (hashes de contraseña) → lo frena la base
  ✓ M3 ataque: leer `pg_shadow` → lo frena la base
  ✓ M3 ataque: leer un archivo del servidor (`pg_read_file`) → lo frena la base
  ✓ M3 ataque: ver las consultas de otras sesiones (`pg_stat_activity.query`) → lo frena la base
  ✓ M3 ataque: pedir las filas de B con el Negocio A puesto → lo frena la base
  ✓ M3 ataque: pedir los Clientes de B con el Negocio A puesto → lo frena la base
  ✓ M3 ataque: `pg_sleep(5)` con el tope de 2 s → lo frena la base
  ✓ M3 ataque: producto cartesiano de pedidos (tope de 2 s) → lo frena la base
  ✓ M3 ataque (límite conocido, el validador es el anillo): listar los nombres de las tablas (`pg_class`, metadatos públicos) → la base no lo frena
  ✓ M3 ataque (límite conocido, el validador es el anillo): listar los nombres de los roles (`pg_roles`) → la base no lo frena
  ✓ M3 ataque (límite conocido, el validador es el anillo): `SET ROLE neondb_owner` (volver al dueño de la sesión) → la base no lo frena
  ✓ M3 ataque (límite conocido, el validador es el anillo): `SET ROLE amanece_nucleo` (otro rol de la app) → la base no lo frena
  ✓ M3 ataque: `SET ROLE neon_superuser` → lo frena la base
  ✓ M3 ataque: `SET ROLE cloud_admin` → lo frena la base
| intento desde dentro del rol | resultado | detalle |
| --- | --- | --- |
| leer una tabla sin permiso (`negocios`) | frenado | permission denied for table negocios (80.4 ms) |
| leer una columna no concedida (texto de los mensajes) | frenado | permission denied for table mensajes_cliente (78.5 ms) |
| leer una columna no concedida (dirección del pedido) | frenado | permission denied for table pedidos (77.3 ms) |
| escribir (`update`) | frenado | permission denied for table pedidos (85.4 ms) |
| borrar (`delete`) | frenado | permission denied for table pedidos (78.2 ms) |
| insertar | frenado | permission denied for table clientes (121 ms) |
| leer `pg_authid` (hashes de contraseña) | frenado | permission denied for table pg_authid (76.4 ms) |
| leer `pg_shadow` | frenado | permission denied for view pg_shadow (76.8 ms) |
| leer un archivo del servidor (`pg_read_file`) | frenado | permission denied for function pg_read_file (77.1 ms) |
| ver las consultas de otras sesiones (`pg_stat_activity.query`) | frenado | no dio error y no devolvió filas ajenas; 78.4 ms |
| pedir las filas de B con el Negocio A puesto | frenado | no dio error y no devolvió filas ajenas; 77.4 ms |
| pedir los Clientes de B con el Negocio A puesto | frenado | no dio error y no devolvió filas ajenas; 137 ms |
| `pg_sleep(5)` con el tope de 2 s | frenado | canceling statement due to statement timeout (2096 ms) |
| producto cartesiano de pedidos (tope de 2 s) | frenado | canceling statement due to statement timeout (2097 ms) |
| listar los nombres de las tablas (`pg_class`, metadatos públicos) | no se frena (límite) | no dio error y no devolvió filas ajenas; 81.7 ms |
| listar los nombres de los roles (`pg_roles`) | no se frena (límite) | no dio error y no devolvió filas ajenas; 78.9 ms |
| `SET ROLE neondb_owner` (volver al dueño de la sesión) | no se frena (límite) | no dio error; 76.4 ms |
| `SET ROLE amanece_nucleo` (otro rol de la app) | no se frena (límite) | no dio error; 78.7 ms |
| `SET ROLE neon_superuser` | frenado | It is not allowed to change role to neon_superuser (76.9 ms) |
| `SET ROLE cloud_admin` | frenado | permission denied to set role "cloud_admin" (131 ms) |
  ✓ M3 límite conocido de #8: un `set_config` dentro del SELECT SÍ cambia de Negocio (A ve filas de B); se registra para que el validador lo prohíba
### 3b. ¿Sobrevive el estado de sesión entre peticiones HTTP? (una consulta que fija la variable o el rol sin `LOCAL`)
| qué se hizo | resultado |
| --- | --- |
| 120 peticiones sueltas fijan `app.negocio_id` = B con `is_local = false`; luego 120 lotes con `SET LOCAL ROLE` y sin `set_config` | 77 de 120 lotes vieron filas (B tiene 9250 pedidos) |
| lo mismo, pero con `RESET ALL` y `RESET ROLE` como primeras sentencias del lote | 0 de 120 lotes vieron filas |
| 360 peticiones sueltas dejan la variable en cadena vacía; se repiten los 120 lotes sin reinicio | 0 de 120 lotes vieron filas |
| 360 peticiones sueltas hacen `SET ROLE amanece_nucleo` sin LOCAL; luego 120 `select current_user` | 0 de 120 corrieron con un rol distinto de neondb_owner |
| lo mismo, pero el `select current_user` va después de `RESET ALL` y `RESET ROLE` en un lote | 0 de 120 con un rol distinto de neondb_owner |
| 720 peticiones sueltas hacen `RESET ROLE`; se repiten los 120 `select current_user` | 0 de 120 con un rol distinto de neondb_owner |
  ✓ M3 estado de sesión (límite conocido): lo que una petición fija sin `LOCAL` SOBREVIVE en otras (variable: 77 de 120 lotes sin `set_config` vieron filas de B; rol: 0 de 120); el validador tiene que prohibir `SET` y `set_config`
  ✓ M3 estado de sesión: con `RESET ALL` y `RESET ROLE` al abrir el lote, el estado heredado no llega (0 filas de B, 0 roles pegados)
  ✓ M3 estado de sesión: después de la limpieza no queda ninguna conexión con la variable ni con el rol puestos
### 4. ¿La política usa el índice? EXPLAIN (ANALYZE, BUFFERS) dentro del lote, con el rol y el Negocio puestos
  ✓ M3 EXPLAIN: la política sobre `pedidos` se resuelve con un índice por `negocio_id` (sin recorrido secuencial)
  ✓ M3 EXPLAIN: la consulta del Indicador no recorre `pedidos` ni `clientes` en secuencial
  ✓ M3 EXPLAIN: la lectura de mensajes con solo la política usa un índice (sin recorrido secuencial)
### 5. 500 lotes concurrentes (50 por Negocio, en 10 ráfagas de 50 en paralelo, Negocios mezclados)
| configuración | lotes | errores | filas de otro Negocio (fugas) | totales ≠ verdad | p50 (ms) | p90 | p95 | mín | máx | mediana de las medianas por ráfaga |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| con RLS + CTE (producción) | 2500 | 0 | 0 | 0 | 599 | 825 | 899 | 97.5 | 1351 | 671 |
| sin RLS, solo CTE | 2500 | 0 | 0 | 0 | 554 | 816 | 900 | 98.6 | 1281 | 600 |
| CTE sin WHERE + RLS (un error de la CTE) | 500 | 0 | 0 | 0 | 468 | 745 | 821 | 157 | 897 | 470 |
| CTE sin WHERE + política en `true` (mutación de control) | 500 | 10 | 13170 | 490 | 1870 | 2249 | 2491 | 799 | 2568 | 1903 |
p50 de cada ronda de 500 lotes (ms), con RLS contra sin RLS:
| ronda | primero corrió | con RLS p50 | sin RLS p50 | diferencia | con RLS p95 | sin RLS p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | con RLS | 599 | 526 | 73.3 | 969 | 762 |
| 2 | sin RLS | 601 | 672 | -71.3 | 897 | 1205 |
| 3 | con RLS | 595 | 539 | 55.2 | 1275 | 788 |
| 4 | sin RLS | 605 | 598 | 6.9 | 900 | 1204 |
| 5 | con RLS | 596 | 525 | 71.1 | 893 | 826 |
Diferencia de p50, con RLS menos sin RLS: 45.5 ms (8.2 %). Diferencia de p95: -1.1 ms. Un select 1 cuesta 75.7 ms (p50).
  ✓ M3 carga: 2500 lotes con RLS + CTE sin un solo error
  ✓ M3 carga: con RLS + CTE ninguna fila es de otro Negocio (fugas = 0)
  ✓ M3 carga: con RLS + CTE todos los totales y las listas coinciden con la verdad
  ✓ M3 carga: sin RLS (solo la CTE) tampoco hay fugas ni diferencias, así que la CTE sola ya liga bien
  ✓ M3 anillo: con una CTE sin `WHERE` (el error), RLS deja a cada Negocio solo con lo suyo: fugas = 0 y totales correctos
  ✓ M3 mutación de control: con la política en `true` y la CTE sin `WHERE`, la prueba de fugas SÍ detecta fugas (la afirmación puede fallar)
### 6. Una lectura simple del núcleo (últimos 20 mensajes de un Cliente): suelta contra el lote con RLS
Por HTTP, desde esta máquina (ms):
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| suelta: una petición, `WHERE negocio_id = $1` | 150 | 76.3 | 135 | 137 | 74.5 | 328 |
| lote sin RLS: transacción de solo lectura con tope | 150 | 77.6 | 135 | 138 | 75.2 | 443 |
| lote con RLS: rol + variable + tope + `WHERE negocio_id = $1` | 150 | 78.1 | 134 | 138 | 76.1 | 182 |
| lote con RLS, solo la política (sin `negocio_id` en el WHERE) | 150 | 78.3 | 134 | 138 | 76.2 | 273 |
| lote con RLS precedido de `RESET ALL` y `RESET ROLE` | 150 | 78.6 | 130 | 138 | 76.2 | 268 |
| lote sin RLS con 3 sentencias de relleno (`select 1`) en lugar del prólogo | 150 | 78.0 | 136 | 139 | 76.1 | 144 |
Tiempo en el servidor, de la primera a la última sentencia del lote (ms, reloj de Postgres):
| medida (ms) | n | p50 | p90 | p95 | mín | máx |
| --- | --- | --- | --- | --- | --- | --- |
| suelta: una petición, `WHERE negocio_id = $1` | 150 | 0.9 | 1.1 | 1.3 | 0.8 | 7.8 |
| lote sin RLS: transacción de solo lectura con tope | 150 | 1.2 | 1.4 | 1.5 | 1.1 | 4.5 |
| lote con RLS: rol + variable + tope + `WHERE negocio_id = $1` | 150 | 1.8 | 2.1 | 2.3 | 1.6 | 11.9 |
| lote con RLS, solo la política (sin `negocio_id` en el WHERE) | 150 | 1.8 | 2.1 | 2.1 | 1.6 | 33.0 |
| lote con RLS precedido de `RESET ALL` y `RESET ROLE` | 150 | 2.4 | 2.8 | 3.1 | 2.2 | 15.1 |
| lote sin RLS con 3 sentencias de relleno (`select 1`) en lugar del prólogo | 150 | 1.8 | 2.2 | 2.4 | 1.6 | 20.5 |
Con RLS menos suelta: 1.7 ms en p50 por HTTP (1.1 ms en p95). En el servidor, el prólogo con RLS suma 0.6 ms en p50 sobre el mismo lote sin RLS; tres sentencias de relleno suman 0.6 ms, así que casi todo es el costo de tener más sentencias en el lote y 0.0 ms es el rol, la variable y la política. Abrir el lote con `RESET ALL` y `RESET ROLE` suma 0.6 ms más.
  ✓ M3 costo: las 4 formas devolvieron los mismos 20 mensajes (cada lectura comprobó que llegaron 20)
  ✓ M3 costo: envolver la lectura en el lote con RLS suma menos de 50 ms en p50 sobre la lectura suelta
Bajo concurrencia, 30 ráfagas de 50 lecturas a la vez de cada forma, en orden rotado (ms por lectura):
| medida (ms) | n | p50 | p90 | p95 | mín | máx | mediana de las medianas por ráfaga | mejor ráfaga | peor ráfaga |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| suelta: una petición, `WHERE negocio_id = $1` | 1500 | 178 | 374 | 518 | 78.1 | 863 | 170 | 163 | 711 |
| lote sin RLS: transacción de solo lectura con tope | 1500 | 213 | 374 | 468 | 90.4 | 801 | 211 | 174 | 725 |
| lote con RLS: rol + variable + tope + `WHERE negocio_id = $1` | 1500 | 255 | 434 | 652 | 89.2 | 1318 | 254 | 178 | 951 |
| lote con RLS precedido de `RESET ALL` y `RESET ROLE` | 1500 | 257 | 376 | 451 | 89.5 | 1051 | 245 | 184 | 864 |
Peticiones HTTP a Neon en este proceso: 17094
40 casos, 0 fallaron.
exit 0
```
