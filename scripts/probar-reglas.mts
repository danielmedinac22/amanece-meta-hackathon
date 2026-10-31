/**
 * El turno del Agente de clientes con guiones en vez de modelo y el puerto en memoria: sin red ni base. Afirma lo que
 * hace el núcleo con las reglas del Dueño, `revisar` y la corrección.
 *
 *   pnpm tsx scripts/probar-reglas.mts
 */
import { config } from 'dotenv'
import { afirmar, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'

const { armarEstado } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
const { turno, entornoDeEnsayo, RESPALDO } = await import('../src/nucleo/clientes/turno')
const { puertoEnMemoria } = await import('../src/nucleo/clientes/acciones')
const { marcar } = await import('../src/nucleo/identidad')

type Elemento = import('../src/nucleo/estado/elementos').Elemento
type Regla = Extract<Elemento, { tipo: 'regla' }>
type Motores = import('../src/nucleo/clientes/turno').Motores
type ClienteDelTurno = import('../src/nucleo/clientes/turno').ClienteDelTurno

const { comoClave: clave, comoVersion: version, comoMonto: monto } = el
const CAFE = el.claveDeProducto.deId('00000000-0000-4000-8000-0000000000c1')
const SIN_USO = { inputTokens: 0, outputTokens: 0 }

function estadoCon(...extra: [string, Elemento][]) {
  const base: [string, Elemento][] = [
    ['dato:ciudad', { tipo: 'dato', campo: 'ciudad', valor: 'Manizales' }],
    ['dato:envios', { tipo: 'dato', campo: 'envios', valor: 'A todo el país, de 2 a 4 días hábiles.' }],
    [CAFE, { tipo: 'producto', nombre: 'Café 500 g', descripcion: 'Tueste medio', precio: monto(38000), activo: true }],
  ]
  const vigentes = [...base, ...extra].map(([c, e]) => ({ clave: clave(c), version: version(1), origen: { tipo: 'tablas_viejas' as const }, elemento: e }) as never)
  const identidad = { id: marcar.negocio('00000000-0000-4000-8000-00000000000e'), nombre: 'Café de Ensayo', rubro: 'café', codigo: 'ENSAYO', pais: 'CO', moneda: 'COP', zonaHoraria: 'America/Bogota', modo: 'atendiendo' } as const
  return armarEstado(identidad, version(1), vigentes)
}

const regla = (nombre: string, efectos: Regla['efectos']): [string, Elemento] => [
  `regla:${nombre}`,
  { tipo: 'regla', nombre, cuando: { tipo: 'siempre' }, efectos, escenarios: { activan: [{ mensajeDelCliente: '¿Cuándo llega?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] } },
]

const cliente: ClienteDelTurno = { id: marcar.cliente('00000000-0000-4000-8000-0000000000aa'), nombre: 'Camila', telefono: '573001112233', pedidos: [] }
const conversacion = (texto: string) => ({ cliente, historial: [], mensaje: { texto, wamid: marcar.wamid(`wamid.ENSAYO.${texto.length}`), enviadoEn: marcar.instante(new Date()) } })

/** Un guion: lo que "responde" el modelo y lo que "reescribe". Cuenta cuántas veces se llamó cada uno. */
function guion(responder: Motores['responder'] | string, reescribir: string | null = null) {
  const llamadas = { responder: 0, reescribir: 0, motivos: [] as string[] }
  const motores: Motores = {
    async responder(e) {
      llamadas.responder++
      return typeof responder === 'string' ? { texto: responder, uso: SIN_USO } : responder(e)
    },
    async reescribir(e) {
      llamadas.reescribir++
      llamadas.motivos.push(...e.motivos)
      if (reescribir === null) throw new Error('el guion no esperaba una corrección')
      return { texto: reescribir, uso: SIN_USO }
    },
  }
  return { motores, llamadas }
}

async function correr(estado: ReturnType<typeof estadoCon>, texto: string, motores: Motores) {
  const puerto = puertoEnMemoria(estado, cliente)
  const t = await turno(estado, conversacion(texto), entornoDeEnsayo(estado, cliente, puerto), motores)
  return { t, puerto }
}

try {
  console.log('\n=== Una regla siempre con pasar_al_dueno no llama al modelo ===')
  {
    const g = guion(async () => {
      throw new Error('no debía llamarse')
    })
    const { t, puerto } = await correr(estadoCon(regla('Todo al Dueño', [{ tipo: 'pasar_al_dueno', avisoAlCliente: 'Ya le paso tu mensaje a Ana.' }])), 'Quiero 2 cafés', g.motores)
    afirmar('pasar_al_dueno: el modelo no se llama', g.llamadas.responder === 0 && g.llamadas.reescribir === 0, g.llamadas)
    afirmar('pasar_al_dueno: el texto es el aviso de la regla', t.texto === 'Ya le paso tu mensaje a Ana.', t.texto)
    afirmar('pasar_al_dueno: queda un abrir_caso con la regla y ningún pedido', t.acciones.length === 1 && t.acciones[0].nombre === 'abrir_caso' && puerto.casos.length === 1 && puerto.casos[0].regla === 'regla:Todo al Dueño' && puerto.pedidos.length === 0, { acciones: t.acciones, casos: puerto.casos })
  }

  console.log('\n=== abrir_caso de salida ===')
  {
    const estado = estadoCon(regla('Avisar', [{ tipo: 'abrir_caso', titulo: 'Un Cliente escribió' }]))
    const { puerto } = await correr(estado, 'Hola', guion('¡Hola! ¿En qué te ayudo?').motores)
    afirmar('abrir_caso: si el modelo no lo abrió, lo abre el núcleo con la regla', puerto.casos.length === 1 && puerto.casos[0].titulo === 'Un Cliente escribió' && puerto.casos[0].regla === 'regla:Avisar', puerto.casos)
    const abre = guion(async ({ puerto: p }) => {
      await p.abrir_caso({ titulo: 'Lo abrió el modelo', detalle: '', pedido: null })
      return { texto: 'Ya se lo paso al equipo.', uso: SIN_USO }
    })
    const { puerto: otro } = await correr(estado, 'Hola', abre.motores)
    afirmar('abrir_caso: si el modelo ya lo abrió, el núcleo no abre otro', otro.casos.length === 1 && otro.casos[0].titulo === 'Lo abrió el modelo', otro.casos)
  }

  console.log('\n=== no_prometer ===')
  {
    const estado = estadoCon(regla('Sin fechas', [{ tipo: 'no_prometer', que: 'plazo' }]))
    const terco = guion('Te llega en 3 días hábiles.', 'Lo recibes mañana sin falta.')
    const { t, puerto } = await correr(estado, '¿Cuándo me llega?', terco.motores)
    afirmar('no_prometer dos veces: sale el respaldo fijo', t.texto === RESPALDO && t.corregido === 'respaldo', t.texto)
    afirmar('no_prometer dos veces: una sola corrección y un Caso del núcleo', terco.llamadas.reescribir === 1 && puerto.casos.some((c) => c.titulo === 'Respuesta frenada por el núcleo'), { llamadas: terco.llamadas, casos: puerto.casos })
    const corrige = guion('Te llega en 3 días hábiles.', 'Despachamos de lunes a viernes; la fecha exacta te la confirma el equipo.')
    const r2 = await correr(estado, '¿Cuándo me llega?', corrige.motores)
    afirmar('no_prometer corregido: sale la corrección, con el motivo a la vista del modelo', r2.t.corregido === 'si' && r2.t.texto.startsWith('Despachamos') && corrige.llamadas.motivos.some((m) => m.includes('plazos')), { texto: r2.t.texto, motivos: corrige.llamadas.motivos })
    const noAplica = guion('¡Claro! El café de tueste medio vale $38.000.')
    const r3 = await correr(estado, '¿Cuánto vale?', noAplica.motores)
    afirmar('una regla que no aplica no frena: sale el borrador sin corrección', r3.t.corregido === 'no' && noAplica.llamadas.reescribir === 0 && r3.t.texto === '¡Claro! El café de tueste medio vale $38.000.', r3.t)
  }

  console.log('\n=== no_decir, con tildes y mayúsculas distintas ===')
  {
    const estado = estadoCon(regla('Sin gratis', [{ tipo: 'no_decir', frases: ['envío gratis'] }]))
    const g = guion('Hoy el ENVIO GRATÍS va por nuestra cuenta.', 'El envío va incluido en el precio.')
    const { t } = await correr(estado, '¿Cuánto cuesta el envío?', g.motores)
    afirmar('no_decir: detecta la frase y sale la corrección', t.corregido === 'si' && t.violaciones.some((v) => v.efecto === 'no_decir'), t)
  }

  console.log('\n=== Sin reglas ===')
  {
    const g = guion('¡Hola! Tenemos café de Manizales.')
    const { t } = await correr(estadoCon(), 'Hola', g.motores)
    afirmar('sin reglas: una sola llamada al modelo y ninguna corrección', g.llamadas.responder === 1 && g.llamadas.reescribir === 0 && t.reglasActivas.length === 0 && t.corregido === 'no', { llamadas: g.llamadas, t })
    afirmar('sin reglas: la intención es del ensayo, no de producción', t.intencion.clave.startsWith('ensayo:'), t.intencion)
  }

  console.log('\n=== crear_pedido toma el total de cotizar ===')
  {
    const g = guion(async ({ puerto }) => {
      const r = await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad: 2 }], ciudad: 'Pasto' }, direccion: 'Calle 1' })
      return { texto: 'negado' in r ? 'No pude.' : `Listo, pedido #${r.numero} por $76.000. ¿Lo confirmas?`, uso: SIN_USO }
    })
    const { t, puerto } = await correr(estadoCon(), 'Quiero 2 cafés para Pasto, Calle 1', g.motores)
    afirmar('crear_pedido: el total sale del precio del producto', puerto.pedidos.length === 1 && puerto.pedidos[0].total === 76000, puerto.pedidos)
    afirmar('crear_pedido: el total cotizado respalda la cifra del texto', t.revision.tipo === 'pasa' && t.corregido === 'no', t.revision)
    const g2 = guion(async ({ puerto: p }) => {
      const r = await p.crear_pedido({ pedido: { items: [{ producto: clave('producto:nada'), cantidad: 1 }], ciudad: 'Pasto' }, direccion: 'Calle 1' })
      return { texto: 'negado' in r ? 'Ese producto no lo tenemos.' : 'Listo.', uso: SIN_USO }
    })
    const r2 = await correr(estadoCon(), 'Quiero algo raro', g2.motores)
    afirmar('crear_pedido: un producto que no existe no llega al puerto', r2.puerto.pedidos.length === 0 && r2.t.acciones.some((a) => a.nombre === 'crear_pedido' && a.detalle.startsWith('negado')), r2.t.acciones)
  }

  console.log('\n=== revisar ===')
  {
    const g = guion('Te lo dejo en $50.000 con envío.', 'El café de tueste medio vale $38.000.')
    const { t } = await correr(estadoCon(), '¿Cuánto vale?', g.motores)
    afirmar('revisar: una cifra sin respaldo pide una corrección', t.corregido === 'si' && g.llamadas.motivos.some((m) => m.includes('cifra')), { t, motivos: g.llamadas.motivos })
  }
} catch (e) {
  afirmar('probar-reglas terminó sin error inesperado', false, e)
} finally {
  terminar()
}
