/**
 * El turno del Agente de clientes con guiones en vez de modelo y el puerto en memoria: sin red ni base. Afirma lo que
 * hace el núcleo con las reglas del Dueño, `revisar` y la corrección.
 *
 *   pnpm tsx scripts/probar-reglas.mts
 */
import { config } from 'dotenv'
import { afirmar, capturarErrores, terminar } from './afirmar.mjs'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
const errores = capturarErrores()

const { armarEstado, nombresAjenos } = await import('../src/nucleo/estado')
const el = await import('../src/nucleo/estado/elementos')
const { turno, entornoDeEnsayo, pedidoDelCliente, RESPALDO } = await import('../src/nucleo/clientes/turno')
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

const cliente: ClienteDelTurno = { id: marcar.cliente('00000000-0000-4000-8000-0000000000aa'), nombre: 'Camila', telefono: '573001112233', pedidos: [], agenda: null }
const conversacion = (texto: string) => ({ cliente, historial: [], mensaje: { texto, wamid: marcar.wamid(`wamid.ENSAYO.${texto.length}`), enviadoEn: marcar.instante(new Date()) } })

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
    afirmar('pasar_al_dueno: queda un abrir_caso con la regla y ningún pedido', t.acciones.length === 1 && t.acciones[0].nombre === 'abrir_caso' && puerto.casos.length === 1 && puerto.casos[0].titulo === 'Regla: Todo al Dueño' && puerto.pedidos.length === 0, { acciones: t.acciones, casos: puerto.casos })
    afirmar('pasar_al_dueno: el Caso guarda el nombre de su regla', puerto.casos[0]?.reglas.join() === 'Todo al Dueño', puerto.casos)
  }

  console.log('\n=== abrir_caso de salida ===')
  {
    const estado = estadoCon(regla('Avisar', [{ tipo: 'abrir_caso', titulo: 'Un Cliente escribió' }]))
    const { puerto } = await correr(estado, 'Hola', guion('¡Hola! ¿En qué te ayudo?').motores)
    afirmar('abrir_caso: si el modelo no lo abrió, lo abre el núcleo con el título de la regla', puerto.casos.length === 1 && puerto.casos[0].titulo === 'Un Cliente escribió', puerto.casos)
    afirmar('abrir_caso: el Caso del núcleo guarda el nombre de su regla', puerto.casos[0]?.reglas.join() === 'Avisar', puerto.casos)
    const abre = guion(async ({ puerto: p }) => {
      await p.abrir_caso({ titulo: 'Lo abrió el modelo', detalle: '', pedido: null })
      return { texto: 'Ya se lo paso al equipo.', uso: SIN_USO }
    })
    const { puerto: otro } = await correr(estado, 'Hola', abre.motores)
    afirmar('abrir_caso: si el modelo ya lo abrió, el núcleo no abre otro', otro.casos.length === 1 && otro.casos[0].titulo === 'Lo abrió el modelo', otro.casos)
    afirmar('abrir_caso: una regla de siempre también la nombra el Caso del modelo que la reemplaza', otro.casos[0]?.reglas.join() === 'Avisar', otro.casos)
  }

  console.log('\n=== no_prometer ===')
  {
    const estado = estadoCon(regla('Sin fechas', [{ tipo: 'no_prometer', que: 'plazo' }]))
    const terco = guion('Te llega en 3 días hábiles.', 'Lo recibes mañana sin falta.')
    const { t, puerto } = await correr(estado, '¿Cuándo me llega?', terco.motores)
    afirmar('no_prometer dos veces: sale el respaldo fijo', t.texto === RESPALDO && t.corregido === 'respaldo', t.texto)
    afirmar('no_prometer dos veces: una sola corrección y un Caso del núcleo', terco.llamadas.reescribir === 1 && puerto.casos.some((c) => c.titulo === 'Respuesta frenada por el núcleo'), { llamadas: terco.llamadas, casos: puerto.casos })
    const otraVez = guion('Te llega el jueves.', 'Lo recibes mañana sin falta.')
    await turno(estado, conversacion('¿Y si pago hoy?'), entornoDeEnsayo(estado, cliente, puerto), otraVez.motores)
    const frenados = puerto.casos.filter((c) => c.titulo === 'Respuesta frenada por el núcleo')
    afirmar('respaldo dos veces: un solo Caso, con los dos mensajes en el detalle', frenados.length === 1 && frenados[0].detalle.includes('¿Cuándo me llega?') && frenados[0].detalle.includes('¿Y si pago hoy?'), puerto.casos)
    afirmar('una Respuesta frenada no nombra ninguna regla: la frena lo último que falló', frenados[0]?.reglas.length === 0, frenados)
    const corrige = guion('Te llega en 3 días hábiles.', 'Despachamos de lunes a viernes; la fecha exacta te la confirma el equipo.')
    const r2 = await correr(estado, '¿Cuándo me llega?', corrige.motores)
    afirmar('no_prometer corregido: sale la corrección, con el motivo a la vista del modelo', r2.t.corregido === 'si' && r2.t.texto.startsWith('Despachamos') && corrige.llamadas.motivos.some((m) => m.includes('plazos')), { texto: r2.t.texto, motivos: corrige.llamadas.motivos })
    const noAplica = guion('¡Claro! El café de tueste medio vale $38.000.')
    const r3 = await correr(estado, '¿Cuánto vale?', noAplica.motores)
    afirmar('una regla que no aplica no frena: sale el borrador sin corrección', r3.t.corregido === 'no' && noAplica.llamadas.reescribir === 0 && r3.t.texto === '¡Claro! El café de tueste medio vale $38.000.', r3.t)
  }

  console.log('\n=== Lo que ve el modelo de las reglas ===')
  {
    let system = ''
    const g = guion(async (e) => {
      system = e.system
      return { texto: '¡Hola! ¿En qué te ayudo?', uso: SIN_USO }
    })
    await correr(estadoCon(regla('Sin fechas', [{ tipo: 'no_prometer', que: 'plazo' }]), regla('Sin gratis', [{ tipo: 'no_decir', frases: ['envío gratis'] }])), 'Hola', g.motores)
    afirmar('el prompt trae las reglas en palabras para el modelo, no las del Dueño', system.includes('- No prometas fechas ni plazos de entrega.') && system.includes('- No digas «envío gratis».') && !system.includes('tu agente de clientes'), system.slice(system.indexOf('## Preferencias')))
  }

  console.log('\n=== Una regla vigente sin cumplidor no tumba el turno ===')
  {
    const deTema: [string, Elemento] = [
      'regla:Mayoristas',
      { tipo: 'regla', nombre: 'Mayoristas', cuando: { tipo: 'tema', tema: 'ventas al por mayor' }, efectos: [{ tipo: 'pasar_al_dueno', avisoAlCliente: 'Ya le aviso a Ana.' }], escenarios: { activan: [{ mensajeDelCliente: '¿Venden por mayor?', momento: null, pedido: null, esperado: { hace: [], noHace: [] } }], noActivan: [] } },
    ]
    const antes = errores.length
    const g = guion('Te llega en 3 días hábiles.', 'Despachamos de lunes a viernes.')
    const { t } = await correr(estadoCon(deTema, regla('Sin fechas', [{ tipo: 'no_prometer', que: 'plazo' }])), '¿Venden por mayor?', g.motores)
    const delTurno = errores.splice(antes).map((e) => e.join(' '))
    afirmar('sin cumplidor: el turno responde, la regla de tema se salta con un error y la de siempre sigue cumpliéndose', t.corregido === 'si' && t.reglasActivas.length === 1 && delTurno.some((e) => e.includes('regla:Mayoristas')), { t, delTurno })
  }

  console.log('\n=== Los otros Negocios que se vigilan ===')
  {
    const estado = estadoCon(['dato:descripcion', { tipo: 'dato', campo: 'descripcion', valor: 'Tostamos para Café Ladera y otras tiendas' }])
    const vigilados = nombresAjenos(['Trigo', 'Panadería Trigo y Leña', 'Café Ladera', 'Café de Ensayo'], estado)
    afirmar('habla_de_otro_negocio vigila solo nombres de dos palabras o más que el Negocio no nombra de sí', JSON.stringify(vigilados) === JSON.stringify(['Panadería Trigo y Leña']), vigilados)
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

  console.log('\n=== La regla de pedido se cumple en crear_pedido ===')
  {
    const manizales: [string, Elemento] = [
      'regla:Fuera de Manizales',
      {
        tipo: 'regla',
        nombre: 'Envíos fuera de Manizales',
        cuando: { tipo: 'pedido', condicion: { tipo: 'ciudad_fuera_de', ciudades: ['Manizales'] } },
        efectos: [
          { tipo: 'abrir_caso', titulo: 'Pedido fuera de Manizales' },
          { tipo: 'no_prometer', que: 'plazo' },
        ],
        escenarios: { activan: [{ mensajeDelCliente: 'Quiero 2 cafés para Pereira', momento: null, pedido: null, esperado: { hace: ['crear_pedido', 'abrir_caso'], noHace: [] } }], noActivan: [] },
      },
    ]
    const estado = estadoCon(manizales)
    const pide = (ciudad: string, cantidad: number, texto: string) =>
      guion(async ({ puerto }) => {
        await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad }], ciudad }, direccion: 'Calle 10 # 5-20' })
        return { texto, uso: SIN_USO }
      }, 'Listo, quedó tu pedido. La fecha de entrega te la confirma el equipo.')

    const pereira = await correr(estado, 'Quiero 2 cafés para Pereira, calle 10 # 5-20', pide('Pereira', 2, 'Listo, pedido creado por $76.000. Te llega el martes.').motores)
    afirmar('pedido a Pereira: el núcleo abre el Caso de la regla y la regla queda activa', pereira.puerto.casos.some((c) => c.titulo === 'Pedido fuera de Manizales') && pereira.t.reglasActivas.includes(clave('regla:Fuera de Manizales')), { casos: pereira.puerto.casos, activas: pereira.t.reglasActivas })
    afirmar('pedido a Pereira: el Caso guarda el nombre de la regla', pereira.puerto.casos.find((c) => c.titulo === 'Pedido fuera de Manizales')?.reglas.join() === 'Envíos fuera de Manizales', pereira.puerto.casos)
    afirmar('pedido a Pereira: "te llega el martes" se corrige por no_prometer', pereira.t.corregido === 'si' && pereira.t.violaciones.some((v) => v.efecto === 'no_prometer'), pereira.t)

    const enCasa = await correr(estado, 'Quiero 2 cafés para Manizales', pide('Manizales, Caldas', 2, 'Listo, pedido creado por $76.000. Te llega mañana.').motores)
    afirmar('pedido a "Manizales, Caldas": sin Caso, sin regla activa y "llega mañana" sale sin corrección', enCasa.puerto.casos.length === 0 && enCasa.t.reglasActivas.length === 0 && enCasa.t.corregido === 'no', { casos: enCasa.puerto.casos, t: enCasa.t })

    const hola = await correr(estado, 'Hola', guion('¡Hola! ¿Qué café te provoca?').motores)
    afirmar('un "hola" sin crear_pedido no activa la regla ni abre Caso', hola.puerto.casos.length === 0 && hola.t.reglasActivas.length === 0, hola.t)

    const conAbierto: ClienteDelTurno = {
      ...cliente,
      pedidos: [{ numero: 7, total: monto(76000), estado: 'pendiente', resumen: '2 x Café 500 g; Pereira', paraReglas: { borrador: { items: [{ producto: CAFE, cantidad: 2 }], ciudad: 'Pereira' }, total: monto(76000) } }],
    }
    const cuando = guion('Te llega en 3 días hábiles.', 'La fecha de entrega te la confirma el equipo por aquí.')
    const puertoAbierto = puertoEnMemoria(estado, conAbierto)
    const abierto = await turno(estado, { ...conversacion('¿Cuándo me llega?'), cliente: conAbierto }, entornoDeEnsayo(estado, conAbierto, puertoAbierto), cuando.motores)
    afirmar('con un pedido abierto a Pereira, "¿cuándo me llega?" se corrige y no abre otro Caso', abierto.corregido === 'si' && puertoAbierto.casos.length === 0 && abierto.reglasActivas.length === 1, { t: abierto, casos: puertoAbierto.casos })

    const reusado = guion(async ({ puerto }) => {
      await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad: 2 }], ciudad: 'Pereira' }, direccion: 'Calle 10' })
      return { texto: 'Listo, tu pedido quedó creado.', uso: SIN_USO }
    })
    const yaAbierto = { ...puertoEnMemoria(estado, cliente), abrir_caso: async () => ({ caso: marcar.caso('00000000-0000-4000-8000-0000000000ca'), nuevo: false }) }
    const otraVez = await turno(estado, conversacion('Quiero 2 cafés para Pereira'), entornoDeEnsayo(estado, cliente, yaAbierto), reusado.motores)
    afirmar('un Caso que el puerto reusa no vuelve en casosAbiertos: el Dueño no recibe el aviso dos veces', otraVez.acciones.some((a) => a.nombre === 'abrir_caso') && otraVez.casosAbiertos.length === 0, otraVez)

    const enUnTurno = (puerto: ReturnType<typeof puertoEnMemoria>, texto: string, motores: Motores) => turno(estado, conversacion(texto), entornoDeEnsayo(estado, cliente, puerto), motores)
    const aPereira = (cantidad: number, despues?: (p: Parameters<Motores['responder']>[0]['puerto'], numero: number) => Promise<unknown>) =>
      guion(async ({ puerto }) => {
        const r = await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad }], ciudad: 'Pereira' }, direccion: 'Calle 10' })
        if (despues && 'numero' in r) await despues(puerto, r.numero)
        return { texto: 'Listo, tu pedido quedó creado.', uso: SIN_USO }
      }).motores

    const lanza = { ...puertoEnMemoria(estado, cliente), crear_pedido: async () => Promise.reject(new Error('el INSERT falló')) }
    const fallido = await enUnTurno(
      lanza,
      'Quiero 2 cafés para Pereira',
      guion(async ({ puerto }) => {
        await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad: 2 }], ciudad: 'Pereira' }, direccion: 'Calle 10' }).catch(() => null)
        return { texto: 'Tuve un problema con tu pedido, ya lo reviso.', uso: SIN_USO }
      }).motores,
    )
    afirmar('un crear_pedido que lanza no activa la regla ni abre Caso', lanza.casos.length === 0 && fallido.reglasActivas.length === 0, { casos: lanza.casos, activas: fallido.reglasActivas })

    const dosPedidos = puertoEnMemoria(estado, cliente)
    await enUnTurno(dosPedidos, 'Quiero 2 cafés para Pereira', aPereira(2))
    await enUnTurno(dosPedidos, 'Y otro de 3 cafés para Pereira', aPereira(3))
    afirmar('dos pedidos distintos a Pereira del mismo Cliente: dos Casos, cada uno con su pedido', JSON.stringify(dosPedidos.casos.map((c) => c.pedido)) === '[1,2]', dosPedidos.casos)
    const mismoTurno = puertoEnMemoria(estado, cliente)
    await enUnTurno(mismoTurno, 'Quiero dos pedidos para Pereira', aPereira(2, (p) => p.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad: 4 }], ciudad: 'Pereira' }, direccion: 'Calle 11' })))
    afirmar('dos pedidos a Pereira en el mismo turno: dos Casos', JSON.stringify(mismoTurno.casos.map((c) => c.pedido)) === '[1,2]', mismoTurno.casos)

    const base7 = puertoEnMemoria(estado, cliente)
    const repite = { ...base7, crear_pedido: async ({ cotizacion }: { cotizacion: { total: ReturnType<typeof monto> } }) => ({ numero: 7, total: cotizacion.total }) }
    await enUnTurno(repite, 'Quiero 2 cafés para Pereira', aPereira(2))
    await enUnTurno(repite, 'Quiero 2 cafés para Pereira', aPereira(2))
    afirmar('el mismo pedido repetido reusa su Caso', base7.casos.length === 1 && base7.casos[0].pedido === 7 && base7.casos[0].detalle.split('Quiero 2 cafés').length === 3, base7.casos)

    const ajeno = puertoEnMemoria(estado, cliente)
    await enUnTurno(ajeno, 'Quiero 2 cafés para Pereira y tengo un reclamo', aPereira(2, (p) => p.abrir_caso({ titulo: 'Reclamo', detalle: 'Un reclamo', pedido: null })))
    afirmar('un abrir_caso del modelo sin pedido no apaga el Caso de la regla', ajeno.casos.length === 2 && ajeno.casos.some((c) => c.titulo === 'Pedido fuera de Manizales' && c.pedido === 1), ajeno.casos)
    afirmar('un Caso del modelo que no reemplaza nada no nombra la regla, y el de la regla sí', ajeno.casos.find((c) => c.titulo === 'Reclamo')?.reglas.length === 0 && ajeno.casos.find((c) => c.pedido === 1)?.reglas.join() === 'Envíos fuera de Manizales', ajeno.casos)
    const propio = puertoEnMemoria(estado, cliente)
    await enUnTurno(propio, 'Quiero 2 cafés para Pereira', aPereira(2, (p, numero) => p.abrir_caso({ titulo: 'Envío a Pereira', detalle: 'Fuera de Manizales', pedido: numero })))
    afirmar('un abrir_caso del modelo con el mismo pedido reemplaza al de la regla', propio.casos.length === 1 && propio.casos[0].titulo === 'Envío a Pereira', propio.casos)
    afirmar('el Caso del modelo que reemplaza al de la regla la nombra', propio.casos[0]?.reglas.join() === 'Envíos fuera de Manizales', propio.casos)

    const sinCiudad = puertoEnMemoria(estado, cliente)
    const vacia = await enUnTurno(
      sinCiudad,
      'Quiero 2 cafés',
      guion(async ({ puerto }) => {
        const r = await puerto.crear_pedido({ pedido: { items: [{ producto: CAFE, cantidad: 2 }], ciudad: ' ' }, direccion: 'Calle 10' })
        return { texto: 'negado' in r ? '¿A qué ciudad te lo envío?' : 'Listo.', uso: SIN_USO }
      }).motores,
    )
    afirmar('crear_pedido con la ciudad vacía queda negado: ni pedido ni Caso', sinCiudad.pedidos.length === 0 && sinCiudad.casos.length === 0 && vacia.acciones.some((a) => a.nombre === 'crear_pedido' && a.detalle.startsWith('negado')), vacia.acciones)
  }

  console.log('\n=== La ciudad se compara por su primer tramo ===')
  {
    const fuera = (ciudades: [string, ...string[]], ciudad: string) => el.seCumpleLaCondicion({ tipo: 'ciudad_fuera_de', ciudades }, { borrador: { items: [], ciudad }, total: monto(0) })
    afirmar('«Calima» está fuera de Cali', fuera(['Cali'], 'Calima'))
    afirmar('«Manizales, Caldas» no está fuera de Manizales', !fuera(['Manizales'], 'Manizales, Caldas'))
    afirmar('«Villamaría» está fuera de Manizales', fuera(['Manizales'], 'Villamaría'))
    afirmar('«Cali (Valle)» y «cali - centro» no están fuera de Cali', !fuera(['Cali'], 'Cali (Valle)') && !fuera(['Cali'], 'cali - centro'))
  }

  console.log('\n=== Un pedido con novedad sigue abierto ===')
  {
    const guardado = (estado: 'novedad' | 'entregado' | 'cancelado' | 'pendiente') => pedidoDelCliente({ numero: 7, total: 76000, estado, items: [{ productoId: '00000000-0000-4000-8000-0000000000c1', nombre: 'Café 500 g', cantidad: 2, precio: 38000 }], ciudad: 'Pereira', direccion: 'Calle 10' })
    afirmar('novedad y pendiente cuentan como abiertos; entregado y cancelado no', guardado('novedad').paraReglas !== null && guardado('pendiente').paraReglas !== null && guardado('entregado').paraReglas === null && guardado('cancelado').paraReglas === null)
  }

  console.log('\n=== total_desde e incluye ===')
  {
    const MOLINO = el.claveDeProducto.deId('00000000-0000-4000-8000-0000000000c2')
    const conRegla = (nombre: string, condicion: Extract<Regla['cuando'], { tipo: 'pedido' }>['condicion']): [string, Elemento] => [
      `regla:${nombre}`,
      { tipo: 'regla', nombre, cuando: { tipo: 'pedido', condicion }, efectos: [{ tipo: 'abrir_caso', titulo: nombre }], escenarios: { activan: [{ mensajeDelCliente: 'Quiero un pedido', momento: null, pedido: null, esperado: { hace: ['crear_pedido'], noHace: [] } }], noActivan: [] } },
    ]
    const molino: [string, Elemento] = [MOLINO, { tipo: 'producto', nombre: 'Molino manual', descripcion: '', precio: monto(120000), activo: true }]
    const estado = estadoCon(molino, conRegla('Pedido grande', { tipo: 'total_desde', monto: monto(100000) }), conRegla('Con molino', { tipo: 'incluye', producto: MOLINO }))
    const pedir = (items: { producto: typeof CAFE; cantidad: number }[]) =>
      guion(async ({ puerto }) => {
        await puerto.crear_pedido({ pedido: { items, ciudad: 'Manizales' }, direccion: 'Calle 1' })
        return { texto: 'Listo, tu pedido quedó creado.', uso: SIN_USO }
      }).motores
    const dos = await correr(estado, 'Quiero 2 cafés', pedir([{ producto: CAFE, cantidad: 2 }]))
    const tres = await correr(estado, 'Quiero 3 cafés', pedir([{ producto: CAFE, cantidad: 3 }]))
    const conMolino = await correr(estado, 'Quiero el molino', pedir([{ producto: MOLINO, cantidad: 1 }]))
    afirmar('total_desde 100.000: 2 x 38.000 no activa', dos.t.reglasActivas.length === 0 && dos.puerto.casos.length === 0, dos.t.reglasActivas)
    afirmar('total_desde 100.000: 3 x 38.000 activa', tres.t.reglasActivas.includes(clave('regla:Pedido grande')) && !tres.t.reglasActivas.includes(clave('regla:Con molino')), tres.t.reglasActivas)
    afirmar('incluye: activa solo con ese producto', conMolino.t.reglasActivas.includes(clave('regla:Con molino')) && conMolino.puerto.casos.some((c) => c.titulo === 'Con molino'), conMolino.t.reglasActivas)
    const enPalabras = el.condicionEnPalabras({ tipo: 'incluye', producto: MOLINO }, estado)
    afirmar('incluye: en palabras nombra el producto y no su clave', enPalabras.includes('Molino manual') && !enPalabras.includes(MOLINO), enPalabras)
  }

  console.log('\n=== revisar ===')
  {
    const g = guion('Te lo dejo en $50.000 con envío.', 'El café de tueste medio vale $38.000.')
    const { t } = await correr(estadoCon(), '¿Cuánto vale?', g.motores)
    afirmar('revisar: una cifra sin respaldo pide una corrección', t.corregido === 'si' && g.llamadas.motivos.some((m) => m.includes('cifra')), { t, motivos: g.llamadas.motivos })
    const conDomicilio = estadoCon(['dato:pagos', { tipo: 'dato', campo: 'pagos', valor: 'Nequi al 310 555 1234 o efectivo. El domicilio cuesta $6.000.' }])
    const legitima = guion('Son $38.000 más $6.000 del domicilio, $44.000 en total. Puedes pagar por Nequi al 310 555 1234.')
    const r2 = await correr(conDomicilio, '¿Cuánto es con domicilio y cómo pago?', legitima.motores)
    afirmar('revisar: el total más el domicilio de un dato y el Nequi del Negocio pasan sin corrección', r2.t.corregido === 'no' && r2.t.revision.tipo === 'pasa' && legitima.llamadas.reescribir === 0, r2.t.revision)
  }
} catch (e) {
  afirmar('probar-reglas terminó sin error inesperado', false, e)
} finally {
  afirmar('probar-reglas no registró otros errores', errores.length === 0, errores)
  terminar()
}
