/**
 * Lo que el Agente de clientes puede hacer, con dos adaptadores (la base y la memoria) y la única envoltura.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { db, esquema } from '@/db'
import type { ItemDePedido } from '@/db/esquema'
import { cancelarCita, guardarCita, type NegativaDeCita, type PedidoDeCita } from '../citas'
import { enPalabras, resolverHora, POR_QUE_NO_ESA_HORA, type EscrituraDeCita, type HoraPedida } from '../citas-palabras'
import { marcar, type CasoId, type ClienteId } from '../identidad'
import type { EstadoAplicado, EstadoDelNegocio, EstadoPublicado } from '../estado'
import { ciudadDe, claveDeProducto, comoMonto, normalizar, type AccionDeEscenario, type BorradorDePedido, type Clave, type Monto } from '../estado/elementos'
import { cotizar, type Cotizacion } from '../precios/cotizar'
import { sinRepetir, type Activa, type PorPedidoNuevo, type ReglasCompiladas } from './reglas'
import type { ClienteDelTurno } from './turno'

export type PedidoConsultado = { readonly numero: number; readonly estado: string; readonly total: Monto; readonly items: readonly string[]; readonly ciudad: string; readonly direccion: string }

export interface PuertoDeAcciones {
  buscar_productos(texto: string): Promise<readonly { readonly producto: Clave; readonly nombre: string; readonly descripcion: string; readonly precio: Monto }[]>
  crear_pedido(e: { readonly pedido: BorradorDePedido; readonly direccion: string; readonly cotizacion: Cotizacion }): Promise<{ readonly numero: number; readonly total: Monto } | { readonly negado: string }>
  confirmar_pedido(numero: number): Promise<{ readonly ok: true; readonly total: Monto } | { readonly ok: false; readonly porQue: string }>
  consultar_pedido(numero: number | null): Promise<readonly PedidoConsultado[]>
  /** Con `reusar`, suma el detalle y las reglas al Caso sin resolver de este Cliente con el mismo título y el mismo pedido en vez de abrir otro; `nuevo` dice cuál pasó. */
  abrir_caso(e: { readonly titulo: string; readonly detalle: string; readonly pedido: number | null; readonly reusar: boolean; readonly reglas: readonly string[] }): Promise<{ readonly caso: CasoId | null; readonly nuevo: boolean }>
  guardar_cita(e: PedidoDeCita): Promise<EscrituraDeCita | NegativaDeCita | NoLeToca>
  cancelar_cita(): Promise<EscrituraDeCita | NoLeToca | null>
}

type NoLeToca = { readonly negada: 'no_le_toca' }

/** `pasar_al_dueno` es un efecto, no una acción: en un escenario se espera `abrir_caso`. */
export type NombreDeAccion = keyof PuertoDeAcciones

export type AccionHecha = { readonly nombre: NombreDeAccion; readonly detalle: string }

/** El precio lo pone la envoltura con `cotizar`: el modelo no tiene por dónde dictar un total. */
export type PuertoParaElModelo = Omit<PuertoDeAcciones, 'crear_pedido' | 'abrir_caso' | 'guardar_cita' | 'cancelar_cita'> & {
  crear_pedido(e: { readonly pedido: BorradorDePedido; readonly direccion: string }): Promise<{ readonly numero: number; readonly cotizacion: Cotizacion } | { readonly negado: string }>
  abrir_caso(e: { readonly titulo: string; readonly detalle: string; readonly pedido: number | null }): Promise<{ readonly caso: CasoId | null }>
  guardar_cita(e: HoraPedida & { readonly asunto: string; readonly cambiaLaQueTiene: boolean }): Promise<ResultadoDeCita>
  cancelar_cita(): Promise<ResultadoDeCita>
}

/** El modelo solo recibe lo que puede decir: nunca un instante. */
export type ResultadoDeCita = { readonly ok: true; readonly tipo: EscrituraDeCita['tipo'] } | { readonly ok: false; readonly error: string; readonly ocupadas?: readonly string[] }

export type Envuelto = {
  readonly puerto: PuertoParaElModelo
  hechas(): readonly AccionHecha[]
  cotizaciones(): readonly Cotizacion[]
  /** Los Casos nuevos del turno: `atender` los trae al Dueño después de responder. Uno reusado ya le llegó. */
  casosAbiertos(): readonly CasoId[]
  activadas(): readonly PorPedidoNuevo[]
  /** Los pedidos de los Casos que abrió el modelo en el turno (`null` si no nombró ninguno). */
  casosDelModelo(): readonly (number | null)[]
  /** Un Caso que abre el núcleo por una regla o por el respaldo: reusa el abierto del mismo título y pedido. Queda en `hechas()` como `abrir_caso`. */
  abrirCasoDelNucleo(e: { readonly titulo: string; readonly detalle: string; readonly pedido: number | null; readonly reglas: readonly string[] }): Promise<CasoId | null>
  /** Lo último que este turno guardó de verdad. De aquí sale la constancia. */
  citaDelTurno(): EscrituraDeCita | null
}

const YA_NO_TE_TOCA = 'El Dueño tomó esta conversación: no hagas nada más.'

type Lectura = 'buscar_productos' | 'consultar_pedido'
type Escritura = Exclude<NombreDeAccion, Lectura>
type Salida<K extends Escritura> = Awaited<ReturnType<PuertoDeAcciones[K]>>

/** Una acción nueva que no sea `Lectura` no compila hasta tener su fila: no hay cómo dejarla sin cerca. */
const CERCA: { readonly [K in Escritura]: { readonly negado: Salida<K>; hizo(r: Salida<K>): boolean } } = {
  crear_pedido: { negado: { negado: YA_NO_TE_TOCA }, hizo: (r) => !('negado' in r) },
  confirmar_pedido: { negado: { ok: false, porQue: YA_NO_TE_TOCA }, hizo: (r) => r.ok },
  abrir_caso: { negado: { caso: null, nuevo: false }, hizo: (r) => r.caso !== null },
  guardar_cita: { negado: { negada: 'no_le_toca' }, hizo: (r) => 'tipo' in r },
  cancelar_cita: { negado: { negada: 'no_le_toca' }, hizo: (r) => r !== null && 'tipo' in r },
}

/**
 * Tras una toma, un turno viejo no crea, confirma, agenda ni abre nada. Revisa y luego escribe, así que un efecto puede
 * entrar milisegundos después de la toma: `hizoAlgo` lo cuenta y la línea del Hilo lo dice.
 */
export function conCerca(p: PuertoDeAcciones, sigue: () => Promise<boolean>): { readonly puerto: PuertoDeAcciones; hizoAlgo(): boolean } {
  let hizo = false
  const cercada = <K extends Escritura>(k: K) => {
    const fila = CERCA[k] as { negado: unknown; hizo(r: unknown): boolean }
    const accion = p[k] as (...a: unknown[]) => Promise<unknown>
    return async (...a: unknown[]) => {
      if (!(await sigue())) return fila.negado
      const r = await accion(...a)
      hizo ||= fila.hizo(r)
      return r
    }
  }
  const cercadas = Object.fromEntries((Object.keys(CERCA) as Escritura[]).map((k) => [k, cercada(k)])) as unknown as Pick<PuertoDeAcciones, Escritura>
  return { hizoAlgo: () => hizo, puerto: { buscar_productos: (t) => p.buscar_productos(t), consultar_pedido: (n) => p.consultar_pedido(n), ...cercadas } }
}

const SIN_CIUDAD = 'Falta la ciudad de entrega: pregúntasela al Cliente antes de crear el pedido.'

/**
 * La única envoltura, igual en producción y en el ensayo: `cotizar` en `crear_pedido`, la activación de las reglas de
 * pedido con el borrador y el total que calculó el código, y cada llamada en `hechas()`.
 */
export function envolver(puerto: PuertoDeAcciones, estado: EstadoDelNegocio, reglas: ReglasCompiladas, alEntrar: readonly Activa[]): Envuelto {
  const hechas: AccionHecha[] = []
  const cotizaciones: Cotizacion[] = []
  const casos: CasoId[] = []
  const activadas: PorPedidoNuevo[] = []
  const casosDelModelo: (number | null)[] = []
  const zona = estado.identidad.zonaHoraria
  let citaDelTurno: EscrituraDeCita | null = null
  const anotar = (nombre: NombreDeAccion, detalle: string) => hechas.push({ nombre, detalle })
  const abrir = async (e: Parameters<PuertoDeAcciones['abrir_caso']>[0]) => {
    const r = await puerto.abrir_caso(e)
    anotar('abrir_caso', e.titulo)
    if (r.caso && r.nuevo && !casos.includes(r.caso)) casos.push(r.caso)
    return r
  }
  return {
    puerto: {
      async buscar_productos(texto) {
        anotar('buscar_productos', texto)
        return puerto.buscar_productos(texto)
      },
      async crear_pedido(e) {
        if (!ciudadDe(e.pedido.ciudad)) {
          anotar('crear_pedido', 'negado: sin ciudad')
          return { negado: SIN_CIUDAD }
        }
        const cotizacion = cotizar(e.pedido, estado)
        if ('noCubre' in cotizacion) {
          anotar('crear_pedido', `negado: ${cotizacion.noCubre}`)
          return { negado: cotizacion.noCubre }
        }
        const r = await puerto.crear_pedido({ ...e, cotizacion })
        anotar('crear_pedido', 'negado' in r ? `negado: ${r.negado}` : `#${r.numero}`)
        if ('negado' in r) return r
        cotizaciones.push(cotizacion)
        for (const a of reglas.alCrear({ borrador: e.pedido, total: cotizacion.total }, r.numero)) {
          const i = activadas.findIndex((b) => b.regla === a.regla)
          if (i < 0) activadas.push(a)
          else if (!activadas[i].pedidos.includes(r.numero)) activadas[i] = { ...activadas[i], pedidos: [...activadas[i].pedidos, r.numero] }
        }
        return { numero: r.numero, cotizacion }
      },
      async confirmar_pedido(numero) {
        anotar('confirmar_pedido', `#${numero}`)
        return puerto.confirmar_pedido(numero)
      },
      async consultar_pedido(numero) {
        anotar('consultar_pedido', numero === null ? 'los últimos' : `#${numero}`)
        return puerto.consultar_pedido(numero)
      },
      async abrir_caso(e) {
        const r = await abrir({ ...e, reusar: false, reglas: reglas.nombresDeLasReglasDelCaso(sinRepetir([...activadas, ...alEntrar]), e.pedido) })
        casosDelModelo.push(e.pedido)
        return { caso: r.caso }
      },
      async guardar_cita({ asunto, cambiaLaQueTiene, ...hora }) {
        const resuelta = resolverHora(hora, zona, new Date())
        if ('negada' in resuelta) {
          anotar('guardar_cita', `negada: ${resuelta.negada}`)
          return { ok: false, error: POR_QUE_NO_ESA_HORA[resuelta.negada] }
        }
        // Dos horas distintas en un turno: la segunda sería mover lo que el Cliente acaba de aceptar sin que lo haya pedido.
        if (citaDelTurno && citaDelTurno.tipo !== 'cancelada' && citaDelTurno.inicio.getTime() !== resuelta.inicio.getTime()) {
          anotar('guardar_cita', 'negada: otra en el turno')
          return { ok: false, error: `Ya guardaste una cita en este mensaje. Si el Cliente quiere cambiarla, espera a que lo diga.` }
        }
        const r = await puerto.guardar_cita({ inicio: resuelta.inicio, asunto, cambiaLaQueTiene })
        if ('tipo' in r) {
          anotar('guardar_cita', r.tipo)
          citaDelTurno = r
          return { ok: true, tipo: r.tipo }
        }
        anotar('guardar_cita', `negada: ${r.negada}`)
        if (r.negada === 'no_le_toca') return { ok: false, error: YA_NO_TE_TOCA }
        if (r.negada === 'ya_tiene_cita') return { ok: false, error: `Este Cliente ya tiene cita el ${enPalabras(r.tiene, zona)}. Si quiere cambiarla por esta, llama de nuevo con cambiaLaQueTiene en true. Si quiere una segunda cita, abre un Caso.` }
        return { ok: false, error: 'Esa hora se acaba de ocupar. Propón otra libre ese mismo día, sin decir que quedó.', ocupadas: r.ocupadasDelDia.map((d) => enPalabras(d, zona)) }
      },
      async cancelar_cita() {
        const r = await puerto.cancelar_cita()
        if (r && 'tipo' in r) {
          anotar('cancelar_cita', 'cancelada')
          citaDelTurno = r
          return { ok: true, tipo: r.tipo }
        }
        anotar('cancelar_cita', r ? 'negada: no le toca' : 'negada: no tiene')
        return { ok: false, error: r ? YA_NO_TE_TOCA : 'Este Cliente no tiene una cita por venir.' }
      },
    },
    hechas: () => hechas,
    cotizaciones: () => cotizaciones,
    casosAbiertos: () => casos,
    activadas: () => activadas,
    casosDelModelo: () => casosDelModelo,
    abrirCasoDelNucleo: async (e) => (await abrir({ ...e, reusar: true })).caso,
    citaDelTurno: () => citaDelTurno,
  }
}

function buscarEn(estado: EstadoDelNegocio, texto: string) {
  const palabras = normalizar(texto)
    .split(' ')
    .filter((p) => p.length >= 3)
  return estado
    .vigentes('producto')
    .filter((v) => v.elemento.activo)
    .map((v) => ({ v, puntos: palabras.filter((w) => normalizar(`${v.elemento.nombre} ${v.elemento.descripcion}`).includes(w)).length }))
    .filter((x) => palabras.length === 0 || x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .map(({ v }) => ({ producto: v.clave, nombre: v.elemento.nombre, descripcion: v.elemento.descripcion, precio: v.elemento.precio }))
}

const huellaDeItems = (items: readonly { productoId: string; cantidad: number }[]) => JSON.stringify(items.map((i) => [i.productoId, i.cantidad]).sort())

/** Solo los pedidos y Casos de este Cliente en este Negocio. Los productos salen del estado, no de la base. */
export function puertoDeLaBase(estado: EstadoPublicado, cliente: ClienteId): PuertoDeAcciones {
  const negocio = estado.identidad.id
  const deEsteCliente = and(eq(esquema.pedidos.negocioId, negocio), eq(esquema.pedidos.clienteId, cliente))
  return {
    buscar_productos: async (texto) => buscarEn(estado, texto),

    async crear_pedido({ pedido, direccion, cotizacion }) {
      const items: ItemDePedido[] = cotizacion.lineas.map((l) => ({ productoId: claveDeProducto.aId(l.producto), nombre: l.nombre, cantidad: l.cantidad, precio: l.precio }))
      const [repetido] = await db
        .select()
        .from(esquema.pedidos)
        .where(and(deEsteCliente, eq(esquema.pedidos.estado, 'pendiente'), eq(esquema.pedidos.total, cotizacion.total), gt(esquema.pedidos.creado, new Date(Date.now() - 15 * 60_000))))
        .orderBy(desc(esquema.pedidos.creado))
        .limit(1)
      if (repetido && huellaDeItems(repetido.items) === huellaDeItems(items)) return { numero: repetido.numero, total: cotizacion.total }
      // El número es consecutivo por Negocio; si dos pedidos chocan, el índice único lo atrapa y se reintenta.
      for (let intento = 0; ; intento++) {
        try {
          const [nuevo] = await db
            .insert(esquema.pedidos)
            .values({
              negocioId: negocio,
              clienteId: cliente,
              numero: sql`(select coalesce(max(numero), 0) + 1 from pedidos where negocio_id = ${negocio})`,
              items,
              total: cotizacion.total,
              ciudad: pedido.ciudad,
              direccion,
              estado: 'pendiente',
            })
            .returning({ numero: esquema.pedidos.numero })
          return { numero: nuevo.numero, total: cotizacion.total }
        } catch (error) {
          if (intento >= 2) throw error
        }
      }
    },

    async confirmar_pedido(numero) {
      const donde = and(deEsteCliente, eq(esquema.pedidos.numero, numero))
      const [confirmado] = await db
        .update(esquema.pedidos)
        .set({ estado: 'confirmado', confirmado: sql`now()` })
        .where(and(donde, eq(esquema.pedidos.estado, 'pendiente')))
        .returning({ total: esquema.pedidos.total })
      if (confirmado) return { ok: true, total: comoMonto(confirmado.total) }
      const [existente] = await db.select({ estado: esquema.pedidos.estado }).from(esquema.pedidos).where(donde)
      return { ok: false, porQue: existente ? `El pedido ya está ${existente.estado}; no se puede confirmar de nuevo.` : 'Ese pedido no existe para este Cliente.' }
    },

    async consultar_pedido(numero) {
      const filas = await db
        .select()
        .from(esquema.pedidos)
        .where(and(deEsteCliente, ...(numero !== null ? [eq(esquema.pedidos.numero, numero)] : [])))
        .orderBy(desc(esquema.pedidos.creado))
        .limit(numero !== null ? 1 : 3)
      return filas.map((p) => ({ numero: p.numero, estado: p.estado, total: comoMonto(p.total), items: p.items.map((i) => `${i.cantidad} x ${i.nombre}`), ciudad: p.ciudad, direccion: p.direccion }))
    },

    async abrir_caso({ titulo, detalle, pedido, reusar, reglas }) {
      const [delPedido] = pedido !== null ? await db.select({ id: esquema.pedidos.id }).from(esquema.pedidos).where(and(deEsteCliente, eq(esquema.pedidos.numero, pedido))) : []
      const pedidoId = delPedido?.id ?? null
      if (reusar) {
        const [abierto] = await db
          .update(esquema.casos)
          .set({ detalle: sql`${esquema.casos.detalle} || ${`\n\n${detalle}`}`, reglas: sql`${esquema.casos.reglas} || array(select unnest(${sql.param(reglas)}::text[]) except select unnest(${esquema.casos.reglas}))` })
          .where(
            eq(
              esquema.casos.id,
              sql`(select id from casos where negocio_id = ${negocio} and cliente_id = ${cliente} and titulo = ${titulo} and pedido_id is not distinct from ${pedidoId}::uuid and estado <> 'resuelto' order by creado desc limit 1)`,
            ),
          )
          .returning({ id: esquema.casos.id })
        if (abierto) return { caso: marcar.caso(abierto.id), nuevo: false }
      }
      const [caso] = await db
        .insert(esquema.casos)
        .values({ negocioId: negocio, clienteId: cliente, pedidoId, titulo, detalle, reglas: [...reglas] })
        .returning({ id: esquema.casos.id })
      return { caso: marcar.caso(caso.id), nuevo: true }
    },

    guardar_cita: (e) => guardarCita(negocio, cliente, e),
    cancelar_cita: () => cancelarCita(negocio, cliente),
  }
}

export type PuertoEnMemoria = PuertoDeAcciones & {
  readonly pedidos: readonly (PedidoConsultado & { readonly cotizacion: Cotizacion | null })[]
  readonly casos: readonly { readonly titulo: string; readonly detalle: string; readonly pedido: number | null; readonly reglas: readonly string[] }[]
  readonly citas: () => { readonly inicio: Date | null; readonly ocupadas: readonly Date[] }
}

/** El de ensayo: en memoria, encima de los datos del estado y de los pedidos del Cliente. No escribe nada. */
export function puertoEnMemoria(estado: EstadoDelNegocio, cliente: ClienteDelTurno): PuertoEnMemoria {
  const pedidos = cliente.pedidos.map((p) => ({ numero: p.numero, estado: p.estado, total: p.total, items: [p.resumen], ciudad: p.paraReglas?.borrador.ciudad ?? '', direccion: '', cotizacion: null as Cotizacion | null }))
  const casos: { titulo: string; detalle: string; pedido: number | null; reglas: readonly string[] }[] = []
  let ocupadas: readonly Date[] = cliente.agenda?.ocupadas ?? []
  let suya: Date | null = cliente.agenda?.cita?.inicio ?? null
  return {
    pedidos,
    casos,
    citas: () => ({ inicio: suya, ocupadas }),
    async guardar_cita({ inicio, cambiaLaQueTiene }) {
      const antes = suya
      if (antes?.getTime() === inicio.getTime()) return { tipo: 'agendada', inicio, antes: null }
      if (antes && !cambiaLaQueTiene) return { negada: 'ya_tiene_cita', tiene: antes }
      if (ocupadas.some((o) => o.getTime() === inicio.getTime())) return { negada: 'ocupada', ocupadasDelDia: ocupadas }
      ocupadas = [...ocupadas.filter((o) => o.getTime() !== antes?.getTime()), inicio]
      suya = inicio
      return antes ? { tipo: 'movida', inicio, antes } : { tipo: 'agendada', inicio, antes: null }
    },
    async cancelar_cita() {
      if (!suya) return null
      const cancelada = suya
      ocupadas = ocupadas.filter((o) => o.getTime() !== cancelada.getTime())
      suya = null
      return { tipo: 'cancelada', inicio: cancelada, antes: null }
    },
    buscar_productos: async (texto) => buscarEn(estado, texto),
    async crear_pedido({ pedido, direccion, cotizacion }) {
      const numero = Math.max(0, ...pedidos.map((p) => p.numero)) + 1
      pedidos.push({ numero, estado: 'pendiente', total: cotizacion.total, items: cotizacion.lineas.map((l) => `${l.cantidad} x ${l.nombre}`), ciudad: pedido.ciudad, direccion, cotizacion })
      return { numero, total: cotizacion.total }
    },
    async confirmar_pedido(numero) {
      const i = pedidos.findIndex((p) => p.numero === numero)
      if (i < 0) return { ok: false, porQue: 'Ese pedido no existe para este Cliente.' }
      if (pedidos[i].estado !== 'pendiente') return { ok: false, porQue: `El pedido ya está ${pedidos[i].estado}; no se puede confirmar de nuevo.` }
      pedidos[i] = { ...pedidos[i], estado: 'confirmado' }
      return { ok: true, total: pedidos[i].total }
    },
    consultar_pedido: async (numero) => (numero === null ? pedidos.slice(-3).reverse() : pedidos.filter((p) => p.numero === numero)),
    async abrir_caso({ titulo, detalle, pedido, reusar, reglas }) {
      const i = reusar ? casos.findIndex((c) => c.titulo === titulo && c.pedido === pedido) : -1
      if (i >= 0) casos[i] = { ...casos[i], detalle: `${casos[i].detalle}\n\n${detalle}`, reglas: [...new Set([...casos[i].reglas, ...reglas])] }
      else casos.push({ titulo, detalle, pedido, reglas })
      return { caso: null, nuevo: i < 0 }
    },
  }
}

type Es<A extends true> = A
export type _PasarAlDuenoNoEsAccion = Es<'pasar_al_dueno' extends NombreDeAccion ? false : true>
export type _EscenariosNombranLasAcciones = Es<[NombreDeAccion] extends [AccionDeEscenario] ? ([AccionDeEscenario] extends [NombreDeAccion] ? true : false) : false>
export type _PuertoRealSoloPublicado = Es<EstadoDelNegocio extends Parameters<typeof puertoDeLaBase>[0] ? false : true>
export type _PuertoRealSinLoAplicado = Es<EstadoAplicado extends Parameters<typeof puertoDeLaBase>[0] ? false : true>
