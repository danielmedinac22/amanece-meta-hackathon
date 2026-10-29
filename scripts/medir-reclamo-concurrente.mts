/**
 * Medición desechable del #13: decenas de reclamadores a la vez sobre `trabajos`, por el driver HTTP de Neon
 * (`@neondatabase/serverless`, el mismo de `src/db/index.ts`), con la sentencia de reclamo y la de cierre de
 * `docs/diseno/base-de-codigo/tipos.ts` del mapa (`tomar` y `cerrar`). No es código de producción.
 *
 * Qué corre: 2.000 trabajos en 40 filas `tel:` (50 por fila), 64 reclamadores; cada uno toma, duerme 0 a 50 ms y
 * cierra con la cerca. Además:
 *  - una fila con un tomado huérfano (arriendo vencido) y un pendiente anterior a él;
 *  - 100 trabajos que la primera vez cierran con `reintentar`, para ver que el de atrás no se adelanta;
 *  - 8 trabajos con arriendo de 1 s: su primer corredor espera a que otro lo rescate y entonces intenta cerrar; la cerca
 *    tiene que rechazarlo mientras el rescatador sigue vivo;
 *  - una fila de empate: 30 trabajos con el mismo `orden` y el mismo `creado` (lo que deja un lote de una transacción).
 *
 * Afirma y sale con 1 si algo falla. Con `--sabotaje=<a,b>` se rompe una pieza a propósito para ver que las
 * afirmaciones fallan: sin-indice, sin-skip-locked, sin-fila-ocupada, huerfano-cabeza, sin-cerca. `--reclamo=partido` corre la
 * misma condición en dos NOT EXISTS; `--analizar` corre ANALYZE antes; `--por-fila=N` cambia el tamaño; `--plan` imprime el plan.
 *
 * Solo corre contra la rama desechable de Neon: aborta si el host de DATABASE_URL no es RAMA_DE_MEDICION_HOST.
 * Todo vive en el esquema `medir_reclamo`, que se crea y se borra aquí.
 *
 *   pnpm tsx scripts/medir-reclamo-concurrente.mts [--sabotaje=sin-indice]
 */
import { config } from 'dotenv'
import { randomUUID } from 'node:crypto'
import { neon, NeonDbError } from '@neondatabase/serverless'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })

const SABOTAJES = ['sin-indice', 'sin-skip-locked', 'sin-fila-ocupada', 'huerfano-cabeza', 'sin-cerca'] as const
type Sabotaje = (typeof SABOTAJES)[number]
const sabotaje = new Set(
  (process.argv.find((a) => a.startsWith('--sabotaje='))?.slice('--sabotaje='.length).split(',') ?? []).filter(Boolean) as Sabotaje[],
)
for (const s of sabotaje) if (!SABOTAJES.includes(s)) throw new Error(`Sabotaje desconocido: ${s}`)

const url = process.env.DATABASE_URL
const rama = process.env.RAMA_DE_MEDICION_HOST
if (!url || !rama || new URL(url).hostname !== rama) {
  console.error('DATABASE_URL no apunta a la rama de medición (RAMA_DE_MEDICION_HOST). No se escribe nada.')
  process.exit(2)
}
const sql = neon(url)

const opcion = (nombre: string, porDefecto: number) =>
  Number(process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1] ?? porDefecto)
const RECLAMADORES = opcion('reclamadores', 64)
const FILAS = 40
const POR_FILA = opcion('por-fila', 50)
const REINTENTAN = 100
const CERCAS = 8
const EMPATE = 30
const ARRIENDO = '60 seconds'
const QUEDA = '300 seconds'
const ESTANCADO_MS = 75_000
const TECHO_MS = 300_000

const E = 'medir_reclamo'

// ── Esquema: el DDL de tipos.ts, en su propio esquema ─────────────────────────────────────────────────────────
const ddl = [
  `DROP SCHEMA IF EXISTS ${E} CASCADE`,
  `CREATE SCHEMA ${E}`,
  `CREATE TABLE ${E}.trabajos (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     clave text NOT NULL UNIQUE,
     tipo text NOT NULL,
     contrato int NOT NULL,
     negocio_id uuid REFERENCES public.negocios(id) ON DELETE CASCADE,
     fila text,
     datos jsonb,
     estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','tomado','hecho','agotado')),
     vence timestamptz NOT NULL DEFAULT now(),
     orden timestamptz NOT NULL,
     vigente_hasta timestamptz NOT NULL,
     intentos int NOT NULL DEFAULT 0, max_intentos int NOT NULL, rescates int NOT NULL DEFAULT 0,
     arriendo interval NOT NULL,
     tomado_hasta timestamptz, tomado_por uuid,
     motivo text, absorbido_por uuid REFERENCES ${E}.trabajos(id), error text,
     creado timestamptz NOT NULL DEFAULT now(), actualizado timestamptz NOT NULL DEFAULT now(), terminado timestamptz,
     CHECK ((estado = 'tomado') = (tomado_hasta IS NOT NULL AND tomado_por IS NOT NULL)),
     CHECK ((absorbido_por IS NOT NULL) = (motivo IS NOT DISTINCT FROM 'en_rafaga')),
     CHECK (motivo IS DISTINCT FROM 'en_rafaga' OR estado = 'hecho')
   )`,
  ...(sabotaje.has('sin-indice') ? [] : [`CREATE UNIQUE INDEX trabajos_uno_por_fila ON ${E}.trabajos (fila) WHERE estado = 'tomado'`]),
  `CREATE INDEX trabajos_cabeza_de_fila ON ${E}.trabajos (fila, orden, creado) WHERE estado = 'pendiente'`,
  `CREATE INDEX trabajos_por_vencer ON ${E}.trabajos (vence, creado) WHERE estado IN ('pendiente','tomado')`,
  `CREATE INDEX trabajos_por_negocio ON ${E}.trabajos (negocio_id, estado, creado)`,
  `CREATE TABLE ${E}.pasos_de_trabajo (
     trabajo_id uuid NOT NULL REFERENCES ${E}.trabajos(id) ON DELETE CASCADE,
     nombre text NOT NULL,
     resultado jsonb NOT NULL,
     escrito_por uuid NOT NULL,
     creado timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (trabajo_id, nombre)
   )`,
]

// ── `tomar` de tipos.ts, con `<sus pasos como jsonb>`; sin `<su cola>` porque aquí ningún tipo junta ráfagas ─────
const huerfano = sabotaje.has('huerfano-cabeza')
  ? // c1: el huérfano solo se retoma si es la cabeza de su fila (el hueco que tipos.ts cierra)
    `(t.estado = 'tomado' AND t.tomado_hasta < now() AND NOT EXISTS (
        SELECT 1 FROM ${E}.trabajos o WHERE o.fila = t.fila AND o.id <> t.id
          AND o.estado = 'pendiente' AND (o.orden, o.creado) < (t.orden, t.creado)))`
  : `(t.estado = 'tomado' AND t.tomado_hasta < now())`
const filaOcupada = sabotaje.has('sin-fila-ocupada') ? '' : `o.estado = 'tomado' OR `
const bloqueo = sabotaje.has('sin-skip-locked') ? 'FOR UPDATE OF t' : 'FOR UPDATE OF t SKIP LOCKED'
// `--reclamo=partido`: la misma condición en dos NOT EXISTS, para que cada uno use su índice parcial
// (`trabajos_uno_por_fila` y `trabajos_cabeza_de_fila`). Con el OR de tipos.ts, después de ANALYZE el plan cae en Seq Scan.
const partido = process.argv.includes('--reclamo=partido')
const cabeza = partido
  ? `(${sabotaje.has('sin-fila-ocupada') ? '' : `NOT EXISTS (SELECT 1 FROM ${E}.trabajos o WHERE o.fila = t.fila AND o.estado = 'tomado') AND `}NOT EXISTS (
       SELECT 1 FROM ${E}.trabajos o WHERE o.fila = t.fila AND o.estado = 'pendiente' AND (o.orden, o.creado) < (t.orden, t.creado)))`
  : `NOT EXISTS (
             SELECT 1 FROM ${E}.trabajos o
             WHERE o.fila = t.fila AND o.id <> t.id
               AND (${filaOcupada}(o.estado = 'pendiente' AND (o.orden, o.creado) < (t.orden, t.creado))))`

const TOMAR = `
WITH elegido AS (
  SELECT t.id FROM ${E}.trabajos t
  WHERE ($2::uuid IS NULL OR t.id = $2::uuid)
    AND t.vence <= now() AND t.arriendo <= $1::interval
    AND (
          ${huerfano}
       OR (t.estado = 'pendiente' AND (t.fila IS NULL OR ${cabeza})))
  ORDER BY t.vence, t.creado
  LIMIT 1 ${bloqueo})
UPDATE ${E}.trabajos t SET estado = 'tomado', intentos = t.intentos + 1,
       rescates = t.rescates + (t.estado = 'tomado')::int,
       tomado_hasta = now() + t.arriendo, tomado_por = gen_random_uuid(), actualizado = now()
FROM elegido WHERE t.id = elegido.id
RETURNING t.id, t.clave, t.fila, t.orden, t.intentos, t.rescates, t.tomado_por,
          extract(epoch FROM t.arriendo) * 1000 AS arriendo_ms,
          (SELECT coalesce(jsonb_object_agg(p.nombre, p.resultado), '{}'::jsonb)
             FROM ${E}.pasos_de_trabajo p WHERE p.trabajo_id = t.id) AS pasos,
          extract(epoch FROM clock_timestamp() - statement_timestamp()) * 1000 AS ms_servidor`

// ── `cerrar` de tipos.ts: el desenlace solo se aplica con la cerca ─────────────────────────────────────────────
const cerca = sabotaje.has('sin-cerca') ? '' : ' AND tomado_por = $2'
const CERRAR_HECHO = `
WITH cerrado AS (
  UPDATE ${E}.trabajos SET estado = 'hecho', tomado_hasta = NULL, tomado_por = NULL, datos = NULL,
         terminado = now(), actualizado = now()
  WHERE id = $1 AND estado = 'tomado'${cerca} AND $2::uuid IS NOT NULL
  RETURNING id),
sin_pasos AS (DELETE FROM ${E}.pasos_de_trabajo WHERE trabajo_id IN (SELECT id FROM cerrado))
SELECT count(*)::int AS n FROM cerrado`
const CERRAR_REINTENTAR = `
UPDATE ${E}.trabajos SET estado = 'pendiente', tomado_hasta = NULL, tomado_por = NULL,
       vence = now() + $3::interval, error = 'reintento de la medición', actualizado = now()
WHERE id = $1 AND estado = 'tomado'${cerca} AND $2::uuid IS NOT NULL
RETURNING id`

// ── Siembra ───────────────────────────────────────────────────────────────────────────────────────────────────
type Clase = 'normal' | 'huerfano' | 'empate' | 'cerca'
type Sembrado = {
  clave: string
  fila: string
  clase: Clase
  ordenMs: number
  creadoMs: number
  venceMs: number
  arriendo: string
  reintenta: boolean
  estado: 'pendiente' | 'tomado'
  tomadoHastaMs?: number
  intentos?: number
}

const azar = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const mezclar = <T,>(xs: T[]) => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
}

function sembrados(ahora: number): Sembrado[] {
  const base = ahora - 60 * 60_000
  const out: Sembrado[] = []
  // 40 filas × 50. `orden` y `creado` crecen dentro de la fila; `vence` es al azar (todo ya vencido), así que el
  // `ORDER BY vence` del reclamo cae casi siempre en uno que no es cabeza y la consulta tiene que descartarlo.
  for (let f = 0; f < FILAS; f++) {
    for (let k = 0; k < POR_FILA; k++) {
      const ordenMs = base + k * 1000 + azar(0, 900)
      out.push({
        clave: `medir:${f}:${k}`,
        fila: `tel:5739000${String(f).padStart(5, '0')}`,
        clase: 'normal',
        ordenMs,
        creadoMs: ordenMs,
        venceMs: base + azar(0, 50 * 60_000),
        arriendo: ARRIENDO,
        reintenta: false,
        estado: 'pendiente',
      })
    }
  }
  for (const s of mezclar(out.slice()).slice(0, REINTENTAN)) s.reintenta = true

  // La fila del huérfano: un pendiente P anterior, el huérfano H (tomado, arriendo vencido hace 5 s) y 5 detrás.
  const fh = 'tel:573900099999'
  out.push({ clave: 'huerfano:P', fila: fh, clase: 'huerfano', ordenMs: base, creadoMs: base, venceMs: base, arriendo: ARRIENDO, reintenta: false, estado: 'pendiente' })
  out.push({
    clave: 'huerfano:H', fila: fh, clase: 'huerfano', ordenMs: base + 1000, creadoMs: base + 1000, venceMs: base + 1000, arriendo: ARRIENDO,
    reintenta: false, estado: 'tomado', tomadoHastaMs: ahora - 5000, intentos: 1,
  })
  for (let k = 0; k < 5; k++) {
    const o = base + 2000 + k * 1000
    out.push({ clave: `huerfano:Q${k}`, fila: fh, clase: 'huerfano', ordenMs: o, creadoMs: o, venceMs: o, arriendo: ARRIENDO, reintenta: false, estado: 'pendiente' })
  }

  // Empate: mismo orden y mismo creado, como dos encolar en un solo lote.
  for (let k = 0; k < EMPATE; k++) {
    out.push({ clave: `empate:${k}`, fila: 'tel:573900088888', clase: 'empate', ordenMs: base, creadoMs: base, venceMs: base, arriendo: ARRIENDO, reintenta: false, estado: 'pendiente' })
  }

  // La cerca: arriendo de 1 s; el primer corredor vuelve a los 1,3 s, cuando ya lo rescató otro, que tarda 0,6 s.
  for (let k = 0; k < CERCAS; k++) {
    out.push({ clave: `cerca:${k}`, fila: `tel:5739000777${k}`, clase: 'cerca', ordenMs: base, creadoMs: base, venceMs: base, arriendo: '1 second', reintenta: false, estado: 'pendiente' })
  }
  return mezclar(out)
}

async function sembrar(lista: Sembrado[]) {
  const iso = (ms: number) => new Date(ms).toISOString()
  const filas = lista.map((s) => ({
    clave: s.clave,
    fila: s.fila,
    datos: { clase: s.clase },
    estado: s.estado,
    vence: iso(s.venceMs),
    orden: iso(s.ordenMs),
    creado: iso(s.creadoMs),
    arriendo: s.arriendo,
    intentos: s.intentos ?? 0,
    tomado_hasta: s.tomadoHastaMs ? iso(s.tomadoHastaMs) : null,
    tomado_por: s.tomadoHastaMs ? randomUUID() : null,
  }))
  await sql.query(
    `INSERT INTO ${E}.trabajos (clave, tipo, contrato, fila, datos, estado, vence, orden, vigente_hasta, intentos, max_intentos,
                                arriendo, tomado_hasta, tomado_por, creado)
     SELECT r.clave, 'entrante', 1, r.fila, r.datos, r.estado, r.vence, r.orden, now() + interval '1 hour', r.intentos, 3,
            r.arriendo::interval, r.tomado_hasta, r.tomado_por, r.creado
     FROM jsonb_to_recordset($1::jsonb) AS r(clave text, fila text, datos jsonb, estado text, vence timestamptz, orden timestamptz,
                                               creado timestamptz, arriendo text, intentos int, tomado_hasta timestamptz, tomado_por uuid)`,
    [JSON.stringify(filas)],
  )
}

// ── Corrida ───────────────────────────────────────────────────────────────────────────────────────────────────
type Tomado = {
  id: string
  clave: string
  fila: string
  orden: Date
  intentos: number
  rescates: number
  tomado_por: string
  arriendo_ms: number
  ms_servidor: number
}
type Ejecucion = { rescates: number; intentos: number; cierre: 'hecho' | 'reintentar' | 'rechazado' }
type Vivo = { clave: string; desde: number; hasta: number }

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ahoraMs = () => performance.now()

function percentil(xs: number[], p: number) {
  if (!xs.length) return NaN
  const s = xs.slice().sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)
}
const resumen = (xs: number[]) =>
  `n=${xs.length} p50=${percentil(xs, 0.5).toFixed(1)} p95=${percentil(xs, 0.95).toFixed(1)} máx=${Math.max(...xs).toFixed(1)}`

const es23505 = (e: unknown) => e instanceof NeonDbError && e.code === '23505'

async function main() {
  console.log(`Sabotaje: ${sabotaje.size ? [...sabotaje].join(', ') : 'ninguno (el diseño tal cual)'}`)
  console.log(`Reclamo: ${partido ? 'partido en dos NOT EXISTS' : 'el de tipos.ts'}`)
  console.log(`Host: ${new URL(url!).hostname.replace(/^(ep-[a-z]+-[a-z]+)-[a-z0-9]+/, '$1-…')}\n`)

  // Red en reposo: la ida y vuelta mínima del driver desde aquí.
  await sql.query('SELECT 1')
  const red: number[] = []
  for (let i = 0; i < 30; i++) {
    const t = ahoraMs()
    await sql.query('SELECT 1')
    red.push(ahoraMs() - t)
  }

  for (const s of ddl) await sql.query(s)
  const lista = sembrados(Date.now())
  await sembrar(lista)
  if (process.argv.includes('--analizar')) await sql.query(`ANALYZE ${E}.trabajos`)
  const porClave = new Map(lista.map((s) => [s.clave, s]))
  const porFila = new Map<string, Sembrado[]>()
  for (const s of lista) porFila.set(s.fila, [...(porFila.get(s.fila) ?? []), s])
  const total = lista.length
  console.log(`Sembrados ${total} trabajos en ${porFila.size} filas; ${RECLAMADORES} reclamadores.`)
  if (process.argv.includes('--plan')) {
    const plan = (await sql.query(`EXPLAIN ${TOMAR}`, [QUEDA, null])) as { 'QUERY PLAN': string }[]
    console.log(plan.map((r) => r['QUERY PLAN']).join('\n'))
  }

  const ejecuciones = new Map<string, Ejecucion[]>()
  const vivos = new Map<string, Vivo[]>() // por fila: quién la tiene, con certeza, en este momento
  const cerradosHecho = new Set<string>()
  const cierreEnviado = new Set<string>() // marcado al mandar el cierre `hecho`: el siguiente de la fila puede llegar antes que su respuesta
  const solapes: string[] = []
  const adelantos: string[] = []
  const tardiosAceptados: string[] = []
  const tardiosRechazados: string[] = []
  let rescatesVistos = 0
  // Señales entre el corredor que vuelve tarde y su rescatador, para que el cierre tardío caiga con el rescatador vivo.
  const senales = new Map<string, { p: Promise<void>; listo: () => void }>()
  const senal = (k: string) => {
    let s = senales.get(k)
    if (!s) {
      let listo!: () => void
      const p = new Promise<void>((r) => (listo = r))
      s = { p, listo }
      senales.set(k, s)
    }
    return s
  }
  const choques = { normal: 0, huerfano: 0, empate: 0, cerca: 0 } as Record<Clase, number>
  let choquesSinSalida = 0
  const otrosErrores: string[] = []
  const latTomar: number[] = []
  const latTomarVacio: number[] = []
  const latServidor: number[] = []
  const latServidorNormal: number[] = []
  const latCerrar: number[] = []
  let ultimoAvance = Date.now()
  const inicio = Date.now()
  let terminado = false
  let observacionesDobles = 0

  async function tomar(): Promise<Tomado | null> {
    for (let vez = 0; vez < 2; vez++) {
      const t = ahoraMs()
      try {
        const filas = (await sql.query(TOMAR, [QUEDA, null])) as Tomado[]
        const ms = ahoraMs() - t
        if (!filas.length) {
          latTomarVacio.push(ms)
          return null
        }
        latTomar.push(ms)
        latServidor.push(Number(filas[0].ms_servidor))
        if (porClave.get(filas[0].clave)?.clase === 'normal') latServidorNormal.push(Number(filas[0].ms_servidor))
        return filas[0]
      } catch (e) {
        if (!es23505(e)) throw e
        // El índice rechazó un segundo tomado en la fila: se repite una vez, como dice tipos.ts.
        const detalle = (e as NeonDbError).detail ?? ''
        const fila = /\(fila\)=\(([^)]+)\)/.exec(detalle)?.[1] ?? ''
        const clase = porFila.get(fila)?.[0]?.clase ?? 'normal'
        choques[clase]++
      }
    }
    choquesSinSalida++
    return null
  }

  async function cerrarCon(sentencia: string, params: unknown[]) {
    const t = ahoraMs()
    const r = (await sql.query(sentencia, params)) as { n?: number; id?: string }[]
    latCerrar.push(ahoraMs() - t)
    return sentencia === CERRAR_HECHO ? (r[0]?.n ?? 0) : r.length
  }

  async function reclamador() {
    while (!terminado) {
      let f: Tomado | null
      const enviado = ahoraMs()
      try {
        f = await tomar()
      } catch (e) {
        otrosErrores.push(`tomar: ${(e as Error).message}`)
        await espera(50)
        continue
      }
      if (!f) {
        await espera(azar(5, 25))
        continue
      }
      ultimoAvance = Date.now()
      const recibido = ahoraMs()
      const s = porClave.get(f.clave)!

      // ¿Alguien más tiene su fila, con certeza, ahora mismo?
      const enFila = (vivos.get(f.fila) ?? []).filter((v) => v.hasta > recibido)
      if (enFila.length) solapes.push(`${f.fila}: ${f.clave} tomado mientras ${enFila.map((v) => v.clave).join(', ')} seguía vivo`)
      const yo: Vivo = { clave: f.clave, desde: recibido, hasta: enviado + Number(f.arriendo_ms) }
      vivos.set(f.fila, [...(vivos.get(f.fila) ?? []).filter((v) => v.hasta > recibido), yo])

      // ¿Se adelantó a uno anterior de su fila que no ha terminado? El huérfano sí puede: se retoma a sí mismo.
      if (f.clave !== 'huerfano:H') {
        const antes = (porFila.get(f.fila) ?? []).filter(
          (o) => o.clave !== f!.clave && !cierreEnviado.has(o.clave) && (o.ordenMs < s.ordenMs || (o.ordenMs === s.ordenMs && o.creadoMs < s.creadoMs)),
        )
        if (antes.length) adelantos.push(`${f.fila}: ${f.clave} antes que ${antes.map((o) => o.clave).slice(0, 3).join(', ')}`)
      }

      // Ejecutar: dormir 0 a 50 ms. En la cerca, el primer corredor no vuelve hasta que otro lo rescata (su arriendo es de 1 s);
      // el rescatador no cierra hasta que el tardío intentó cerrar.
      const tarde = s.clase === 'cerca' && f.rescates === 0
      if (s.clase !== 'cerca') await espera(azar(0, 50))
      else if (tarde) {
        const visto = await Promise.race([senal(`rescatado:${f.clave}`).p.then(() => true), espera(30_000).then(() => false)])
        if (visto) rescatesVistos++
      } else {
        senal(`rescatado:${f.clave}`).listo()
        await Promise.race([senal(`tardio:${f.clave}`).p, espera(30_000)])
      }
      const reintentar = s.reintenta && f.intentos === 1

      // Cerrar. La ventana "vivo con certeza" termina cuando sale el cierre.
      yo.hasta = Math.min(yo.hasta, ahoraMs())
      if (!reintentar) cierreEnviado.add(f.clave)
      let n: number
      try {
        n = reintentar
          ? await cerrarCon(CERRAR_REINTENTAR, [f.id, f.tomado_por, '100 milliseconds'])
          : await cerrarCon(CERRAR_HECHO, [f.id, f.tomado_por])
      } catch (e) {
        otrosErrores.push(`cerrar: ${(e as Error).message}`)
        n = 0
      }
      const cierre: Ejecucion['cierre'] = n === 0 ? 'rechazado' : reintentar ? 'reintentar' : 'hecho'
      if (cierre === 'hecho') cerradosHecho.add(f.clave)
      if (tarde) {
        ;(n === 0 ? tardiosRechazados : tardiosAceptados).push(f.clave)
        senal(`tardio:${f.clave}`).listo()
      }
      ejecuciones.set(f.clave, [...(ejecuciones.get(f.clave) ?? []), { rescates: f.rescates, intentos: f.intentos, cierre }])
      ultimoAvance = Date.now()
    }
  }

  // Un observador aparte: lee la base cada 50 ms y cuenta filas con dos tomados vivos a la vez.
  const observador = (async () => {
    while (!terminado) {
      try {
        const r = (await sql.query(
          `SELECT fila, count(*)::int AS n FROM ${E}.trabajos WHERE estado = 'tomado' AND tomado_hasta > now() GROUP BY fila HAVING count(*) > 1`,
        )) as { fila: string; n: number }[]
        observacionesDobles += r.length
      } catch (e) {
        otrosErrores.push(`observador: ${(e as Error).message}`)
      }
      await espera(50)
    }
  })()

  const vigia = (async () => {
    while (!terminado) {
      await espera(250)
      if (cerradosHecho.size >= total) terminado = true
      else if (Date.now() - ultimoAvance > ESTANCADO_MS || Date.now() - inicio > TECHO_MS) terminado = true
    }
  })()

  await Promise.all([...Array.from({ length: RECLAMADORES }, reclamador), observador, vigia])
  const duracion = Date.now() - inicio

  // ── Lo que quedó en la base ──────────────────────────────────────────────────────────────────────────────────
  const estados = (await sql.query(`SELECT estado, count(*)::int AS n FROM ${E}.trabajos GROUP BY estado ORDER BY estado`)) as {
    estado: string
    n: number
  }[]
  const finales = (await sql.query(
    `SELECT clave, fila, estado, intentos, rescates, orden, creado, terminado FROM ${E}.trabajos ORDER BY fila, terminado NULLS LAST, clave`,
  )) as { clave: string; fila: string; estado: string; intentos: number; rescates: number; orden: Date; creado: Date; terminado: Date | null }[]

  console.log(`\nDuración: ${(duracion / 1000).toFixed(1)} s. Estados: ${estados.map((e) => `${e.estado} ${e.n}`).join(', ')}`)
  console.log(`Red en reposo (SELECT 1, 30 seguidas):    ${resumen(red)} ms`)
  console.log(`Reclamo que toma, desde el cliente:        ${resumen(latTomar)} ms`)
  console.log(`Reclamo que toma, dentro de Postgres:      ${resumen(latServidor)} ms`)
  console.log(`  de eso, solo las 40 filas (sin empate):   ${resumen(latServidorNormal)} ms`)
  console.log(`Reclamo que no encuentra nada:             ${resumen(latTomarVacio)} ms`)
  console.log(`Cierre con la cerca, desde el cliente:     ${resumen(latCerrar)} ms`)
  console.log(`Choques 23505 (el índice rechazó un segundo tomado): ${JSON.stringify(choques)}; sin salida tras repetir: ${choquesSinSalida}`)
  console.log(`Observaciones de la base con dos tomados vivos en una fila: ${observacionesDobles}`)
  console.log('')

  // 1. Nunca dos tomados vivos en una fila.
  afirmar('0 veces dos tomados vivos en una fila (visto por los reclamadores)', solapes.length === 0, solapes.slice(0, 5))
  afirmar('0 veces dos tomados vivos en una fila (visto por la base)', observacionesDobles === 0, observacionesDobles)

  // 2. Cada ejecución después de la primera se justifica: el cierre anterior fue `reintentar`, o esta es un rescate.
  const injustificadas: string[] = []
  for (const [clave, xs] of ejecuciones) {
    for (let i = 1; i < xs.length; i++) {
      const rescate = xs[i].rescates > xs[i - 1].rescates
      if (!(xs[i - 1].cierre === 'reintentar' || rescate)) injustificadas.push(`${clave}: ${JSON.stringify(xs)}`)
    }
  }
  afirmar('0 trabajos corridos dos veces sin rescate', injustificadas.length === 0, injustificadas.slice(0, 5))
  const normalesMal = lista
    .filter((s) => s.clase === 'normal' || s.clase === 'empate')
    .filter((s) => (ejecuciones.get(s.clave)?.length ?? 0) !== (s.reintenta ? 2 : 1))
  afirmar(
    'cada trabajo de las 40 filas y del empate corrió una vez (dos si reintentó a propósito)',
    normalesMal.length === 0,
    normalesMal.slice(0, 5).map((s) => `${s.clave}: ${JSON.stringify(ejecuciones.get(s.clave) ?? [])}`),
  )

  // 3. El orden de `orden` dentro de cada fila.
  afirmar('ninguna toma se adelantó a un anterior de su fila (visto por los reclamadores)', adelantos.length === 0, adelantos.slice(0, 5))
  const desordenadas: string[] = []
  for (const [fila, xs] of Map.groupBy(finales.filter((x) => x.estado === 'hecho'), (x) => x.fila)) {
    const clase = porClave.get(xs[0].clave)!.clase
    if (clase === 'empate') continue
    const seq = clase === 'huerfano' ? xs.filter((x) => x.clave !== 'huerfano:H') : xs
    for (let i = 1; i < seq.length; i++) {
      if (new Date(seq[i].orden) < new Date(seq[i - 1].orden)) {
        desordenadas.push(`${fila}: ${seq[i - 1].clave} terminó antes que ${seq[i].clave}`)
        break
      }
    }
  }
  afirmar('dentro de cada fila, `terminado` sigue a `orden` (visto por la base)', desordenadas.length === 0, desordenadas.slice(0, 5))
  const reintentosOk = lista
    .filter((s) => s.reintenta)
    .every((s) => {
      const x = finales.find((y) => y.clave === s.clave)
      return x?.estado === 'hecho' && x.intentos === 2
    })
  afirmar('los 100 que reintentaron terminaron con 2 intentos', reintentosOk)

  // 4. La fila del huérfano se drena: H se retoma (rescates 1), luego P, luego los de detrás.
  const fh = finales.filter((x) => x.clave.startsWith('huerfano:'))
  const ordenFh = fh.filter((x) => x.terminado).map((x) => x.clave)
  afirmar('la fila con el huérfano se drena', fh.every((x) => x.estado === 'hecho'), fh.map((x) => `${x.clave}:${x.estado}`))
  const h = fh.find((x) => x.clave === 'huerfano:H')
  afirmar('el huérfano se retomó a sí mismo (rescates 1, intentos 2)', h?.estado === 'hecho' && h.rescates === 1 && h.intentos === 2, h)
  afirmar(
    'y después corrió el pendiente anterior y los de detrás, en orden',
    ordenFh.join(',') === ['huerfano:H', 'huerfano:P', 'huerfano:Q0', 'huerfano:Q1', 'huerfano:Q2', 'huerfano:Q3', 'huerfano:Q4'].join(','),
    ordenFh,
  )

  // 5. La cerca: quien vuelve después de su arriendo no cierra nada; el rescate sí.
  afirmar(`la cerca rechazó a los ${CERCAS} corredores que volvieron tarde, con su rescatador vivo`, rescatesVistos === CERCAS && tardiosRechazados.length === CERCAS && tardiosAceptados.length === 0, {
    rescatesVistos,
    rechazados: tardiosRechazados.length,
    aceptados: tardiosAceptados,
  })
  const cercaOk = finales.filter((x) => x.clave.startsWith('cerca:')).every((x) => x.estado === 'hecho' && x.rescates >= 1)
  afirmar('y cada trabajo de la cerca lo terminó un rescatador (rescates ≥ 1)', cercaOk, finales.filter((x) => x.clave.startsWith('cerca:')))

  // 6. Todo terminado, nada a medias.
  const hechos = estados.find((e) => e.estado === 'hecho')?.n ?? 0
  afirmar(`los ${total} trabajos quedaron hecho`, hechos === total, estados)
  const porMensaje = Object.entries(Object.groupBy(otrosErrores, (m) => m)).map(([m, xs]) => `${xs!.length} × ${m}`)
  afirmar('sin errores del driver distintos de 23505', otrosErrores.length === 0, porMensaje)

  await sql.query(`DROP SCHEMA IF EXISTS ${E} CASCADE`)
}

try {
  await main()
} catch (e) {
  afirmar('la corrida terminó sin excepción', false, e)
  await sql.query(`DROP SCHEMA IF EXISTS ${E} CASCADE`).catch(() => {})
}
terminar()
