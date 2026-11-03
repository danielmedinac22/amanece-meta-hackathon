/**
 * Publicar: lo aplicado queda en la vista previa del Dueño y los Clientes siguen con lo publicado hasta que un Dueño
 * toca Publicar. Corre contra Neon y Muse Spark reales, con `ENVIO_SIMULADO=1`, en Negocios desechables que borra al
 * final. Afirma lo que queda en la base o lo que se habría enviado, nunca el texto del modelo.
 *
 *   pnpm tsx scripts/probar-publicar.mts [--solo=central,tablas]
 */
import { config } from 'dotenv'
import { and, eq, inArray } from 'drizzle-orm'
import { afirmar, capturarEnvios, eventoDeKapso, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const envios = capturarEnvios()
const infos: string[] = []
const imprimirInfo = console.info
console.info = (...args: unknown[]) => {
  imprimirInfo(...args)
  infos.push(args.map(String).join(' '))
}

const { db, esquema } = await import('../src/db')
const { conTransaccion } = await import('../src/db/pool')
const { aprobar, proponer } = await import('../src/nucleo/cambios')
const { leerAplicado, leerPublicado } = await import('../src/nucleo/estado')
const { escribir, naceSinPublicar } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')
const { leerMensajeEntrante } = await import('../src/nucleo/entrada')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Clave = import('../src/nucleo/estado/elementos').Clave
type NegocioId = import('../src/nucleo/identidad').NegocioId
type ContextoDelDueno = import('../src/nucleo/identidad').ContextoDelDueno
type Motores = import('../src/nucleo/clientes/turno').Motores
type Pedido = Parameters<typeof proponer>[1]
type Quiere = Extract<Pedido, { origen: 'hilo' | 'panel' }>['quiere'][number]

const marca = String(Date.now()).slice(-7)
const creados: string[] = []
const CAFE = el.comoClave(`producto:${marca}-cafe`)
const PRECIO_VIEJO = 38000
const PRECIO_NUEVO = 50000
const SIN_USO = { inputTokens: 0, outputTokens: 0 }
/** El ensayo de la tarjeta no es lo que se prueba aquí: un guion evita gastar el modelo en cada propuesta. */
const SIN_MODELO: Motores = {
  responder: async () => ({ texto: 'Con gusto te ayudo.', uso: SIN_USO }),
  reescribir: async () => ({ texto: 'Con gusto te ayudo.', uso: SIN_USO }),
}

const cafe = (precio: number): Elemento => ({ tipo: 'producto', nombre: `Café 500 g ${marca}`, descripcion: 'Tueste medio, en grano', precio: el.comoMonto(precio), activo: true })
const dato = (campo: 'ciudad' | 'envios' | 'pagos' | 'horario', valor: string): Elemento => ({ tipo: 'dato', campo, valor })
const poner = (elemento: Elemento, reemplaza: Clave | null = null): Quiere => ({ tipo: 'poner', elemento, reemplaza })
const SIEMPRE_SIN_PLAZO: Elemento = {
  tipo: 'regla',
  nombre: 'Sin fechas de entrega',
  cuando: { tipo: 'siempre' },
  efectos: [{ tipo: 'no_prometer', que: 'plazo' }],
  escenarios: { activan: [{ mensajeDelCliente: '¿Me llega el viernes a Cali?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] },
}
const CASO_FUERA_DE_MANIZALES: Elemento = {
  tipo: 'regla',
  nombre: 'Pedido fuera de Manizales',
  cuando: { tipo: 'pedido', condicion: { tipo: 'ciudad_fuera_de', ciudades: ['Manizales'] } },
  efectos: [{ tipo: 'abrir_caso', titulo: 'Pedido fuera de Manizales' }],
  escenarios: {
    activan: [{ mensajeDelCliente: 'Quiero 2 bolsas para Pereira, calle 10 # 5-20', momento: null, pedido: null, esperado: { hace: ['crear_pedido', 'abrir_caso'], noHace: [] } }],
    noActivan: [],
  },
}

async function negocioAbierto(letra: string): Promise<NegocioId> {
  const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Publicar ${letra} ${marca}`, codigo: `PUB${marca}${letra}`, rubro: 'café', estado: 'listo' }).returning({ id: esquema.negocios.id })
  creados.push(n.id)
  const N = marcar.negocio(n.id)
  const r = await conTransaccion((tx) =>
    escribir(
      tx,
      N,
      { tipo: 'tablas_viejas' },
      {
        elementos: [
          { clave: CAFE, base: 'nueva', despues: cafe(PRECIO_VIEJO) },
          { clave: el.comoClave('dato:ciudad'), base: 'nueva', despues: dato('ciudad', 'Manizales') },
          { clave: el.comoClave('dato:envios'), base: 'nueva', despues: dato('envios', 'A toda Colombia, envío incluido, en 3 a 5 días') },
          { clave: el.comoClave('dato:pagos'), base: 'nueva', despues: dato('pagos', 'Contraentrega') },
        ],
        filas: [],
      },
      null,
    ),
  )
  if (r.tipo !== 'escrito') throw new Error(`no pude sembrar el Negocio: ${JSON.stringify(r)}`)
  return N
}

async function duenoDe(N: NegocioId, nombre: string): Promise<ContextoDelDueno> {
  const [d] = await db.insert(esquema.duenos).values({ negocioId: N, usuarioId: `prueba-publicar-${nombre}-${marca}`, nombre }).returning({ id: esquema.duenos.id })
  return { negocio: N, dueno: marcar.dueno(d.id), medio: 'web' }
}

const pedir = (ctx: ContextoDelDueno, ...quiere: [Quiere, ...Quiere[]]) => proponer(ctx, { palabrasDelDueno: 'prueba de publicar', origen: 'hilo', quiere }, SIN_MODELO)

async function aplicar(ctx: ContextoDelDueno, ...quiere: [Quiere, ...Quiere[]]) {
  const r = await pedir(ctx, ...quiere)
  if (r.desenlace === 'aplicado') return r.propuesta
  if (r.desenlace !== 'espera_al_dueno') throw new Error(`proponer dio ${r.desenlace}: ${r.resumen}`)
  const a = await aprobar(ctx, r.tarjeta.propuesta, r.tarjeta.huella)
  if (a.tipo !== 'aplicado') throw new Error(`aprobar dio ${a.tipo}`)
  return r.propuesta
}

/** Un Cliente nuevo que pide hasta que queda el pedido: el modelo a veces confirma antes de crearlo. */
async function clienteQuePide(N: NegocioId, sufijo: string) {
  const telefono = `5731${marca}${sufijo}`
  const wamid = (i: number) => `wamid.PUBLICAR.${marca}.${sufijo}.${i}`
  const textos = [`Hola, quiero 2 bolsas de Café 500 g ${marca} para Pereira, Calle 10 # 5-20, barrio Centro. Pago contraentrega.`, 'Sí, confírmalo así como está', 'Sí, créalo por favor']
  const desdeInfo = infos.length
  const desdeEnvio = envios.length
  const delCliente = async () => {
    const [c] = await db.select({ id: esquema.clientes.id }).from(esquema.clientes).where(and(eq(esquema.clientes.negocioId, N), eq(esquema.clientes.telefono, telefono)))
    return c ? db.select().from(esquema.pedidos).where(eq(esquema.pedidos.clienteId, c.id)) : []
  }
  for (const [i, texto] of textos.entries()) {
    await atenderMensaje(leerMensajeEntrante(eventoDeKapso({ wamid: wamid(i), telefono, texto, nombre: 'Camilo' }))!, N)
    if ((await delCliente()).length) break
  }
  const [pedido] = await delCliente()
  const casos = await db.select().from(esquema.casos).where(eq(esquema.casos.pedidoId, pedido?.id ?? '00000000-0000-4000-8000-000000000000'))
  const reglas = infos
    .slice(desdeInfo)
    .filter((l) => l.startsWith('[atender] turno'))
    .flatMap((l) => (JSON.parse(l.slice(l.indexOf('{'))) as { reglas: string[] }).reglas)
  return { pedido, casos, reglas: new Set(reglas), salidos: envios.slice(desdeEnvio).filter((e) => e.telefono === telefono) }
}

const canon = (e: { todos(): readonly { clave: Clave; elemento: Elemento }[] }) => JSON.stringify([...e.todos()].map((v) => [v.clave, v.elemento]).sort())

const CASOS: Record<string, () => Promise<void>> = {
  async tablas() {
    const filas = [
      ['tablas_viejas', 'atendiendo', false],
      ['tablas_viejas', 'armando', false],
      ['entrevista', 'armando', false],
      ['propuesta', 'armando', false],
      ['propuesta', 'en_sombra', false],
      ['propuesta', 'atendiendo', true],
    ] as const
    for (const [origen, modo, espera] of filas) afirmar(`tabla del bit: ${origen} en ${modo} nace ${espera}`, naceSinPublicar(origen, modo) === espera)
  },

  async central() {
    const N = await negocioAbierto('C')
    const ana = await duenoDe(N, 'Ana')
    const antes = await leerPublicado(N)
    const propuesta = await aplicar(
      ana,
      poner(SIEMPRE_SIN_PLAZO),
      poner(CASO_FUERA_DE_MANIZALES),
      poner(cafe(PRECIO_NUEVO), CAFE),
    )
    const aplicado = await leerAplicado(N)
    const publicado = await leerPublicado(N)
    afirmar('central: la vista previa tiene las reglas y el precio nuevo', aplicado.vigentes('regla').length === 2 && aplicado.vigentes('producto')[0]?.elemento.precio === PRECIO_NUEVO, propuesta)
    afirmar('central: lo publicado sigue igual después de Aplicar', canon(publicado) === canon(antes), { publicado: canon(publicado), antes: canon(antes) })

    const sinPublicar = await clienteQuePide(N, '1')
    afirmar('central: después de Aplicar, el turno real corre sin las reglas', sinPublicar.reglas.size === 0, [...sinPublicar.reglas])
    afirmar('central: después de Aplicar, el pedido sale al precio publicado', sinPublicar.pedido?.total === 2 * PRECIO_VIEJO, sinPublicar.pedido)
    afirmar('central: después de Aplicar, la regla de pedido no abre Caso', sinPublicar.casos.length === 0, sinPublicar.casos)
    afirmar('central: al Cliente le salió la respuesta, simulada', sinPublicar.salidos.length > 0)
  },
}

const solo = process.argv.find((a) => a.startsWith('--solo='))?.slice('--solo='.length).split(',')
try {
  for (const [nombre, caso] of Object.entries(CASOS)) {
    if (solo && !solo.includes(nombre)) continue
    console.log(`\n=== ${nombre} ===`)
    await caso()
  }
} catch (e) {
  afirmar('probar-publicar terminó sin error inesperado', false, e)
} finally {
  if (creados.length) {
    await db.delete(esquema.negocios).where(inArray(esquema.negocios.id, creados))
    afirmar('limpieza: no quedan Elementos de los Negocios desechables', (await db.$count(esquema.elementos, inArray(esquema.elementos.negocioId, creados))) === 0)
  }
  terminar()
}
