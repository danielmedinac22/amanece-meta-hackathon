/**
 * Publicar: lo aplicado queda en la vista previa del Dueño y los Clientes siguen con lo publicado hasta que un Dueño
 * toca Publicar. Corre contra Neon y Muse Spark reales, con `ENVIO_SIMULADO=1`, en Negocios desechables que borra al
 * final. Afirma lo que queda en la base o lo que se habría enviado, nunca el texto del modelo.
 *
 *   pnpm tsx scripts/probar-publicar.mts [--solo=central,tablas]
 */
import { config } from 'dotenv'
import { and, eq, inArray, sql } from 'drizzle-orm'
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
const { abrirEnElAlta, aprobar, descartar, deshacer, leerLoPendiente, proponer, proponerRespuestaAlCaso, publicar } = await import('../src/nucleo/cambios')
const { ACCIONES, actorDelBoton } = await import('../src/nucleo/acciones')
const { crearAgenteDelDueno } = await import('../src/agentes/dueno')
const { comoSeRevierte, leerAplicado, leerPublicado } = await import('../src/nucleo/estado')
const { escribir, naceSinPublicar, sellar } = await import('../src/nucleo/estado/escribir')
const el = await import('../src/nucleo/estado/elementos')
const { marcar } = await import('../src/nucleo/identidad')
const { canonico } = await import('../src/lib/canonico')
const { leerMensajeEntrante } = await import('../src/nucleo/entrada')
const { atenderMensaje } = await import('../src/nucleo/clientes/atender')
const { retirarSinPublicar } = await import('./retirar-sin-publicar.mjs')
const { quitarPanel } = await import('./quitar-panel.mjs')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Clave = import('../src/nucleo/estado/elementos').Clave
type NegocioId = import('../src/nucleo/identidad').NegocioId
type ContextoDelDueno = import('../src/nucleo/identidad').ContextoDelDueno
type Motores = import('../src/nucleo/clientes/turno').Motores
type Pedido = Parameters<typeof proponer>[1]
type Quiere = Extract<Pedido, { origen: 'hilo' | 'panel' }>['quiere'][number]
type SalidaDelRedactor = import('../src/nucleo/cambios').SalidaDelRedactor
type MotorDelRedactor = import('../src/nucleo/cambios').MotorDelRedactor

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
  const [d] = await db.insert(esquema.duenos).values({ negocioId: N, usuarioId: `prueba-publicar-${nombre}-${N}`, nombre }).returning({ id: esquema.duenos.id })
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

const SALIDA_DE_NUMERO: SalidaDelRedactor = {
  decision: 'consulta',
  sql: 'select count(*) as valor from pedidos where cuenta_como_venta',
  enPalabras: 'pedidos confirmados',
  ventana: 'no_aplica',
  supuestos: [],
  unidad: 'cantidad',
  nombreDeLaUnidad: 'pedidos',
  titulos: [],
  faltaEn: 'ninguna',
  falta: '',
}
const REDACTOR: MotorDelRedactor = async () => ({ salida: SALIDA_DE_NUMERO, uso: SIN_USO })
const pedirIndicador = (ctx: ContextoDelDueno, nombre: string) =>
  proponer(ctx, { palabrasDelDueno: `Quiero ver ${nombre}`, origen: 'hilo', quiere: [{ tipo: 'panel', que: 'indicador', nombre, queQuiereVer: nombre, salida: 'numero', reemplaza: null }] }, SIN_MODELO, REDACTOR)
const pendienteDe = async (N: NegocioId) => leerLoPendiente(await leerAplicado(N))
const publicarComo = (ctx: ContextoDelDueno, vista: string) => publicar(actorDelBoton(ctx), vista)

async function publicarTodo(ctx: ContextoDelDueno) {
  const r = await publicarComo(ctx, (await pendienteDe(ctx.negocio)).huella)
  if (r.tipo !== 'publicado') throw new Error(`publicar dio ${r.tipo}`)
}

const lineasDelHilo = async (ctx: ContextoDelDueno, re: RegExp) =>
  (await db.select({ mensaje: esquema.mensajesDueno.mensaje }).from(esquema.mensajesDueno).where(eq(esquema.mensajesDueno.duenoId, ctx.dueno))).filter((m) => re.test(JSON.stringify(m.mensaje)))

const filasSinPublicar = (N: NegocioId) => db.$count(esquema.elementos, and(eq(esquema.elementos.negocioId, N), eq(esquema.elementos.sinPublicar, true)))

const HORARIO = el.comoClave('dato:horario')
const PAGOS = el.comoClave('dato:pagos')

/** La reversión de una propuesta, con el botón. Devuelve la tarjeta y lo que respondió. */
async function revertir(ctx: ContextoDelDueno, propuesta: import('../src/nucleo/identidad').PropuestaId) {
  const r = await pedir(ctx, { tipo: 'revertir', propuesta })
  if (r.desenlace !== 'espera_al_dueno') throw new Error(`revertir dio ${r.desenlace}: ${r.resumen}`)
  return { tarjeta: r.tarjeta, boton: await aprobar(ctx, r.tarjeta.propuesta, r.tarjeta.huella) }
}

const valor = (e: { vigente(c: Clave): { elemento: Elemento } | null }, c: Clave) => {
  const v = e.vigente(c)?.elemento
  return v?.tipo === 'dato' ? v.valor : null
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
    for (const [origen, modo, espera] of filas) afirmar(`tabla del bit: ${origen} en ${modo} nace ${espera}`, naceSinPublicar(origen, modo, null) === espera)
    const FRENA = { tipo: 'frena', pierde: null } as const
    const SOLO = { tipo: 'solo_vista_previa' } as const
    afirmar('tabla del bit: el freno nace sellado', naceSinPublicar('propuesta', 'atendiendo', FRENA) === false)
    afirmar('tabla del bit: lo que solo sale de la vista previa nace sin publicar', naceSinPublicar('propuesta', 'atendiendo', SOLO) === true)
    afirmar('tabla del bit: mientras se arma, una reversión nace sellada', naceSinPublicar('propuesta', 'armando', SOLO) === false)
    afirmar('tabla del bit: tablas_viejas nace sellado aunque sea una reversión', naceSinPublicar('tablas_viejas', 'atendiendo', SOLO) === false)

    const x = dato('horario', 'x')
    const y = dato('horario', 'y')
    const f = (version: number, contenido: Elemento | null) => ({ version, contenido })
    const tabla = [
      ['sellada y última', { fila: f(5, x), sellada: true, ultima: f(5, x), ultimaSellada: 5 }, { tipo: 'frena', pierde: null }],
      ['sellada, con una edición sin publicar encima', { fila: f(5, x), sellada: true, ultima: f(6, y), ultimaSellada: 5 }, { tipo: 'frena', pierde: { hoy: y } }],
      ['sellada, quitada sin publicar encima', { fila: f(5, x), sellada: true, ultima: f(6, null), ultimaSellada: 5 }, { tipo: 'frena', pierde: { hoy: null } }],
      ['sellada, con una edición ya deshecha encima', { fila: f(5, x), sellada: true, ultima: f(7, x), ultimaSellada: 5 }, { tipo: 'frena', pierde: null }],
      ['sellada, con otra sellada encima', { fila: f(5, x), sellada: true, ultima: f(6, y), ultimaSellada: 6 }, { tipo: 'no_se_puede', porQue: 'la_cambio_otra_publicada' }],
      ['sin sellar y última', { fila: f(6, x), sellada: false, ultima: f(6, x), ultimaSellada: 5 }, { tipo: 'solo_vista_previa' }],
      ['sin sellar, y la última vale lo mismo', { fila: f(6, x), sellada: false, ultima: f(8, x), ultimaSellada: 5 }, { tipo: 'solo_vista_previa' }],
      ['sin sellar, con otra distinta encima', { fila: f(6, x), sellada: false, ultima: f(7, y), ultimaSellada: 5 }, { tipo: 'no_se_puede', porQue: 'la_cambio_otra_sin_publicar' }],
      ['una lápida sin sellar y última (D1)', { fila: f(7, null), sellada: false, ultima: f(7, null), ultimaSellada: null }, { tipo: 'solo_vista_previa' }],
    ] as const
    for (const [nombre, entrada, espera] of tabla) {
      const r = comoSeRevierte(entrada)
      afirmar(`comoSeRevierte: ${nombre}`, canonico(r) === canonico(espera), r)
    }
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

    await publicarTodo(ana)
    const clavesDeReglas = (await leerPublicado(N)).vigentes('regla')
    afirmar('central: Publicar deja lo publicado igual a lo aplicado', canon(await leerPublicado(N)) === canon(await leerAplicado(N)) && clavesDeReglas.length === 2)
    const conPublicar = await clienteQuePide(N, '2')
    const siempre = clavesDeReglas.find((v) => v.elemento.cuando.tipo === 'siempre')?.clave
    afirmar('central: después de Publicar, el turno real corre con la regla', siempre !== undefined && conPublicar.reglas.has(siempre), [...conPublicar.reglas])
    afirmar('central: después de Publicar, el pedido sale al precio nuevo', conPublicar.pedido?.total === 2 * PRECIO_NUEVO, conPublicar.pedido)
    afirmar('central: después de Publicar, la regla de pedido abre el Caso', conPublicar.casos.some((c) => c.titulo === 'Pedido fuera de Manizales'), conPublicar.casos)
  },

  async hecho3() {
    const N = await negocioAbierto('H')
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await publicarTodo(ana)
    const huellaVacia = (await pendienteDe(N)).huella
    await aplicar(ana, poner(dato('horario', 'De 9 a 6')))
    afirmar('hecho 3: una edición cuenta', (await pendienteDe(N)).items.length === 1)
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const devuelta = await pendienteDe(N)
    afirmar('hecho 3: editada y devuelta a lo publicado no cuenta, con versiones nuevas', devuelta.items.length === 0, devuelta)
    afirmar('hecho 3: el mismo contenido da la misma huella', devuelta.huella === huellaVacia)
    const r = await publicarComo(ana, devuelta.huella)
    afirmar('hecho 3: publicar sin nada da ya_estaba', r.tipo === 'ya_estaba', r)
    const nueva = await aplicar(ana, poner(dato('pagos', 'Nequi'), el.comoClave('dato:pagos')))
    afirmar('hecho 3: un cambio de verdad vuelve a contar', (await pendienteDe(N)).items.length === 1, nueva)
    await publicarTodo(ana)
    const publicado = await leerPublicado(N)
    afirmar('hecho 3: Publicar manda el cambio de verdad, y la clave devuelta sigue igual para los Clientes', valor(publicado, PAGOS) === 'Nequi' && valor(publicado, HORARIO) === 'De 8 a 5', canon(publicado))
    afirmar('hecho 3: después de Publicar no queda nada pendiente', (await pendienteDe(N)).items.length === 0)
  },

  async dosDuenos() {
    const N = await negocioAbierto('D')
    const [ana, beto] = [await duenoDe(N, 'Ana'), await duenoDe(N, 'Beto')]
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const vioAna = await pendienteDe(N)
    await aplicar(beto, poner(dato('pagos', 'Nequi'), el.comoClave('dato:pagos')))
    const r = await publicarComo(ana, vioAna.huella)
    afirmar('dos Dueños: lo que Ana no vio no se publica', r.tipo === 'cambio' && r.pendiente.items.length === 2 && (await leerPublicado(N)).vigente(HORARIO) === null, r)
    if (r.tipo !== 'cambio') return
    const nombres = r.pendiente.items.map((i) => i.aplicadoPor).sort()
    afirmar('dos Dueños: la lista nombra quién aplicó cada cosa', JSON.stringify(nombres) === JSON.stringify(['Ana', 'Beto']), r.pendiente.items)
    const r2 = await publicarComo(ana, r.pendiente.huella)
    afirmar('dos Dueños: con la lista nueva sale', r2.tipo === 'publicado' && (await leerPublicado(N)).vigente(HORARIO) !== null, r2)
    const enAna = await lineasDelHilo(ana, /Ana publicó/)
    const enBeto = await lineasDelHilo(beto, /Ana publicó/)
    afirmar('dos Dueños: la línea queda en el Hilo de cada uno', enAna.length === 1 && enBeto.length === 1, { enAna, enBeto })
    const otro = await publicarComo(beto, r.pendiente.huella)
    afirmar('dos Dueños: el otro llega tarde y no pasa nada', otro.tipo === 'ya_estaba', otro)

    await aplicar(beto, poner(dato('horario', 'De 7 a 3')))
    const vista = (await pendienteDe(N)).huella
    const [a, b] = await Promise.all([publicarComo(ana, vista), publicarComo(beto, vista)])
    const tipos = [a.tipo, b.tipo].sort()
    afirmar('doble clic: uno publica y el otro encuentra que ya estaba', JSON.stringify(tipos) === JSON.stringify(['publicado', 'ya_estaba']), { a, b })
    const lineas = [...(await lineasDelHilo(ana, /publicó: .*7 a 3/))]
    afirmar('doble clic: una sola línea en el Hilo', lineas.length === 1, lineas)

    await aplicar(ana, poner(dato('horario', 'De 6 a 2')))
    const [pub, apl] = await Promise.all([publicarComo(ana, (await pendienteDe(N)).huella), aplicar(beto, poner(dato('pagos', 'Daviplata'), el.comoClave('dato:pagos')))])
    afirmar('publicar y aplicar a la vez: terminan los dos', pub.tipo === 'publicado' || pub.tipo === 'cambio', { pub, apl })
  },

  async frenoConOtraPendiente() {
    const N = await negocioAbierto('F')
    const ana = await duenoDe(N, 'Ana')
    const r = await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('pagos', 'Nequi'), PAGOS))
    const { tarjeta, boton } = await revertir(ana, r)
    afirmar('freno: la tarjeta es de Revertir y advierte que llega de una', tarjeta.accion === 'revertir' && tarjeta.advertencias.some((a) => a.includes('de una')), tarjeta)
    afirmar('freno: el botón lo aplica y dice que llegó a los Clientes', boton.tipo === 'aplicado' && /Clientes/.test(boton.resumen), boton)
    const publicado = await leerPublicado(N)
    afirmar('freno: los Clientes ya no lo tienen, sin Publicar', publicado.vigente(HORARIO) === null, valor(publicado, HORARIO))
    afirmar('freno: lo otro pendiente no llegó a los Clientes', valor(publicado, PAGOS) === 'Contraentrega', valor(publicado, PAGOS))
    const pendiente = await pendienteDe(N)
    afirmar('freno: lo otro sigue pendiente, y solo eso', pendiente.items.length === 1 && pendiente.items[0].clave === PAGOS, pendiente.items)
  },

  async d1() {
    const N = await negocioAbierto('U')
    const ana = await duenoDe(N, 'Ana')
    const crear = await aplicar(ana, poner(SIEMPRE_SIN_PLAZO))
    const clave = (await leerAplicado(N)).vigentes('regla')[0].clave
    const quitar = await aplicar(ana, { tipo: 'quitar', claves: [clave] })
    const { tarjeta, boton } = await revertir(ana, quitar)
    afirmar('D1: revertir un quitar sin publicar no advierte que llega a los Clientes', !tarjeta.advertencias.some((a) => a.includes('de una')), tarjeta)
    afirmar('D1: la regla vuelve a la vista previa', boton.tipo === 'aplicado' && (await leerAplicado(N)).vigente(clave) !== null, boton)
    afirmar('D1: los Clientes siguen sin la regla', (await leerPublicado(N)).vigente(clave) === null, crear)
    afirmar('D1: la regla queda pendiente de publicar', (await pendienteDe(N)).items.some((i) => i.clave === clave))
  },

  async frenoConEdicionEncima() {
    const N = await negocioAbierto('E')
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(dato('horario', 'De 7 a 3')))
    await publicarTodo(ana)
    const r = await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('horario', 'De 9 a 6')))
    const { tarjeta, boton } = await revertir(ana, r)
    afirmar('edición encima: la tarjeta avisa lo que se va de la vista previa', tarjeta.advertencias.some((a) => a.includes('También se va')), tarjeta)
    afirmar('edición encima: los dos quedan en lo de antes', boton.tipo === 'aplicado' && valor(await leerPublicado(N), HORARIO) === 'De 7 a 3' && valor(await leerAplicado(N), HORARIO) === 'De 7 a 3', boton)
    afirmar('edición encima: nada queda pendiente', (await pendienteDe(N)).items.length === 0)
    await publicarTodo(ana).catch(() => undefined)
    afirmar('edición encima: Publicar no resucita la edición', valor(await leerPublicado(N), HORARIO) === 'De 7 a 3')

    const dos = await aplicar(ana, poner(dato('horario', 'De 10 a 4')), poner(dato('pagos', 'Daviplata'), PAGOS))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('pagos', 'Nequi'), PAGOS))
    const segundo = await revertir(ana, dos)
    afirmar('dos claves, una editada encima: las dos salen', segundo.boton.tipo === 'aplicado' && valor(await leerPublicado(N), HORARIO) === 'De 7 a 3' && valor(await leerPublicado(N), PAGOS) === 'Contraentrega', segundo.boton)
    afirmar('dos claves: lo aplicado queda igual a lo publicado', canon(await leerPublicado(N)) === canon(await leerAplicado(N)))
  },

  async frenoDevuelveLoQueTenian() {
    const N = await negocioAbierto('M')
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(dato('horario', 'De 7 a 3')))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const c = await aplicar(ana, poner(dato('horario', 'De 9 a 6')))
    await publicarTodo(ana)
    afirmar('freno enterrado: Publicar manda solo lo último', valor(await leerPublicado(N), HORARIO) === 'De 9 a 6')
    const { tarjeta, boton } = await revertir(ana, c)
    afirmar('freno enterrado: la tarjeta avisa que llega de una', tarjeta.advertencias.some((a) => a.includes('de una')), tarjeta)
    afirmar('freno enterrado: los Clientes vuelven a lo que tenían, y lo que nunca les llegó no sale', boton.tipo === 'aplicado' && valor(await leerPublicado(N), HORARIO) === 'De 7 a 3', { boton, publicado: valor(await leerPublicado(N), HORARIO) })
    afirmar('freno enterrado: la vista previa queda igual a los Clientes', valor(await leerAplicado(N), HORARIO) === 'De 7 a 3' && (await pendienteDe(N)).items.length === 0)
  },

  async devueltaNoSeSella() {
    const N = await negocioAbierto('N')
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(dato('horario', 'De 7 a 3')))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const deVuelta = await aplicar(ana, poner(dato('horario', 'De 7 a 3')))
    await aplicar(ana, poner(dato('pagos', 'Nequi'), PAGOS))
    await publicarTodo(ana)
    const { tarjeta, boton } = await revertir(ana, deVuelta)
    afirmar('devuelta: revertirla no avisa que llega a los Clientes', !tarjeta.advertencias.some((a) => a.includes('de una')), tarjeta)
    afirmar('devuelta: revertirla no les cambia nada a los Clientes', boton.tipo === 'aplicado' && valor(await leerPublicado(N), HORARIO) === 'De 7 a 3', { boton, publicado: valor(await leerPublicado(N), HORARIO) })
    afirmar('devuelta: lo revertido vuelve a la vista previa y queda pendiente', valor(await leerAplicado(N), HORARIO) === 'De 8 a 5' && (await pendienteDe(N)).items.some((i) => i.clave === HORARIO))
    afirmar('devuelta: lo otro sí se publicó', valor(await leerPublicado(N), PAGOS) === 'Nequi')
  },

  async lapidaDelFreno() {
    const N = await negocioAbierto('L')
    const ana = await duenoDe(N, 'Ana')
    const crear = await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await publicarTodo(ana)
    await aplicar(ana, { tipo: 'quitar', claves: [HORARIO] })
    const { tarjeta, boton } = await revertir(ana, crear)
    afirmar('lápida del freno: la tarjeta dice qué se quita', tarjeta.lineas.some((l) => l.startsWith('Deshacer: ') && l.length > 'Deshacer: '.length), tarjeta)
    afirmar('lápida del freno: los Clientes ya no lo tienen', boton.tipo === 'aplicado' && (await leerPublicado(N)).vigente(HORARIO) === null, boton)
    afirmar('lápida del freno: nada queda pendiente', (await pendienteDe(N)).items.length === 0)
  },

  async hecho2() {
    const N = await negocioAbierto('2')
    const ana = await duenoDe(N, 'Ana')
    const molino: Elemento = { tipo: 'producto', nombre: `Molino ${marca}`, descripcion: 'Manual', precio: el.comoMonto(120000), activo: true }
    const conMolino = await aplicar(ana, poner(molino))
    const claveMolino = (await leerAplicado(N)).vigentes('producto').find((v) => v.elemento.nombre === molino.nombre)!.clave
    const reglaDelMolino: Elemento = {
      tipo: 'regla',
      nombre: 'Pedido con molino',
      cuando: { tipo: 'pedido', condicion: { tipo: 'incluye', producto: claveMolino } },
      efectos: [{ tipo: 'abrir_caso', titulo: 'Pedido con molino' }],
      escenarios: { activan: [{ mensajeDelCliente: 'Quiero un molino para Pereira, calle 10 # 5-20', momento: null, pedido: null, esperado: { hace: ['crear_pedido', 'abrir_caso'], noHace: [] } }], noActivan: [] },
    }
    await aplicar(ana, poner(reglaDelMolino))
    await publicarTodo(ana)
    const huerfana = await pedir(ana, { tipo: 'revertir', propuesta: conMolino })
    afirmar('reversión huérfana: dice el camino que sí funciona, no «quítalos juntos»', huerfana.desenlace === 'corregir' && huerfana.problemas.some((p) => p.tipo === 'la_usa_algo_vigente') && !/juntos/.test(huerfana.resumen), huerfana)
    const quitarJuntos = await pedir(ana, { tipo: 'quitar', claves: [claveMolino] })
    afirmar('quitar lo que otro usa sí puede decir «quítalos juntos»', quitarJuntos.desenlace === 'corregir' && quitarJuntos.problemas.some((p) => p.tipo === 'referencia_huerfana'), quitarJuntos)
    const claveRegla = (await leerAplicado(N)).vigentes('regla')[0].clave
    await aplicar(ana, { tipo: 'quitar', claves: [claveRegla] })
    const propuesta = await pedir(ana, { tipo: 'revertir', propuesta: conMolino })
    if (propuesta.desenlace !== 'espera_al_dueno') throw new Error(propuesta.resumen)
    const primero = await aprobar(ana, propuesta.tarjeta.propuesta, propuesta.tarjeta.huella)
    afirmar('hecho 2: lo que rompería lo publicado no sale', primero.tipo === 'ya_no_cabe' && primero.problemas.some((p) => p.tipo === 'rompe_lo_publicado') && (await leerPublicado(N)).vigente(claveMolino) !== null, primero)
    await publicarTodo(ana)
    const segundo = await aprobar(ana, propuesta.tarjeta.propuesta, propuesta.tarjeta.huella)
    afirmar('hecho 2: después de Publicar, la misma tarjeta sí sale', segundo.tipo === 'aplicado' && (await leerPublicado(N)).vigente(claveMolino) === null, segundo)
  },

  async revertirSinPublicar() {
    const N = await negocioAbierto('S')
    const ana = await duenoDe(N, 'Ana')
    const antes = canon(await leerPublicado(N))
    const r = await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const { tarjeta, boton } = await revertir(ana, r)
    afirmar('sin publicar: no advierte a los Clientes y dice que solo sale de la vista previa', !tarjeta.advertencias.some((a) => a.includes('de una')) && boton.tipo === 'aplicado' && /vista previa/.test(boton.resumen), { tarjeta, boton })
    afirmar('sin publicar: lo publicado no cambia y no queda nada pendiente', canon(await leerPublicado(N)) === antes && (await pendienteDe(N)).items.length === 0)
  },

  async cambioDeRespuesta() {
    const N = await negocioAbierto('Y')
    const [ana, beto] = [await duenoDe(N, 'Ana'), await duenoDe(N, 'Beto')]
    const r = await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const carta = await pedir(ana, { tipo: 'revertir', propuesta: r })
    if (carta.desenlace !== 'espera_al_dueno') throw new Error(carta.resumen)
    afirmar('otro publicó antes del clic: la tarjeta no avisó nada', !carta.tarjeta.advertencias.some((a) => a.includes('de una')), carta.tarjeta)
    await publicarTodo(beto)
    const boton = await aprobar(ana, carta.tarjeta.propuesta, carta.tarjeta.huella)
    afirmar('otro publicó antes del clic: lo que no avisó no sale, y los Clientes lo siguen teniendo', boton.tipo === 'ya_no_cabe' && boton.problemas.some((p) => p.tipo === 'ya_se_publico') && valor(await leerPublicado(N), HORARIO) === 'De 8 a 5', boton)
    const [sigue] = await db.select({ estado: esquema.propuestas.estado }).from(esquema.propuestas).where(eq(esquema.propuestas.id, carta.tarjeta.propuesta))
    afirmar('otro publicó antes del clic: la tarjeta sigue esperando', sigue?.estado === 'espera_al_dueno', sigue)
    const otra = await pedir(ana, { tipo: 'revertir', propuesta: r })
    if (otra.desenlace !== 'espera_al_dueno') throw new Error(otra.resumen)
    afirmar('pedirlo otra vez: la tarjeta nueva avisa que llega de una', otra.tarjeta.advertencias.some((a) => a.includes('de una')), otra.tarjeta)
    const segundo = await aprobar(ana, otra.tarjeta.propuesta, otra.tarjeta.huella)
    afirmar('pedirlo otra vez: ahora sí les llega a los Clientes', segundo.tipo === 'aplicado' && (await leerPublicado(N)).vigente(HORARIO) === null, segundo)

    const ciudad = el.comoClave('dato:ciudad')
    const deAntes = await aplicar(ana, poner(dato('ciudad', 'Pereira'), ciudad))
    const vieja = await pedir(ana, { tipo: 'revertir', propuesta: deAntes })
    if (vieja.desenlace !== 'espera_al_dueno') throw new Error(vieja.resumen)
    await db.update(esquema.propuestas).set({ vistaPrevia: { lineas: vieja.vistaPrevia.lineas } }).where(eq(esquema.propuestas.id, vieja.tarjeta.propuesta))
    await publicarTodo(ana)
    const delCorte = await aprobar(ana, vieja.tarjeta.propuesta, vieja.tarjeta.huella)
    afirmar('una tarjeta de antes del corte no trae el campo: no se le pide nada', delCorte.tipo === 'aplicado' && valor(await leerPublicado(N), ciudad) === 'Manizales', delCorte)

    const base = await aplicar(ana, poner(dato('pagos', 'Nequi'), PAGOS))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('pagos', 'Daviplata'), PAGOS))
    const carta2 = await pedir(ana, { tipo: 'revertir', propuesta: base })
    if (carta2.desenlace !== 'espera_al_dueno') throw new Error(carta2.resumen)
    await publicarTodo(ana)
    const conflicto = await aprobar(ana, carta2.tarjeta.propuesta, carta2.tarjeta.huella)
    afirmar('otro publicó la edición de encima: da conflicto y no escribe', conflicto.tipo === 'conflicto' && valor(await leerPublicado(N), PAGOS) === 'Daviplata', conflicto)
  },

  async publicarYRevertirALaVez() {
    const N = await negocioAbierto('V')
    const ana = await duenoDe(N, 'Ana')
    const r = await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await publicarTodo(ana)
    await aplicar(ana, poner(dato('pagos', 'Nequi'), PAGOS))
    const carta = await pedir(ana, { tipo: 'revertir', propuesta: r })
    if (carta.desenlace !== 'espera_al_dueno') throw new Error(carta.resumen)
    const vista = (await pendienteDe(N)).huella
    const [pub, rev] = await Promise.all([publicarComo(ana, vista), aprobar(ana, carta.tarjeta.propuesta, carta.tarjeta.huella)])
    const publicado = await leerPublicado(N)
    afirmar('a la vez: terminan los dos', pub.tipo === 'publicado' && rev.tipo === 'aplicado', { pub, rev })
    afirmar('a la vez: en cualquier orden, sin el freno y con lo publicado', publicado.vigente(HORARIO) === null && valor(publicado, PAGOS) === 'Nequi', canon(publicado))

    const q = await aplicar(ana, poner(dato('horario', 'De 9 a 6')))
    const carta2 = await pedir(ana, { tipo: 'revertir', propuesta: q })
    if (carta2.desenlace !== 'espera_al_dueno') throw new Error(carta2.resumen)
    const vista2 = (await pendienteDe(N)).huella
    const [pub2, rev2] = await Promise.all([publicarComo(ana, vista2), aprobar(ana, carta2.tarjeta.propuesta, carta2.tarjeta.huella)])
    const horarioFinal = valor(await leerPublicado(N), HORARIO)
    const primeroRevertir = rev2.tipo === 'aplicado' && horarioFinal === null
    const primeroPublicar = rev2.tipo === 'ya_no_cabe' && rev2.problemas.some((p) => p.tipo === 'ya_se_publico') && pub2.tipo === 'publicado' && horarioFinal === 'De 9 a 6'
    afirmar('a la vez, sin publicar: si revierte primero no les llega; si publica primero, la tarjeta no sale de una', primeroRevertir || primeroPublicar, { pub2, rev2, horarioFinal })
  },

  async botonDeshacer() {
    const N = await negocioAbierto('K')
    const [ana, beto] = [await duenoDe(N, 'Ana'), await duenoDe(N, 'Beto')]
    const r = await pedirIndicador(ana, `Confirmados ${marca}`)
    if (r.desenlace !== 'aplicado' || !r.tarjeta) throw new Error(`pedirIndicador dio ${r.desenlace}: ${r.resumen}`)
    const { tarjeta } = r
    afirmar('Deshacer: un Indicador queda aplicado, con su tarjeta de Deshacer', tarjeta.accion === 'deshacer')
    const lista = await pendienteDe(N)
    afirmar('Deshacer: cuenta como pendiente y solo lo ve el equipo', lista.items.length === 1 && lista.items[0].loNotan === 'equipo' && lista.items[0].aplicadoPor === 'Ana', lista.items)
    afirmar('Deshacer: una huella ajena no suelta nada', (await deshacer(ana, tarjeta.propuesta, 'f'.repeat(64))).tipo === 'no_existe')
    const otroNegocio = await duenoDe(await negocioAbierto('J'), 'Julia')
    afirmar('Deshacer: desde otro Negocio no suelta nada', (await deshacer(otroNegocio, tarjeta.propuesta, tarjeta.huella)).tipo === 'no_existe')
    const clics = await Promise.all([deshacer(ana, tarjeta.propuesta, tarjeta.huella), deshacer(beto, tarjeta.propuesta, tarjeta.huella)])
    const aplicadas = await db.$count(esquema.propuestas, and(eq(esquema.propuestas.revierte, tarjeta.propuesta), eq(esquema.propuestas.estado, 'aplicada')))
    afirmar('doble Deshacer: queda una sola reversión aplicada', aplicadas === 1, { aplicadas, clics })
    afirmar('doble Deshacer: el Indicador se fue', (await leerAplicado(N)).vigentes('indicador').length === 0)
    afirmar('Deshacer: creado y deshecho no deja nada pendiente', (await pendienteDe(N)).items.length === 0)
    afirmar('Deshacer: un clic posterior responde deshecho', (await deshacer(ana, tarjeta.propuesta, tarjeta.huella)).tipo === 'deshecho')
    const [quien] = await db.select({ por: esquema.propuestas.aprobadoPor }).from(esquema.propuestas).where(and(eq(esquema.propuestas.revierte, tarjeta.propuesta), eq(esquema.propuestas.estado, 'aplicada')))
    afirmar('Deshacer: queda quién tocó', quien?.por === ana.dueno || quien?.por === beto.dueno, quien)
    const [enAna, enBeto] = [await lineasDelHilo(ana, /revirtió/), await lineasDelHilo(beto, /revirtió/)]
    afirmar('Deshacer: deja una sola línea en el Hilo de cada Dueño', enAna.length === 1 && enBeto.length === 1, { enAna, enBeto })

    const regla = await pedir(ana, poner(SIEMPRE_SIN_PLAZO))
    if (regla.desenlace !== 'espera_al_dueno') throw new Error(regla.resumen)
    afirmar('Deshacer: una regla espera Aplicar y Descartar, no Deshacer', regla.tarjeta.accion === 'aplicar')
    await aprobar(ana, regla.tarjeta.propuesta, regla.tarjeta.huella)
    afirmar('Deshacer: este botón no suelta una regla', (await deshacer(ana, regla.tarjeta.propuesta, regla.tarjeta.huella)).tipo === 'no_existe' && (await leerAplicado(N)).vigentes('regla').length === 1)
    await publicarTodo(ana)

    const r2 = await pedirIndicador(ana, `Publicado ${marca}`)
    if (r2.desenlace !== 'aplicado' || !r2.tarjeta) throw new Error(r2.resumen)
    await publicarTodo(ana)
    const clave = (await leerPublicado(N)).vigentes('indicador')[0].clave
    const d = await deshacer(ana, r2.tarjeta.propuesta, r2.tarjeta.huella)
    afirmar('Deshacer lo publicado: sale también de lo publicado, sin Publicar', d.tipo === 'deshecho' && (await leerPublicado(N)).vigente(clave) === null && (await leerAplicado(N)).vigente(clave) === null, d)
  },

  async panelNoLlegaALosClientes() {
    const N = await negocioAbierto('P')
    const ana = await duenoDe(N, 'Ana')
    const creado = await pedirIndicador(ana, `Confirmados ${marca}`)
    if (creado.desenlace !== 'aplicado') throw new Error(creado.resumen)
    await publicarTodo(ana)
    const clave = (await leerPublicado(N)).vigentes('indicador')[0].clave
    const [fila] = await db.select({ version: esquema.propuestas.version }).from(esquema.propuestas).where(eq(esquema.propuestas.id, creado.propuesta))

    const conPromesa = await conTransaccion<Awaited<ReturnType<typeof escribir>>>((tx, abortar) =>
      escribir(tx, N, { tipo: 'propuesta', propuesta: null }, { elementos: [{ clave, base: el.comoVersion(fila.version!), despues: null }], filas: [] }, { version: el.comoVersion(fila.version!), soloVistaPrevia: [clave] }).then(abortar),
    )
    afirmar('Panel: un freno no cuenta como llegado a los Clientes, ni choca con lo que prometió la tarjeta', conPromesa.tipo === 'escrito' && conPromesa.deUna === 0, conPromesa)

    const r = await pedir(ana, { tipo: 'revertir', propuesta: creado.propuesta })
    afirmar('Panel: revertir un Indicador publicado sale sin botón y no avisa a los Clientes', r.desenlace === 'aplicado' && !r.vistaPrevia.advertencias?.some((a) => a.includes('de una')), r)
    afirmar('Panel: lo que responde no dice que les llegó a los Clientes', !/les llegó|les llega/i.test(r.resumen), r.resumen)
    afirmar('Panel: el Indicador sí sale de lo publicado', (await leerPublicado(N)).vigente(clave) === null && (await leerAplicado(N)).vigente(clave) === null)
  },

  async botonDescartar() {
    const N = await negocioAbierto('X')
    const ana = await duenoDe(N, 'Ana')
    const filas = () => db.$count(esquema.elementos, eq(esquema.elementos.negocioId, N))
    const antes = await filas()
    const r = await pedir(ana, poner(dato('horario', 'De 8 a 5')))
    if (r.desenlace !== 'espera_al_dueno') throw new Error(r.resumen)
    afirmar('Descartar: la tarjeta de un conocimiento ofrece Aplicar y no ha escrito nada', r.tarjeta.accion === 'aplicar' && (await filas()) === antes)
    const d = await descartar(ana, r.tarjeta.propuesta)
    afirmar('Descartar: sin fila en elementos y sin nada pendiente', d.tipo === 'descartada' && (await filas()) === antes && (await pendienteDe(N)).items.length === 0, d)
  },

  async verNegocio() {
    const N = await negocioAbierto('W')
    const ana = await duenoDe(N, 'Ana')
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, N))
    const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, ana.dueno))
    const agente = crearAgenteDelDueno(ana, { negocio, dueno })
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const r = (await (agente.tools.ver_negocio as { execute: (i: object, o: object) => Promise<{ sinPublicar: { linea: string; loNotan: string }[] }> }).execute({}, {}))
    afirmar('ver_negocio: dice lo que falta por publicar y si lo notan los Clientes', r.sinPublicar.length === 1 && r.sinPublicar[0].loNotan === 'clientes', r.sinPublicar)
    afirmar('instrucciones: dice que Publicar es del Dueño', /Publicar/.test(agente.system))
  },

  async corte() {
    const N = await negocioAbierto('Z')
    const { rows } = await db.execute(sql`select column_default, is_nullable from information_schema.columns where table_name = 'elementos' and column_name = 'sin_publicar'`)
    afirmar('corte: la columna nace en false, sin nulos', rows[0]?.column_default === 'false' && rows[0]?.is_nullable === 'NO', rows)
    const [n] = await db.select({ version: esquema.negocios.version }).from(esquema.negocios).where(eq(esquema.negocios.id, N))
    // Como escribe el código viejo: sin nombrar la columna.
    await db.execute(sql`insert into elementos (negocio_id, clave, version, tipo, contrato, contenido, origen) values (${N}, 'dato:horario', ${n.version + 1}, 'dato', 1, ${JSON.stringify(dato('horario', 'De 8 a 5'))}::jsonb, 'propuesta')`)
    await db.update(esquema.negocios).set({ version: n.version + 1 }).where(eq(esquema.negocios.id, N))
    afirmar('corte: lo que escribe el código viejo se ve en lo publicado', valor(await leerPublicado(N), HORARIO) === 'De 8 a 5')
    afirmar('corte: y no queda pendiente', (await pendienteDe(N)).items.length === 0)
  },

  async volverAtras() {
    const N = await negocioAbierto('R')
    const ana = await duenoDe(N, 'Ana')
    const creado = await pedirIndicador(ana, `Publicado ${marca}`)
    if (creado.desenlace !== 'aplicado') throw new Error(creado.resumen)
    await publicarTodo(ana)
    const clave = (await leerPublicado(N)).vigentes('indicador')[0].clave
    await aplicar(ana, { tipo: 'quitar', claves: [clave] })
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await aplicar(ana, poner(dato('pagos', 'Nequi'), PAGOS))
    await aplicar(ana, poner(dato('ciudad', 'Pereira'), el.comoClave('dato:ciudad')))
    await aplicar(ana, poner(dato('ciudad', 'Manizales'), el.comoClave('dato:ciudad')))
    const antes = await db.$count(esquema.elementos, eq(esquema.elementos.negocioId, N))
    const publicado = canon(await leerPublicado(N))

    const enSeco = await retirarSinPublicar(N, { deVerdad: false })
    afirmar('volver atrás: en seco lista y no escribe', enSeco.length === 3 && (await db.$count(esquema.elementos, eq(esquema.elementos.negocioId, N))) === antes && (await filasSinPublicar(N)) > 0, enSeco)
    const deVerdad = await retirarSinPublicar(N, { deVerdad: true })
    afirmar('volver atrás: de verdad, lo que lee el código viejo es lo que los Clientes tenían', deVerdad.length === 3 && canon(await leerAplicado(N)) === publicado && canon(await leerPublicado(N)) === publicado, deVerdad)
    afirmar('volver atrás: nada queda pendiente, y una fila que nunca les llegó a los Clientes no se sella', (await pendienteDe(N)).items.length === 0 && (await filasSinPublicar(N)) > 0)
    const despues = await db.$count(esquema.elementos, eq(esquema.elementos.negocioId, N))
    afirmar('volver atrás: otra vez escribe 0', (await retirarSinPublicar(N, { deVerdad: true })).length === 0 && (await db.$count(esquema.elementos, eq(esquema.elementos.negocioId, N))) === despues)
    const quitadas = await quitarPanel(N, { deVerdad: true })
    afirmar('volver atrás: después, quitar-panel ve el Indicador que revivió', quitadas.includes(clave) && (await leerAplicado(N)).vigentes('indicador').length === 0, quitadas)

    const O = await negocioAbierto('O')
    const beto = await duenoDe(O, 'Beto')
    const otro = await pedirIndicador(beto, `Otro ${marca}`)
    if (otro.desenlace !== 'aplicado') throw new Error(otro.resumen)
    await publicarTodo(beto)
    const claveOtro = (await leerPublicado(O)).vigentes('indicador')[0].clave
    await aplicar(beto, { tipo: 'quitar', claves: [claveOtro] })
    const alReves = await quitarPanel(O, { deVerdad: true })
    await retirarSinPublicar(O, { deVerdad: true })
    afirmar('volver atrás: al revés, quitar-panel no ve la clave y queda viva: por eso retirar va primero', !alReves.includes(claveOtro) && (await leerAplicado(O)).vigente(claveOtro) !== null, alReves)
  },

  async candadoNoFrenaAlCliente() {
    const N = await negocioAbierto('G')
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const vista = (await pendienteDe(N)).huella
    const entraUnCliente = async (sufijo: string) => {
      const insercion = Promise.resolve(db.insert(esquema.clientes).values({ negocioId: N, telefono: `5734${marca}${sufijo}`, nombre: 'Camilo' }).returning({ id: esquema.clientes.id }))
      const quien = await Promise.race([insercion.then(() => 'termino' as const), new Promise<'espero'>((listo) => setTimeout(() => listo('espero'), 5000))])
      return { quien, insercion }
    }
    const conLaFilaTomada = (tomar: (tx: Parameters<typeof sellar>[0]) => Promise<unknown>, sufijo: string) =>
      conTransaccion<Awaited<ReturnType<typeof entraUnCliente>>>(async (tx, abortar) => {
        await tomar(tx)
        return abortar(await entraUnCliente(sufijo))
      })
    const conPublicar = await conLaFilaTomada((tx) => sellar(tx, N, vista), '1')
    await conPublicar.insercion
    afirmar('candado: con un Publicar sin terminar, un Cliente nuevo entra sin esperar', conPublicar.quien === 'termino', conPublicar.quien)
    const conAplicar = await conLaFilaTomada((tx) => escribir(tx, N, { tipo: 'propuesta', propuesta: null }, { elementos: [{ clave: PAGOS, base: el.comoVersion(1), despues: dato('pagos', 'Nequi') }], filas: [] }, null), '2')
    await conAplicar.insercion
    afirmar('candado: con un Aplicar sin terminar, un Cliente nuevo entra sin esperar', conAplicar.quien === 'termino', conAplicar.quien)
    afirmar('candado: lo que no terminó no quedó', (await pendienteDe(N)).items.length === 1 && (await leerPublicado(N)).vigente(HORARIO) === null)
  },

  async aislamiento() {
    const [A, B] = [await negocioAbierto('A'), await negocioAbierto('B')]
    const [ana, berta] = [await duenoDe(A, 'Ana'), await duenoDe(B, 'Berta')]
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    await aplicar(berta, poner(dato('horario', 'De 9 a 6')))
    const vistaDeA = (await pendienteDe(A)).huella
    const cruzado = await publicarComo(berta, vistaDeA)
    afirmar('aislamiento: la huella de A en B no publica nada', cruzado.tipo === 'cambio' && (await filasSinPublicar(A)) === 1 && (await filasSinPublicar(B)) === 1, cruzado)
    await publicarTodo(ana)
    afirmar('aislamiento: publicar en A no toca lo de B', (await filasSinPublicar(A)) === 0 && (await filasSinPublicar(B)) === 1 && (await leerPublicado(B)).vigente(HORARIO) === null)
  },

  async casoSinPublicar() {
    const N = await negocioAbierto('Q')
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    const telefono = `5732${marca}1`
    const [cliente] = await db.insert(esquema.clientes).values({ negocioId: N, telefono, nombre: 'Camilo', ultimoMensajeEntrante: new Date() }).returning({ id: esquema.clientes.id })
    const [caso] = await db.insert(esquema.casos).values({ negocioId: N, clienteId: cliente.id, titulo: 'Un Caso de prueba', estado: 'esperando_dueno' }).returning({ id: esquema.casos.id })
    const respuesta = await proponerRespuestaAlCaso(caso.id, 'Ya te confirmo, gracias por escribir')
    if (!respuesta.tarjeta) throw new Error(respuesta.resumen)
    const desde = envios.length
    const r = await aprobar(ana, respuesta.tarjeta.propuesta, respuesta.tarjeta.huella)
    const salidos = envios.slice(desde).filter((e) => e.telefono === telefono)
    afirmar('Caso: Enviar sale de una, con algo sin publicar', r.tipo === 'aplicado' && salidos.length === 1, { r, salidos })
    afirmar('Caso: lo que estaba sin publicar sigue sin publicar', (await pendienteDe(N)).items.length === 1 && (await leerPublicado(N)).vigente(HORARIO) === null)
  },

  async abrir() {
    const [n] = await db.insert(esquema.negocios).values({ nombre: `Café Por Abrir ${marca}`, codigo: `PUB${marca}AB`, rubro: 'café', estado: 'armando' }).returning({ id: esquema.negocios.id })
    creados.push(n.id)
    const N = marcar.negocio(n.id)
    const ana = await duenoDe(N, 'Ana')
    await aplicar(ana, poner(cafe(PRECIO_VIEJO)), poner(dato('ciudad', 'Manizales')))
    afirmar('abrir: mientras se arma todo nace publicado', (await filasSinPublicar(N)) === 0 && (await pendienteDe(N)).items.length === 0)
    const r = await abrirEnElAlta(ana)
    afirmar('abrir: abre sin nada que publicar', r.abierto && (await pendienteDe(N)).items.length === 0 && canon(await leerPublicado(N)) === canon(await leerAplicado(N)), r)
    const telefono = `5733${marca}1`
    const desde = envios.length
    await atenderMensaje(leerMensajeEntrante(eventoDeKapso({ wamid: `wamid.PUBLICAR.${marca}.abrir`, telefono, texto: '¿Qué café tienen?', nombre: 'Camilo' }))!, N)
    const salidos = envios.slice(desde).filter((e) => e.telefono === telefono)
    afirmar('abrir: el Cliente recibe respuesta y no la de falla técnica', salidos.length === 1 && !salidos[0].texto.includes('problema técnico'), salidos)
    await aplicar(ana, poner(dato('horario', 'De 8 a 5')))
    afirmar('abrir: lo que se aplica después ya espera Publicar', (await pendienteDe(N)).items.length === 1 && (await leerPublicado(N)).vigente(HORARIO) === null)
  },

  async acciones() {
    const f = ACCIONES.publicar
    afirmar('ACCIONES: solo el botón publica', f.actores.boton === 'libre' && f.actores.agente === 'nunca' && f.actores.vigilancia === 'nunca' && f.actores.panel === 'nunca', f.actores)
    afirmar('ACCIONES: no tiene herramienta y nadie la mueve', f.herramienta === null && f.mueve.quien === 'nadie', f)
    const N = await negocioAbierto('T')
    const ana = await duenoDe(N, 'Ana')
    const [negocio] = await db.select().from(esquema.negocios).where(eq(esquema.negocios.id, N))
    const [dueno] = await db.select().from(esquema.duenos).where(eq(esquema.duenos.id, ana.dueno))
    const herramientas = Object.keys(crearAgenteDelDueno(ana, { negocio, dueno }).todas)
    afirmar('ACCIONES: ninguna herramienta del Agente del dueño publica', herramientas.length > 0 && herramientas.every((h) => !/publi/i.test(h)), herramientas)
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
