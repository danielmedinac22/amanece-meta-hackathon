/**
 * La vista previa por tipo contra la base real: con guiones en vez de modelo, salvo el último caso, que corre Muse
 * Spark. Siembra un Negocio desechable con tres conversaciones reales y lo borra al final, también si falla.
 *
 *   pnpm tsx scripts/probar-vista-previa.mts
 */
import { randomUUID } from 'node:crypto'
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { descartar, proponer, proponerLectura } = await import('../src/nucleo/cambios')
const { escribir } = await import('../src/nucleo/estado/escribir')
const { vistaPreviaDe } = await import('../src/nucleo/cambios/ensayar')
const { armarEstado, leerAplicado } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Motores = import('../src/nucleo/clientes/turno').Motores

const TABLAS = { negocios: esquema.negocios, duenos: esquema.duenos, propuestas: esquema.propuestas, elementos: esquema.elementos, casos: esquema.casos, pedidos: esquema.pedidos, mensajes_dueno: esquema.mensajesDueno }
const contar = async () => Object.fromEntries(await Promise.all(Object.entries(TABLAS).map(async ([n, t]) => [n, await db.$count(t)] as const)))
const antes = await contar()
const SIN_USO = { inputTokens: 0, outputTokens: 0 }
const CAFE_ID = randomUUID()
const CAFE = el.claveDeProducto.deId(CAFE_ID)
const MOLINO = el.claveDeProducto.deId(randomUUID())
const SECRETOS = ['SECRETO-UNO ¿tienen descafeinado?', 'SECRETO-DOS ¿cuánto vale la bolsa?', 'SECRETO-TRES ¿cuándo me llega lo de Pereira?']
const NOMBRES = ['Zoila Reservada', 'Ramiro Confidencial', 'Petra Privada']
const CALLADA = { nombre: 'Olga Callada', texto: 'SECRETO-CUATRO ¿siguen abiertos?' }
let negocioId: string | null = null

const manizales = (nombre = 'Envíos fuera de Manizales'): Elemento => ({
  tipo: 'regla',
  nombre,
  cuando: { tipo: 'pedido', condicion: { tipo: 'ciudad_fuera_de', ciudades: ['Manizales'] } },
  efectos: [
    { tipo: 'abrir_caso', titulo: 'Pedido fuera de Manizales' },
    { tipo: 'no_prometer', que: 'plazo' },
  ],
  escenarios: {
    activan: [{ mensajeDelCliente: 'Quiero 2 bolsas de café de 500 g para Pereira, calle 10 # 5-20', momento: null, pedido: null, esperado: { hace: ['crear_pedido', 'abrir_caso'], noHace: [] } }],
    noActivan: [{ mensajeDelCliente: 'Quiero 2 bolsas de café de 500 g para Manizales, carrera 23 # 60-10', momento: null, pedido: null, esperado: { hace: [], noHace: ['abrir_caso'] } }],
  },
})
const poner = (elemento: Elemento) => ({ tipo: 'poner' as const, elemento, reemplaza: null })

/** El Agente de clientes de guion: crea el pedido cuando el mensaje es para Pereira, y anota lo que ve. */
function guion(opciones: { readonly lanzaSi?: (texto: string) => boolean; readonly prohibido?: boolean } = {}) {
  const vistos = { responder: 0, systems: [] as string[] }
  const motores: Motores = {
    async responder({ system, mensajes, puerto }) {
      vistos.responder++
      if (opciones.prohibido) throw new Error('el guion no debía llamarse')
      vistos.systems.push(system)
      const ultimo = String(mensajes.at(-1)?.content ?? '')
      if (opciones.lanzaSi?.(ultimo)) throw new Error('muestra que falla a propósito')
      if (/para pereira/i.test(ultimo)) await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad: 2 }], ciudad: 'Pereira' }, direccion: 'Calle 10 # 5-20' })
      return { texto: 'Con gusto te ayudo.', uso: SIN_USO }
    },
    async reescribir() {
      return { texto: 'Con gusto te ayudo.', uso: SIN_USO }
    },
  }
  return { motores, vistos }
}

const filaDe = async (id: string) => (await db.select().from(esquema.propuestas).where(eq(esquema.propuestas.id, id)))[0]
const sinTextoDeClientes = (v: unknown) => {
  const json = JSON.stringify(v)
  return [...SECRETOS, ...NOMBRES, CALLADA.nombre, 'SECRETO'].filter((t) => json.includes(t))
}

try {
  const [n] = await db.insert(esquema.negocios).values({ nombre: 'Café de Ensayo', codigo: `PVP${String(Date.now()).slice(-7)}`, estado: 'listo' }).returning({ id: esquema.negocios.id })
  negocioId = n.id
  const N = marcar.negocio(n.id)
  const [d] = await db.insert(esquema.duenos).values({ negocioId: n.id, usuarioId: `prueba-vista-previa-${Date.now()}`, nombre: 'Dueño de prueba' }).returning({ id: esquema.duenos.id })
  const ctx = { negocio: N, dueno: marcar.dueno(d.id), medio: 'web' as const }
  await conTransaccion((tx) =>
    escribir(tx, N, { tipo: 'tablas_viejas' }, {
      elementos: [
        { clave: CAFE, base: 'nueva', despues: { tipo: 'producto', nombre: 'Café 500 g', descripcion: 'Tueste medio', precio: el.comoMonto(38000), activo: true } },
        { clave: el.comoClave('dato:ciudad'), base: 'nueva', despues: { tipo: 'dato', campo: 'ciudad', valor: 'Manizales' } },
        { clave: MOLINO, base: 'nueva', despues: { tipo: 'producto', nombre: 'Molino manual', descripcion: '', precio: el.comoMonto(120000), activo: true } },
      ],
      filas: [],
    }, null),
  )
  const clientes = await db
    .insert(esquema.clientes)
    .values(NOMBRES.map((nombre, i) => ({ negocioId: n.id, telefono: `57300555000${i}`, nombre, ultimoMensajeEntrante: new Date() })))
    .returning({ id: esquema.clientes.id })
  await db.insert(esquema.mensajesCliente).values(SECRETOS.map((texto, i) => ({ negocioId: n.id, clienteId: clientes[i].id, rol: 'cliente' as const, texto })))
  const [callada] = await db.insert(esquema.clientes).values({ negocioId: n.id, telefono: '573005550009', nombre: CALLADA.nombre, ultimoMensajeEntrante: new Date() }).returning({ id: esquema.clientes.id })
  await db.insert(esquema.mensajesCliente).values({ negocioId: n.id, clienteId: callada.id, rol: 'cliente', texto: CALLADA.texto, creado: new Date(Date.now() - 60_000) })
  await db.insert(esquema.mensajesCliente).values(Array.from({ length: 31 }, (_, i) => ({ negocioId: n.id, clienteId: callada.id, rol: 'agente' as const, texto: `Aviso ${i}` })))
  await db.insert(esquema.pedidos).values({ negocioId: n.id, clienteId: clientes[2].id, numero: 1, items: [{ productoId: CAFE_ID, nombre: 'Café 500 g', cantidad: 2, precio: 38000 }], total: 76000, ciudad: 'Pereira', direccion: 'Calle 10 # 5-20', estado: 'pendiente' })
  const delNegocio = async () => ({ pedidos: await db.$count(esquema.pedidos, eq(esquema.pedidos.negocioId, n.id)), casos: await db.$count(esquema.casos, eq(esquema.casos.negocioId, n.id)) })

  console.log('\n=== Un dato solo se describe ===')
  {
    const g = guion({ prohibido: true })
    const p = await proponer(ctx, { origen: 'hilo', palabrasDelDueno: 'Abrimos de 8 a 6', quiere: [poner({ tipo: 'dato', campo: 'horario', valor: 'De lunes a sábado, de 8 a 6' })] }, g.motores)
    const fila = p.desenlace === 'espera_al_dueno' ? await filaDe(p.propuesta) : null
    afirmar('dato: espera el botón, sin llamar a los motores y con conversaciones null', p.desenlace === 'espera_al_dueno' && g.vistos.responder === 0 && fila?.vistaPrevia.conversaciones === null, { desenlace: p.desenlace, vistaPrevia: fila?.vistaPrevia })
  }

  console.log('\n=== La regla de Manizales se ensaya con escenarios y conversaciones reales ===')
  const antesDelEnsayo = await delNegocio()
  const g = guion()
  const p = await proponer(ctx, { origen: 'hilo', palabrasDelDueno: 'Cuando un pedido sea para fuera de Manizales, ábreme un Caso y no prometas fecha', quiere: [poner(manizales())] }, g.motores)
  const fila = p.desenlace === 'espera_al_dueno' ? await filaDe(p.propuesta) : null
  const v = fila?.vistaPrevia.conversaciones
  afirmar('regla: queda espera_al_dueno con 2 escenarios y 3 reales probados; la Cliente sin mensaje suyo en sus últimos 30 se salta', p.desenlace === 'espera_al_dueno' && v?.probadas === 5 && v.fallaron === 0, v)
  const reales = v?.ensayos.filter((e) => e.muestra.origen === 'real') ?? []
  afirmar('regla: las reales se ensayan con hoy y con el cambio', reales.length === 3 && reales.every((e) => !('fallo' in e) && e.hoy !== null), reales)
  const escenarios = v?.ensayos.filter((e) => e.muestra.origen === 'escenario') ?? []
  afirmar('regla: cada escenario cumple lo esperado (crear_pedido y abrir_caso para Pereira; ningún Caso para Manizales)', escenarios.length === 2 && escenarios.every((e) => !('fallo' in e) && e.cumpleLoEsperado === true), escenarios)
  const conPedido = reales.find((e) => !('fallo' in e) && e.conElCambio.reglasActivas.length > 0)
  afirmar('regla: el Cliente real con un pedido abierto a Pereira tiene la regla activa con el cambio, y no hoy', conPedido !== undefined && !('fallo' in conPedido) && conPedido.hoy?.reglasActivas.length === 0 && v?.cambiaron === 1, reales)
  afirmar('regla: lo guardado no trae ningún texto ni nombre de un Cliente', sinTextoDeClientes(fila?.vistaPrevia).length === 0, sinTextoDeClientes(fila?.vistaPrevia))
  afirmar('regla: la tarjeta tampoco', p.tarjeta !== null && sinTextoDeClientes(p.tarjeta).length === 0 && p.tarjeta.lineas.some((l) => l.startsWith('Probé 3 conversaciones recientes')), p.tarjeta)
  afirmar('regla: el ensayo no escribió pedidos ni Casos', JSON.stringify(await delNegocio()) === JSON.stringify(antesDelEnsayo), { antes: antesDelEnsayo, despues: await delNegocio() })

  console.log('\n=== Las reglas pendientes van en el borrador; una lectura pendiente no ===')
  {
    const sinGratis = await proponer(
      ctx,
      {
        origen: 'hilo',
        palabrasDelDueno: 'No digas envío gratis',
        quiere: [poner({ tipo: 'regla', nombre: 'Sin gratis', cuando: { tipo: 'siempre' }, efectos: [{ tipo: 'no_decir', frases: ['envío gratis'] }], escenarios: { activan: [{ mensajeDelCliente: '¿El envío es gratis?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] } })],
      },
      guion().motores,
    )
    const lectura = await proponerLectura(ctx, { fuente: 'tu página (prueba.co)', nombre: null, quiere: [poner({ tipo: 'producto', nombre: 'Pandebono especial', descripcion: '', precio: el.comoMonto(4200), activo: true })], descartados: 0 })
    const otra = guion()
    const r = await proponer(ctx, { origen: 'hilo', palabrasDelDueno: 'Otra vez la de Manizales', quiere: [poner(manizales('Fuera de Manizales, otra'))] }, otra.motores)
    afirmar('pendientes: hay una regla y una lectura esperando', sinGratis.desenlace === 'espera_al_dueno' && lectura.tarjeta !== null && r.desenlace === 'espera_al_dueno', { sinGratis: sinGratis.desenlace, lectura: lectura.tarjeta?.propuesta, r: r.desenlace })
    afirmar('pendientes: la regla pendiente está activa en el borrador del ensayo', otra.vistos.systems.some((s) => s.includes('No digas «envío gratis».')), otra.vistos.systems.length)
    afirmar('pendientes: la lectura pendiente no aporta productos al borrador', otra.vistos.systems.length > 0 && otra.vistos.systems.every((s) => !s.includes('Pandebono')))
    const [filaGratis, filaOtra] = [sinGratis, r].map((x) => (x.desenlace === 'espera_al_dueno' ? filaDe(x.propuesta) : Promise.resolve(undefined)))
    const gratis = (await filaGratis)?.escritura.elementos[0]?.clave
    const conv = (await filaOtra)?.vistaPrevia.conversaciones
    const propias = new Set((await filaOtra)?.escritura.elementos.map((c) => c.clave))
    const escenariosDeOtra = conv?.ensayos.filter((e) => e.muestra.origen === 'escenario') ?? []
    afirmar('pendientes: solo se ensayan los escenarios de las reglas de esta propuesta', escenariosDeOtra.length === 2 && escenariosDeOtra.every((e) => e.muestra.origen === 'escenario' && propias.has(e.muestra.regla)), escenariosDeOtra.map((e) => e.muestra))
    const realesDeOtra = conv?.ensayos.filter((e) => e.muestra.origen === 'real') ?? []
    afirmar('pendientes: hoy ya trae la regla pendiente, así que solo cambia el Cliente con pedido a Pereira', gratis !== undefined && realesDeOtra.length === 3 && realesDeOtra.every((e) => !('fallo' in e) && e.hoy?.reglasActivas.includes(gratis)) && conv?.cambiaron === 1, { cambiaron: conv?.cambiaron, realesDeOtra })
    for (const x of [sinGratis, r]) if (x.desenlace === 'espera_al_dueno') await descartar(ctx, x.propuesta)
    if (lectura.tarjeta) await descartar(ctx, lectura.tarjeta.propuesta)
  }

  console.log('\n=== Una muestra que falla no tumba la propuesta ===')
  {
    const r = await proponer(ctx, { origen: 'hilo', palabrasDelDueno: 'La de Manizales, con una falla', quiere: [poner(manizales('Fuera de Manizales, con falla'))] }, guion({ lanzaSi: (t) => t.includes('SECRETO-DOS') }).motores)
    const f = r.desenlace === 'espera_al_dueno' ? await filaDe(r.propuesta) : null
    afirmar('falla: la propuesta espera el botón con fallaron = 1 y la advertencia arriba de la tarjeta', r.desenlace === 'espera_al_dueno' && f?.vistaPrevia.conversaciones?.fallaron === 1 && (r.tarjeta?.advertencias[0] ?? '').startsWith('No pude ensayar 1 de'), { conversaciones: f?.vistaPrevia.conversaciones, tarjeta: r.tarjeta })
    if (r.desenlace === 'espera_al_dueno') await descartar(ctx, r.propuesta)
  }

  console.log('\n=== Cambiaron cuenta solo reglas activas y Casos del núcleo ===')
  {
    const conMolino: Elemento = {
      tipo: 'regla',
      nombre: 'Pedidos con molino',
      cuando: { tipo: 'pedido', condicion: { tipo: 'incluye', producto: MOLINO } },
      efectos: [{ tipo: 'abrir_caso', titulo: 'Pedido con molino' }, { tipo: 'no_prometer', que: 'plazo' }],
      escenarios: { activan: [{ mensajeDelCliente: 'Quiero el molino manual para Manizales', momento: null, pedido: null, esperado: { hace: ['crear_pedido'], noHace: [] } }], noActivan: [] },
    }
    const caprichoso: Motores = {
      async responder({ system, puerto }) {
        if (/Si el pedido incluye/.test(system)) await puerto.abrir_caso({ titulo: 'Lo abrió el modelo', detalle: 'Por las dudas', pedido: null })
        return { texto: 'Con gusto te ayudo.', uso: SIN_USO }
      },
      reescribir: async () => ({ texto: 'Con gusto te ayudo.', uso: SIN_USO }),
    }
    const r = await proponer(ctx, { origen: 'hilo', palabrasDelDueno: 'Si piden el molino, ábreme un Caso', quiere: [poner(conMolino)] }, caprichoso)
    const conv = r.desenlace === 'espera_al_dueno' ? (await filaDe(r.propuesta))?.vistaPrevia.conversaciones : null
    afirmar('un Caso que el modelo abre por el texto del prompt no cuenta como cambio: cambiaron = 0', conv?.ensayos.filter((e) => e.muestra.origen === 'real').length === 3 && conv.cambiaron === 0, conv)
    if (r.desenlace === 'espera_al_dueno') await descartar(ctx, r.propuesta)
  }

  console.log('\n=== El ensayo cabe en su tope total y la preparación no tumba la propuesta ===')
  {
    let abortadas = 0
    const lento: Motores = {
      responder: ({ senal }) =>
        new Promise((listo, falla) => {
          const t = setTimeout(() => listo({ texto: 'Con gusto te ayudo.', uso: SIN_USO }), 3000)
          senal?.addEventListener(
            'abort',
            () => {
              abortadas++
              clearTimeout(t)
              falla(new Error('abortada'))
            },
            { once: true },
          )
        }),
      reescribir: async () => ({ texto: 'Con gusto te ayudo.', uso: SIN_USO }),
    }
    const escritura = { elementos: [{ clave: el.claveNueva('regla'), base: 'nueva' as const, despues: manizales('Con tope') }], filas: [] as never[] }
    // El tope tiene que dar para las lecturas de la preparación: si Neon se lo come antes de la primera llamada, no hay nada que abortar.
    const TOPE_MS = 1500
    const estadoConTope = await leerAplicado(N)
    const inicio = Date.now()
    const conTope = await vistaPreviaDe(estadoConTope, escritura, [], lento, TOPE_MS)
    const ms = Date.now() - inicio
    const c = conTope.guardada.conversaciones
    afirmar(`tope total: a los ${TOPE_MS} ms lo que no terminó cuenta como no ensayado (${ms} ms)`, ms < 2900 && c !== null && c !== undefined && c.fallaron === c.ensayos.length && c.ensayos.length === 5 && (conTope.guardada.advertencias?.[0] ?? '').startsWith('No pude ensayar 5 de 5'), { ms, c, advertencias: conTope.guardada.advertencias })
    afirmar('tope total: las llamadas al modelo que no terminaron se abortan', abortadas > 0, abortadas)

    const identidad = { id: marcar.negocio('no-es-un-uuid'), nombre: 'Roto', rubro: 'café', codigo: 'ROTO', pais: 'CO', moneda: 'COP', zonaHoraria: 'America/Bogota', modo: 'atendiendo' } as const
    const roto = armarEstado(identidad, el.comoVersion(1), []) as Parameters<typeof vistaPreviaDe>[0]
    const sinPreparar = await vistaPreviaDe(roto, escritura, ['Regla nueva'], guion({ prohibido: true }).motores).catch((e: unknown) => e)
    afirmar('si la preparación falla, vuelve la advertencia y conversaciones null, sin lanzar', !(sinPreparar instanceof Error) && 'guardada' in (sinPreparar as object) && (sinPreparar as Awaited<ReturnType<typeof vistaPreviaDe>>).guardada.conversaciones === null && (sinPreparar as Awaited<ReturnType<typeof vistaPreviaDe>>).guardada.advertencias?.[0]?.startsWith('No pude ensayar este cambio') === true, sinPreparar)
  }
  if (p.desenlace === 'espera_al_dueno') await descartar(ctx, p.propuesta)

  console.log('\n=== Con Muse Spark: la regla de Manizales ===')
  {
    const inicio = Date.now()
    const r = await proponer(ctx, { origen: 'hilo', palabrasDelDueno: 'Cuando un pedido sea para fuera de Manizales, ábreme un Caso y no prometas fecha', quiere: [poner(manizales('Fuera de Manizales, con el modelo'))] })
    const ms = Date.now() - inicio
    const f = r.desenlace === 'espera_al_dueno' ? await filaDe(r.propuesta) : null
    const conv = f?.vistaPrevia.conversaciones
    const activa = conv?.ensayos.find((e) => e.muestra.origen === 'escenario' && e.muestra.lista === 'activan')
    const cumple = activa !== undefined && !('fallo' in activa) && activa.cumpleLoEsperado === true
    console.log(`[medida] vista previa con Muse Spark: ${(ms / 1000).toFixed(1)} s hasta la tarjeta; ${r.gasto.llamadas} llamadas; USD ${r.gasto.usd.toFixed(4)} (${process.env.MODEL_ID ?? 'muse-spark-1.3-contributor'}); probadas ${conv?.probadas}, fallaron ${conv?.fallaron}; el escenario que activa ${cumple ? 'cumplió' : 'no cumplió'}`)
    afirmar('Muse Spark: la propuesta espera el botón con el ensayo guardado', r.desenlace === 'espera_al_dueno' && conv !== null && conv !== undefined && conv.probadas + conv.fallaron === conv.ensayos.length, { desenlace: r.desenlace, conv })
    afirmar('Muse Spark: el escenario que activa cumple, o la tarjeta lo advierte arriba', cumple || (r.tarjeta?.advertencias ?? []).some((a) => a.includes('Pereira') || a.startsWith('No pude ensayar')), { activa, advertencias: r.tarjeta?.advertencias })
    afirmar('Muse Spark: lo guardado y la tarjeta no traen texto de Clientes', sinTextoDeClientes(f?.vistaPrevia).length === 0 && sinTextoDeClientes(r.tarjeta).length === 0)
    afirmar('Muse Spark: el ensayo no escribió pedidos ni Casos', JSON.stringify(await delNegocio()) === JSON.stringify(antesDelEnsayo), await delNegocio())
  }
} catch (e) {
  afirmar('probar-vista-previa terminó sin error inesperado', false, e)
} finally {
  if (negocioId) await db.delete(esquema.negocios).where(eq(esquema.negocios.id, negocioId))
  const despues = await contar()
  afirmar('limpieza: las tablas quedan con las mismas filas que al empezar', JSON.stringify(despues) === JSON.stringify(antes), { antes, despues })
  terminar()
}
