/**
 * La salida: la tabla de `decidir` y la de `seCumple` en los dos modos. Sin modelo.
 *
 *   pnpm tsx scripts/probar-salida.mts
 */
import { config } from 'dotenv'
import { afirmar, capturarEnvios, capturarErrores, terminar } from './afirmar.mjs'
import type { Destinatario, HechosDeEnvio, IntencionDeEnvio, MotivoDeSilencio } from '../src/nucleo/salida/compuerta'

config({ path: '.env.local', quiet: true })
process.env.ENVIO_SIMULADO = '1'
capturarEnvios()
const errores = capturarErrores()

const { decidir, seCumple, ORDEN_DE_LA_COMPUERTA } = await import('../src/nucleo/salida/compuerta')
const { marcar } = await import('../src/nucleo/identidad')

try {
  console.log('\n=== 1. decidir ===')
  const A = marcar.negocio('00000000-0000-4000-8000-00000000000a')
  const B = marcar.negocio('00000000-0000-4000-8000-00000000000b')
  const CAMILA = marcar.cliente('00000000-0000-4000-8000-0000000000c1')
  const W = marcar.wamid('wamid.TABLA.1')
  const ahora = new Date('2026-10-28T15:00:00Z')
  const haceHoras = (h: number) => marcar.instante(new Date(ahora.getTime() - h * 3600_000))

  const enOrden: HechosDeEnvio = {
    ahora: marcar.instante(ahora),
    emergenciaGlobal: false,
    numeroPermitido: true,
    negocio: { modo: 'atendiendo', emergencia: false },
    cliente: { negocio: A },
    ultimoEntrante: haceHoras(1),
    respuestasAlMismoMensaje: 0,
  }
  const alCliente = { tipo: 'cliente', negocio: A, cliente: CAMILA } as const
  const sinNegocio = { tipo: 'telefono', telefono: '573000000999', negocio: null } as const
  const intencionDe = (clase: IntencionDeEnvio['clase'], destinatario: Destinatario = alCliente) =>
    (clase === 'respuesta'
      ? { clase, destinatario: alCliente, texto: 't', clave: 'k', enRespuestaA: W }
      : clase === 'resolucion_de_caso'
        ? { clase, destinatario: alCliente, texto: 't', clave: 'k', caso: null }
        : { clase, destinatario, texto: 't', clave: 'k', enRespuestaA: W }) as IntencionDeEnvio

  const CLASES = ['respuesta', 'resolucion_de_caso', 'aviso_del_nucleo'] as const
  const masDe24h = marcar.instante(new Date(ahora.getTime() - 24 * 3600_000 - 1000))
  type Fila = { caso: string; clase: IntencionDeEnvio['clase']; destinatario?: Destinatario; hechos: Partial<HechosDeEnvio>; esperado: 'sale' | MotivoDeSilencio }
  const TABLA: Fila[] = [
    ...CLASES.map((clase): Fila => ({ caso: 'todo en orden', clase, hechos: {}, esperado: 'sale' })),
    { caso: 'aviso a un teléfono sin Negocio que acaba de escribir', clase: 'aviso_del_nucleo', destinatario: sinNegocio, hechos: { negocio: null, cliente: null }, esperado: 'sale' },
    { caso: 'aviso a un teléfono sin Negocio que nunca escribió', clase: 'aviso_del_nucleo', destinatario: sinNegocio, hechos: { negocio: null, cliente: null, ultimoEntrante: null }, esperado: 'fuera_de_ventana' },
    { caso: 'aviso de un Negocio armando a un teléfono', clase: 'aviso_del_nucleo', destinatario: { ...sinNegocio, negocio: A }, hechos: { negocio: { modo: 'armando', emergencia: false }, cliente: null }, esperado: 'sale' },
    ...CLASES.map((clase): Fila => ({ caso: 'emergencia global', clase, hechos: { emergenciaGlobal: true }, esperado: 'emergencia' })),
    { caso: 'emergencia global también a un teléfono sin Negocio', clase: 'aviso_del_nucleo', destinatario: sinNegocio, hechos: { negocio: null, cliente: null, emergenciaGlobal: true }, esperado: 'emergencia' },
    { caso: 'emergencia del Negocio', clase: 'resolucion_de_caso', hechos: { negocio: { modo: 'atendiendo', emergencia: true } }, esperado: 'emergencia' },
    ...CLASES.map((clase): Fila => ({ caso: 'un Negocio en sombra no le habla a nadie', clase, hechos: { negocio: { modo: 'en_sombra', emergencia: false } }, esperado: 'negocio_en_sombra' })),
    { caso: 'sin número de Amanece', clase: 'respuesta', hechos: { numeroPermitido: false }, esperado: 'numero_no_permitido' },
    { caso: 'el Cliente es de otro Negocio', clase: 'respuesta', hechos: { cliente: { negocio: B } }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'el Cliente es de otro Negocio', clase: 'resolucion_de_caso', hechos: { cliente: { negocio: B } }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'a un aviso no le aplica otro Negocio', clase: 'aviso_del_nucleo', hechos: { cliente: { negocio: B } }, esperado: 'sale' },
    { caso: 'el Cliente no existe', clase: 'respuesta', hechos: { cliente: null }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'ventana: 24 h justas todavía sale', clase: 'respuesta', hechos: { ultimoEntrante: haceHoras(24) }, esperado: 'sale' },
    ...CLASES.map((clase): Fila => ({ caso: 'ventana: 24 h y un segundo', clase, hechos: { ultimoEntrante: masDe24h }, esperado: 'fuera_de_ventana' })),
    { caso: 'un Cliente que nunca escribió', clase: 'resolucion_de_caso', hechos: { ultimoEntrante: null }, esperado: 'fuera_de_ventana' },
    { caso: 'segunda respuesta al mismo mensaje', clase: 'respuesta', hechos: { respuestasAlMismoMensaje: 1 }, esperado: 'una_respuesta_por_mensaje' },
    { caso: 'aviso después de una respuesta al mismo mensaje', clase: 'aviso_del_nucleo', hechos: { respuestasAlMismoMensaje: 1 }, esperado: 'una_respuesta_por_mensaje' },
    { caso: 'una resolución no responde a un mensaje', clase: 'resolucion_de_caso', hechos: { respuestasAlMismoMensaje: 3 }, esperado: 'sale' },
    { caso: 'orden: todo mal, gana emergencia', clase: 'respuesta', hechos: { emergenciaGlobal: true, numeroPermitido: false, negocio: { modo: 'en_sombra', emergencia: true }, cliente: { negocio: B }, ultimoEntrante: null, respuestasAlMismoMensaje: 2 }, esperado: 'emergencia' },
    { caso: 'orden: sombra antes que número', clase: 'respuesta', hechos: { negocio: { modo: 'en_sombra', emergencia: false }, numeroPermitido: false }, esperado: 'negocio_en_sombra' },
    { caso: 'orden: otro Negocio antes que ventana', clase: 'respuesta', hechos: { cliente: { negocio: B }, ultimoEntrante: null }, esperado: 'destinatario_de_otro_negocio' },
    { caso: 'orden: ventana antes que una respuesta por mensaje', clase: 'respuesta', hechos: { ultimoEntrante: null, respuestasAlMismoMensaje: 1 }, esperado: 'fuera_de_ventana' },
  ]
  for (const f of TABLA) {
    const v = decidir(intencionDe(f.clase, f.destinatario), { ...enOrden, ...f.hechos })
    const dio = v.tipo === 'sale' ? 'sale' : v.motivo
    afirmar(`decidir · ${f.clase} · ${f.caso} → ${f.esperado}`, dio === f.esperado, dio)
  }

  console.log('\n=== 2. seCumple ===')
  const noSale = (motivo: MotivoDeSilencio) => ({ tipo: 'no_sale', motivo }) as const
  afirmar('seCumple: un sale nunca frena', !seCumple({ tipo: 'sale' }, 'observa') && !seCumple({ tipo: 'sale' }, 'hace_cumplir'))
  afirmar('seCumple observa: ningún no_sale frena', ORDEN_DE_LA_COMPUERTA.every((m) => !seCumple(noSale(m), 'observa')))
  afirmar('seCumple hace_cumplir: todo no_sale frena', ORDEN_DE_LA_COMPUERTA.every((m) => seCumple(noSale(m), 'hace_cumplir')))
} catch (e) {
  afirmar('probar-salida terminó sin error inesperado', false, e)
} finally {
  afirmar('probar-salida no registró errores', errores.length === 0, errores)
  terminar()
}
