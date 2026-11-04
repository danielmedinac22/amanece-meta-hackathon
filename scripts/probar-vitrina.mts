/**
 * La vitrina existe solo en `next dev` y no deja rastro en un build. Corre los tres servidores de verdad: dev sin base
 * de datos ni sesión (la vitrina pinta sin leer nada y /panel sigue pidiendo entrar) y build + start (404 en /vitrina).
 * Primero dev porque `next dev` toma un candado por carpeta: con otro `pnpm dev` abierto falla enseguida, no tras el
 * build. Ciérralo antes de correr esto. Tarda unos minutos por el build.
 *
 *   pnpm tsx scripts/probar-vitrina.mts
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pedirPublicar } from '../src/app/panel/tocar-publicar'
import { tocarTarjeta } from '../src/app/panel/tocar-tarjeta'
import { decisionesEnEspera, decisionQueEspera } from '../src/negocio/partes-del-hilo'
import { EMPIEZA_A_CORREGIR } from '../src/nucleo/armado-paso'
import { afirmar, terminar } from './afirmar.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const NEXT = join(RAIZ, 'node_modules/next/dist/bin/next')
const ESCENAS_ESPERADAS = ['panel-vacio', 'panel-armandose', 'panel-funcionando', 'panel-un-caso', 'panel-con-cambios', 'panel-recien-abierto', 'hoy-sin-ventas', 'hoy-agenda', 'hoy-agenda-sin-citas', 'agenda-lista', 'agenda-muchas', 'agenda-vacia', 'tablero-agenda-sin-citas', 'tablero-agenda-con-pedidos', 'hoy-lo-ultimo', 'pedidos-lista', 'pedidos-vacios', 'pedidos-muchos', 'clientes-tabla', 'clientes-vacios', 'clientes-muchos', 'casos-espera', 'casos-sin-boton', 'casos-vacios', 'casos-muchos', 'conversaciones-lista', 'conversacion-con-caso', 'conversaciones-vacias', 'conversaciones-muchas', 'tablero', 'tablero-vacio', 'tablero-agenda', 'tablero-armandose', 'tablero-muchos', 'seccion-propia', 'seccion-larga', 'seccion-sin-filas', 'seccion-fallo', 'operacion-sidebar-plegado', 'operacion-hilo-oculto', 'operacion-conversacion-flotante', 'operacion-llega-decision', 'telefono-tu-negocio', 'telefono-cajon', 'hilo-constancias', 'hilo-varias-decisiones', 'hilo-trabajando', 'componentes']
const ESCENAS_DE_PUBLICAR = ['publicar-indicador', 'publicar-indicador-tablero', 'publicar-indicador-pedidos', 'publicar-regla', 'publicar-seccion', 'publicar-seccion-sin-publicar', 'publicar-otro-dueno', 'publicar-falla', 'publicar-muchos']
const ESCENAS_DEL_ARMADO = ['armado-leyendo', 'armado-confirmar', 'armado-corregida', 'armado-no-corrigio', 'hilo-lectura-espera', 'armado-cobro', 'armado-cobro-con-mas-faltantes', 'armado-listo', 'armado-fuera-de-orden', 'armado-textos-largos']
const ESCENAS_DE_ALBA = ['alba', 'alba-al-armado']
const ESCENAS_DEL_CASO = ['caso-con-regla', 'caso-viejo', 'caso-desenlaces', 'caso-no-la-toma', 'casos-envio']
const RUTAS_DEL_PANEL = ['/panel', '/panel/casos', '/panel/conversaciones', '/panel/pedidos', '/panel/agenda', '/panel/clientes', '/panel/tablero', '/panel/ajustes', '/panel/secciones/una-seccion', '/panel/pedidos/un-pedido', '/panel/clientes/un-cliente']

const ancho = (selector: string) => `document.querySelector('${selector}').getBoundingClientRect().width`
const HILO = '[data-pano=hilo]'
const ESPACIO_DEL_HILO = '[data-slot=sidebar-inset] > [aria-hidden]'
const PESTANAS = 'nav[aria-label="Dónde estás"]'
const PUNTO = '[aria-label="Algo espera tu decisión"]'
/** `--clic` toma el primero que encuentra, y el primero es el del Hilo: esto toca el botón del lienzo o el del Hilo. */
const tocarEn = (pano: 'lienzo' | 'hilo', texto: string) => `--cierto=(() => { const b = [...document.querySelectorAll('[data-pano=${pano}] button')].find((x) => x.textContent.trim() === '${texto}'); if (!b) return false; b.click(); return true })()`
const enElPano = (pano: 'lienzo' | 'hilo', texto: string) => `--cierto=document.querySelector('[data-pano=${pano}]').innerText.includes('${texto}')`
const SIDEBAR_ABIERTO = `--cierto=${ancho('[data-slot=sidebar-gap]')} === 216`

const REDACTOR_DEL_CLIENTE = `document.querySelector('textarea[aria-label="Escríbele al Cliente"]')`
const ESCRIBIR_AL_CLIENTE = `--cierto=(() => { const t = ${REDACTOR_DEL_CLIENTE}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Ya voy'); t.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
// El Hilo también tiene su botón de enviar: `--clic` por el texto tocaría el primero.
const ENVIAR_AL_CLIENTE = `--cierto=(() => { ${REDACTOR_DEL_CLIENTE}.closest('form').requestSubmit(); return true })()`
const RECORRIDOS_DE_LA_TOMA: [string, string, string, ...string[]][] = [
  ['La toma: tomar da el tiempo y el redactor, y devolver vuelve al agente', 'conversaciones-lista', '1440', '--ve=Tu agente está atendiendo', `--cierto=${REDACTOR_DEL_CLIENTE} === null`, '--clic=Tomar la conversación', '--ve=La tienes tú', '--ve=vuelve a tu agente en 30 min', `--cierto=${REDACTOR_DEL_CLIENTE} !== null`, '--clic=Devolver al agente', '--ve=Tu agente está atendiendo', `--cierto=${REDACTOR_DEL_CLIENTE} === null`],
  ['La toma, teléfono: tomar y devolver caben', 'conversacion-tomada', '390', '--clic=DQDaniela Quintero', '--ve=La tienes tú', '--ve=vuelve a tu agente en 28 min', '--ve=Devolver al agente'],
  ['La toma: lo que escribió el Dueño se distingue del agente', 'conversacion-tomada', '1440', '--ve=Hola Daniela, soy Lucía', '--ve=Dueño', `--cierto=${REDACTOR_DEL_CLIENTE} !== null`],
  ['La toma: enviar vacía el redactor y dice Enviado', 'conversacion-tomada', '1440', ESCRIBIR_AL_CLIENTE, '--espera=100', ENVIAR_AL_CLIENTE, '--ve=Enviado.', `--cierto=${REDACTOR_DEL_CLIENTE}.value === ''`],
  ['La toma: otro Dueño ve quién la tiene y no le escribe', 'conversacion-de-otro', '1440', '--ve=La tiene Marcela', '--ve=vuelve a tu agente en 12 min', '--ve=Devolver al agente', `--cierto=${REDACTOR_DEL_CLIENTE} === null`],
  ['La toma: sin ventana no hay redactor y la pantalla lo dice', 'conversacion-tuya-sin-ventana', '1440', '--ve=La tienes tú', '--ve=WhatsApp no deja escribirle', `--cierto=${REDACTOR_DEL_CLIENTE} === null`],
  ['La toma: sin ventana no se ofrece tomarla', 'conversacion-sin-ventana', '1440', '--ve=Tu agente está atendiendo', '--ve=WhatsApp no deja escribirle', '--no-ve=Tomar la conversación'],
  ['La toma: un Cliente sin respuesta se ve y se puede tomar', 'conversacion-cliente-espera', '1440', '--ve=Este Cliente espera respuesta', '--ve=Tomar la conversación'],
  ['La toma: si tu agente alcanzó a responder, lo dice', 'conversacion-agente-terminando', '1440', '--ve=Tu agente alcanzó a responderle'],
  ['La toma: el tiempo llega a cero y vuelve a tu agente sin tocar nada', 'conversacion-por-vencer', '1440', '--ve=La tienes tú', '--ve=en menos de 1 min', '--espera=3500', '--ve=Tu agente está atendiendo', '--no-ve=La tienes tú'],
  ['La toma: si no salió lo dice y el texto se queda', 'conversacion-no-salio', '1440', ESCRIBIR_AL_CLIENTE, '--espera=100', ENVIAR_AL_CLIENTE, '--ve=No salió: pasaron más de 24 horas', `--cierto=${REDACTOR_DEL_CLIENTE}.value === 'Ya voy'`],
  ['La toma: si WhatsApp no lo tomó lo dice y el texto se queda', 'conversacion-whatsapp-no-lo-toma', '1440', ESCRIBIR_AL_CLIENTE, '--espera=100', ENVIAR_AL_CLIENTE, '--ve=WhatsApp no tomó tu mensaje', `--cierto=${REDACTOR_DEL_CLIENTE}.value === 'Ya voy'`],
  ['La toma: se acabó el tiempo, nada salió y vuelve a tu agente', 'conversacion-se-acabo-el-tiempo', '1440', ESCRIBIR_AL_CLIENTE, '--espera=100', ENVIAR_AL_CLIENTE, '--ve=Ya no tienes esta conversación y tu mensaje no salió', '--ve=Tu agente está atendiendo', '--ve=Lo que estabas escribiendo no salió', '--clic=Tomar la conversación', `--cierto=${REDACTOR_DEL_CLIENTE}.value === 'Ya voy'`],
  ['La toma: si no se sabe si salió, lo dice y no invita a reenviar', 'conversacion-sin-saber', '1440', ESCRIBIR_AL_CLIENTE, '--espera=100', ENVIAR_AL_CLIENTE, '--ve=Todavía no sé si le llegó'],
  ['La toma: el aviso del Hilo lleva a la conversación', 'hilo-aviso-de-la-toma', '1440', '--ve=Un Cliente te escribió en la conversación que tienes tomada', '--clic=Ver la conversación de Daniela Quintero', '--ve=Tomar la conversación'],
  ['La toma, teléfono: el aviso del Hilo cambia a Tu negocio', 'hilo-aviso-de-la-toma', '390', '--clic=Ver la conversación de Daniela Quintero', '--ve=Tomar la conversación'],
]

/** Recorridos con clics de verdad: lo que el Dueño nota al tocar la cáscara. Título, escena, ancho y pasos. */
const RECORRIDOS: [string, string, string, ...string[]][] = [
  ['PC: el sidebar mide 216 y el Hilo 348', 'panel-funcionando', '1440', SIDEBAR_ABIERTO, `--cierto=${ancho(HILO)} === 348`],
  ['PC: plegar el sidebar lo deja en íconos y lo abre otra vez', 'panel-funcionando', '1440', '--clic=Menú', `--cierto=${ancho('[data-slot=sidebar-gap]')} === 48`, '--clic=Menú', SIDEBAR_ABIERTO],
  ['PC: Ocultar deja la caja, el caret abre y pliega, y el pin la fija', 'panel-funcionando', '1440', '--ve=Hola, soy tu agente', '--clic=Ocultar', '--no-ve=Hola, soy tu agente', `--cierto=${ancho(ESPACIO_DEL_HILO)} === 0`, `--cierto=(() => { const c = document.querySelector('${HILO}').getBoundingClientRect(); const m = document.querySelector('[data-slot=sidebar-inset]').getBoundingClientRect(); return Math.abs(c.x + c.width / 2 - (m.x + m.width / 2)) < 1 && c.bottom < innerHeight })()`, '--clic=Ver la conversación', '--ve=Hola, soy tu agente', '--clic=Plegar la conversación', '--no-ve=Hola, soy tu agente', '--clic=Fijar la conversación', '--ve=Hola, soy tu agente', `--cierto=${ancho(HILO)} === 348`, `--cierto=${ancho(ESPACIO_DEL_HILO)} === 348`],
  ['PC: una decisión nueva abre sola la conversación, y plegarla se respeta', 'operacion-llega-decision', '1440', '--no-ve=Una clienta preguntó', '--espera=3000', '--ve=Una clienta preguntó', '--clic=Plegar la conversación', '--espera=500', '--no-ve=Una clienta preguntó'],
  ['PC: Ocultar con una decisión esperando deja la conversación abierta', 'panel-un-caso', '1440', '--clic=Ocultar', '--ve=Una clienta preguntó'],
  ['Sidebar: Casos muestra el número de Casos abiertos', 'panel-un-caso', '1440', `--cierto=document.querySelectorAll('[data-slot=sidebar-menu-badge]').length === 1 && document.querySelector('[data-slot=sidebar-menu-badge]').textContent.trim() === '1'`],
  ['Sidebar: sin Casos abiertos no hay número', 'panel-funcionando', '1440', `--cierto=document.querySelectorAll('[data-slot=sidebar-menu-badge]').length === 0`],
  ['Sidebar: cada Sección pinta lo suyo y dice si falta', 'panel-un-caso', '1440', '--clic=Pedidos con novedad', '--ve=Marcela Ríos', `--no-ve=Necesita tu ojo`, '--clic=Pedidos', '--ve=Por confirmar', `--cierto=document.querySelector('h1').textContent === 'Pedidos'`, '--clic=Conversaciones', '--ve=Tu agente está atendiendo', `--cierto=document.querySelector('h1').textContent === 'Conversaciones'`, '--clic=Casos', '--ve=Espera tu decisión', '--clic=Tablero', '--ve=14 pedidos', '--no-ve=Espera tu decisión', '--clic=Inicio', '--ve=Necesita tu ojo', '--no-ve=14 pedidos'],
  ['PC: Publicar vive en el encabezado del lienzo y abre su lista', 'panel-con-cambios', '1440', '--clic=Publicar', '--ve=Lo notan tus Clientes', `--ve=Vista previa`],
  ['Teléfono: Publicar va arriba y abre su lista', 'panel-con-cambios', '390', '--clic=Publicar', '--ve=Lo notan tus Clientes', `--cierto=document.querySelector('header').textContent.includes('Publicar')`],
  ['Inicio: la frase lleva sus cifras en negrita', 'panel-funcionando', '1440', '--ve=Esta semana vendiste', `--cierto=[...document.querySelectorAll('p b')].map((b) => b.textContent).join('|') === '$1.284.000|23 pedidos|13 de 14'`],
  ['Inicio: Decidir lleva a Casos sin navegar fuera', 'panel-un-caso', '1440', '--ve=Necesita tu ojo', '--clic=Decidir', '--ve=Espera tu decisión', '--no-ve=Necesita tu ojo'],
  ['Inicio en teléfono: Ver el pedido se queda en Tu negocio', 'panel-un-caso', '390', '--clic=Tu negocio', '--ve=Necesita tu ojo', '--clic=Ver el pedido', '--ve=Pedido #37', '--ve=Con novedad', '--no-ve=Necesita tu ojo', `--cierto=document.querySelector('[data-pano=lienzo]').checkVisibility()`],
  ['Inicio: recién abierto muestra el link y ninguna cifra', 'panel-recien-abierto', '1440', '--ve=Todavía no te ha escrito nadie.', '--no-ve=Necesita tu ojo', '--no-ve=Esta semana', `--evalua=(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.copiado = t; return Promise.resolve() } } }); return 'listo' })()`, '--clic=Copiar', '--ve=Copiado', `--cierto=window.copiado.startsWith('https://wa.me/')`],
  ['Inicio: con cero ventas no dice $0 y el ojo vacío dice qué sigue', 'hoy-sin-ventas', '1440', '--ve=Esta semana todavía no tienes ventas.', '--ve=la única conversación', '--ve=Nada por ahora', '--no-ve=$0'],
  ['Lo último: un mensaje largo sale recortado en una línea, y dice quién confirmó', 'hoy-lo-ultimo', '1440', '--ve=Mariana Ospina te escribió: «Hola, buenas tardes. Quería saber', '--ve=…»', '--ve=Daniela Quintero confirmó su pedido', '--no-ve=me quedó muy amargo'],
  ['Lo último: a 320 de ancho un link largo no desborda', 'hoy-lo-ultimo', '320', '--clic=Tu negocio', '--ve=Un cliente te escribió: «https://www.instagram.com', `--cierto=[...document.querySelectorAll('[data-pano=lienzo] li span')].every((s) => s.scrollWidth <= s.clientWidth)`],
  ['Inicio: una agenda habla de citas', 'hoy-agenda', '1440', '--ve=Esta semana tienes', '--ve=3 citas', '--ve=2 hoy', '--ve=3 de 4', '--ve=Tu agente le agendó una cita a Daniela Quintero', '--no-ve=vendiste', '--no-ve=te escribieron'],
  ['Inicio: una agenda sin citas no inventa cifras', 'hoy-agenda-sin-citas', '1440', '--ve=Esta semana todavía no tienes citas.', '--no-ve=citas,', '--no-ve=Tu agente le agendó'],
  ['Sidebar: una agenda lleva Agenda y sigue con Pedidos', 'hoy-agenda', '1440', `--cierto=[...document.querySelectorAll('[data-sidebar=menu-button], [data-slot=sidebar-menu-button]')].map((b) => b.textContent.trim()).join('|').includes('Inicio|Casos|Agenda|Conversaciones|Pedidos|Clientes|Tablero')`],
  ['Sidebar: una tienda no lleva Agenda', 'panel-funcionando', '1440', `--cierto=![...document.querySelectorAll('[data-slot=sidebar-menu-button]')].some((b) => b.textContent.trim() === 'Agenda')`],
  ['Agenda: agrupa y dice cada estado', 'agenda-lista', '1440', '--ve=Hoy', '--ve=Próximas', '--ve=Ya pasaron o se cancelaron', '--ve=Agendada', '--ve=Movida', '--ve=Cancelada', '--ve=Ya pasó', '--ve=antes jueves 5 de noviembre'],
  ['Agenda: dice cuántas no se ven', 'agenda-muchas', '1440', '--ve=Ves las 50 primeras de 312.'],
  ['Agenda: en teléfono', 'agenda-lista', '390', '--ve=Daniela Quintero', '--ve=Agendada'],
  ['Agenda: a 320 un nombre largo se recorta', 'agenda-lista', '320', '--ve=Una Clienta Con Un Nombre'],
  ['Agenda: vacía dice qué sigue, sin cifras', 'agenda-vacia', '1440', '--ve=Todavía no tienes citas.', '--no-ve=Agendada'],
  ['Agenda: tocar una cita lleva a su Cliente', 'agenda-lista', '1440', '--clic=Daniela Quintero', '--ve=Sus pedidos'],
  ['Teléfono: pestañas, punto y cajón', 'panel-un-caso', '390', '--ve=Una clienta preguntó', '--no-ve=Necesita tu ojo', `--cierto=!document.querySelector('${PUNTO}')`, '--clic=Tu negocio', '--ve=Necesita tu ojo', '--no-ve=Una clienta preguntó', `--cierto=!!document.querySelector('${PUNTO}')`, '--clic=Menú', '--ve=Conversaciones', '--clic=Casos', '--no-ve=Conversaciones', '--ve=Espera tu decisión', '--clic=Tu agente', '--ve=Una clienta preguntó', `--cierto=!document.querySelector('${PUNTO}')`],
  ['Teléfono: tocar una Sección lleva a Tu negocio', 'panel-funcionando', '390', '--clic=Menú', '--clic=Pedidos', '--ve=Por confirmar'],
  ['El corte: en 1023 son pestañas', 'panel-funcionando', '1023', `--cierto=document.querySelector('${PESTANAS}').checkVisibility()`, '--no-ve=Necesita tu ojo'],
  ['El corte: en 1024 son tres paños', 'panel-funcionando', '1024', `--cierto=!document.querySelector('${PESTANAS}').checkVisibility()`, '--ve=Necesita tu ojo', `--cierto=${ancho(HILO)} === 348`],
  ['Movimiento: los paños usan la curva de DESIGN.md', 'panel-funcionando', '1440', `--cierto=(() => { const c = getComputedStyle(document.querySelector('${ESPACIO_DEL_HILO}')); return c.transitionDuration === '0.28s' && c.transitionTimingFunction === 'cubic-bezier(0.25, 1, 0.5, 1)' })()`, `--cierto=getComputedStyle(document.querySelector('[data-slot=sidebar-gap]')).transitionTimingFunction === 'cubic-bezier(0.25, 1, 0.5, 1)'`, '--clic=Ocultar', `--cierto=getComputedStyle(document.querySelector('${HILO}')).animationName === 'sube'`],
  ['Movimiento: con prefers-reduced-motion el estado cambia y nada se mueve', 'panel-funcionando', '1440', '--menos-movimiento', `--cierto=getComputedStyle(document.querySelector('${ESPACIO_DEL_HILO}')).transitionProperty === 'none'`, `--cierto=getComputedStyle(document.querySelector('[data-slot=sidebar-gap]')).transitionProperty === 'none'`, '--clic=Ocultar', '--no-ve=Hola, soy tu agente', `--cierto=getComputedStyle(document.querySelector('${HILO}')).animationName === 'none'`],
]

const LIENZO = `document.querySelector('[data-pano=lienzo] [class*=overflow-y-auto]')`
const ENCABEZADOS = `[...document.querySelectorAll('[data-pano=lienzo] h3, [data-pano=lienzo] summary')]`
const TONO_DE = (i: number, token: string) => `(() => { const b = ${ENCABEZADOS}[${i}].querySelector('[data-slot=badge]'); const p = document.createElement('i'); p.style.color = 'var(${token})'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return getComputedStyle(b).color === c })()`
const PEGA_ARRIBA = `(() => { const l = ${LIENZO}; l.scrollTop = 700; const h = document.querySelector('[data-pano=lienzo] h3'); return l.scrollTop === 700 && Math.abs(h.getBoundingClientRect().top - l.getBoundingClientRect().top) < 1 })()`
const SIN_DESPLAZAR = `(() => { const c = document.querySelector('[data-slot=table-container]'); return c.scrollWidth <= c.clientWidth })()`
const NOMBRE_RECORTADO = `(() => { const t = document.querySelector('[data-slot=table-cell]'); return t.scrollWidth > t.clientWidth && getComputedStyle(t).textOverflow === 'ellipsis' })()`

const BARRA = (n: number) => `document.querySelector('[data-pano=lienzo] ol[aria-label="Pedidos por día"] li:nth-child(${n})')`
const COLUMNA = (titulo: string) => `[...document.querySelectorAll('[data-pano=lienzo] th')].find((h) => h.textContent === '${titulo}')`
const ESCENAS_DE_320 = ['agenda-lista', 'agenda-vacia', 'tablero-agenda-sin-citas', 'tablero-agenda-con-pedidos', 'tablero', 'tablero-vacio', 'tablero-agenda', 'tablero-armandose', 'tablero-muchos', 'seccion-propia', 'seccion-larga', 'seccion-sin-filas', 'seccion-fallo']

const VENTANA_DE_PUBLICAR = '[data-slot=popover-content]'
/** El botón de abajo de la lista, no el que la abre: los dos dicen Publicar. */
const TOCAR_PUBLICAR = `--cierto=(() => { const b = [...document.querySelectorAll('${VENTANA_DE_PUBLICAR} button')].find((x) => x.textContent.trim() === 'Publicar'); if (!b) return false; b.click(); return true })()`
const PUNTEADOS = (n: number) => `--cierto=document.querySelectorAll('[data-pano=lienzo] .border-dashed').length === ${n}`
const HASTA_PUBLICADO = [TOCAR_PUBLICAR, '--ve=Publicando', '--ve=Publicado hace un momento. Todo está en tu link.', '--ve=Atendiendo', '--no-ve=Vista previa']

const RECORRIDOS_DEL_CASO: typeof RECORRIDOS = [
  ['Caso: dice su regla y lo que le toca al Dueño', 'caso-con-regla', '1440', '--ve=Por tu regla: si llega dañado, se repone sin costo.', '--ve=Por tu lado', '--ve=Separar una bolsa de 500 g'],
  ['Caso: lo mismo en teléfono', 'caso-con-regla', '390', '--ve=Por tu regla: si llega dañado', '--ve=Separar una bolsa'],
  ['Caso: uno de antes no muestra esos bloques ni dice nada adivinado', 'caso-viejo', '1440', '--ve=Le voy a responder', '--no-ve=Por tu regla', '--no-ve=Por tu lado'],
  ['Caso al recargar: solo lo que salió dice Enviada', 'caso-desenlaces', '1440', '--ve=Enviada a Camila Rojas', '--ve=WhatsApp no la tomó. Escríbele tú directamente.', '--ve=No salió: pasaron más de 24 horas', '--ve=Todavía no sé si le llegó. Si no cambia en un momento, escríbele tú.', `--cierto=document.querySelectorAll('[data-pano=hilo] .text-bien').length === 1 && [...document.querySelectorAll('[data-pano=hilo] *')].filter((e) => e.children.length === 0 && e.textContent.includes('Enviada')).length === 1`],
  ['Caso al recargar: a 320 de ancho la frase larga cabe', 'caso-desenlaces', '320', '--ve=No salió: pasaron más de 24 horas'],
  ['Caso: tocar Enviar y que WhatsApp no la tome no dice Enviada, ni al reabrir el detalle', 'caso-no-la-toma', '1440', '--ve=Sale por WhatsApp a Camila Rojas', '--clic=Enviar', '--ve=WhatsApp no la tomó. Escríbele tú directamente.', '--no-ve=Enviada', '--no-ve=Le voy a responder', '--clic=Ver el detalle', '--ve=Le voy a responder', '--ve=Por tu lado', '--ve=WhatsApp no la tomó', '--no-ve=Enviada'],
  ['Caso: tocar Enviar cuando sale dice Enviada', 'caso-con-regla', '1440', '--clic=Enviar', '--ve=Enviada a Camila Rojas'],
  ['Casos: en Resueltos solo avisa lo que no salió, y un Caso sin tarjeta trae su regla', 'casos-envio', '1440', '--ve=Por tu regla: pedidos para fuera de Manizales.', '--ve=Preguntarle a la transportadora', '--ve=WhatsApp no la tomó. Escríbele tú directamente.', '--ve=Todavía no sé si le llegó', '--ve=Resuelto antes de esta salida', `--cierto=document.querySelectorAll('[data-pano=lienzo] li .text-ojo').length === 6`],
]

const RECORRIDOS_DE_PUBLICAR: typeof RECORRIDOS = [
  ['Publicar, PC: un Indicador en la vista previa hasta Publicado', 'publicar-indicador', '1440', '--ve=Vista previa', '--ve=Deshacer', PUNTEADOS(1), '--clic=Publicar', '--ve=Solo lo ven tú y tu equipo', ...HASTA_PUBLICADO, '--ve=Lucía publicó: Indicador nuevo', '--ve=Publicada', '--no-ve=Deshacer', PUNTEADOS(0), `--cierto=!document.querySelector('[data-pano=lienzo]').innerText.includes('Pedidos confirmados por día')`],
  ['Publicar, teléfono: arriba, y el lienzo cambia con él', 'publicar-indicador', '390', `--cierto=document.querySelector('header').textContent.includes('Publicar')`, '--clic=Tu negocio', '--ve=Vista previa', PUNTEADOS(1), '--clic=Publicar', ...HASTA_PUBLICADO, PUNTEADOS(0)],
  ['Publicar: en el Tablero el Indicador se queda, ya sin puntear', 'publicar-indicador-tablero', '1440', PUNTEADOS(1), '--clic=Publicar', ...HASTA_PUBLICADO, PUNTEADOS(0), `--cierto=document.querySelector('[data-pano=lienzo]').innerText.includes('Pedidos confirmados por día')`],
  ['Publicar: encima de Pedidos sale al publicarlo', 'publicar-indicador-pedidos', '1440', PUNTEADOS(1), '--clic=Publicar', ...HASTA_PUBLICADO, `--cierto=!document.querySelector('[data-pano=lienzo]').innerText.includes('Pedidos confirmados por día')`],
  ['Publicar: una regla, de Aplicar a Publicada', 'publicar-regla', '1440', '--ve=Publicado', '--ve=Atendiendo', '--clic=Aplicar', '--ve=Aplicada', '--ve=Vista previa', '--ve=Queda en la vista previa', '--clic=Publicar', '--ve=Lo notan tus Clientes', ...HASTA_PUBLICADO, '--ve=Lucía publicó: Regla nueva', '--ve=Publicada'],
  ['Publicar, teléfono: una regla, de Aplicar a Publicada', 'publicar-regla', '390', '--clic=Aplicar', '--ve=Aplicada', '--clic=Publicar', '--ve=Lo notan tus Clientes', TOCAR_PUBLICAR, '--ve=Publicado hace un momento. Todo está en tu link.', '--ve=Publicada', '--clic=Tu negocio', '--ve=Atendiendo'],
  ['Publicar: Descartar una regla no deja nada sin publicar', 'publicar-regla', '1440', '--clic=Descartar', '--ve=Descartada', '--ve=Atendiendo', '--no-ve=Vista previa'],
  ['Publicar: Deshacer deja todo como estaba', 'publicar-indicador', '1440', '--clic=Deshacer', '--ve=Deshecha', '--ve=Atendiendo', '--no-ve=Vista previa', PUNTEADOS(0)],
  ['Publicar: sin movimiento, el estado cambia igual', 'publicar-indicador', '1440', '--menos-movimiento', '--clic=Publicar', ...HASTA_PUBLICADO, '--ve=Publicada'],
  ['Publicar: el único link es el de WhatsApp, con copiar y abrir', 'panel-con-cambios', '1440', '--clic=Publicar', '--ve=Tus Clientes te escriben aquí', '--no-ve=amanece.co', '--no-ve=Tu Panel', `--cierto=(() => { const a = document.querySelectorAll('${VENTANA_DE_PUBLICAR} a'); return a.length === 1 && a[0].href.startsWith('https://wa.me/') && a[0].target === '_blank' })()`, `--cierto=(() => { navigator.clipboard.writeText = async (t) => { window.copiado = t }; return true })()`, '--clic=Copiar Tus Clientes', `--cierto=window.copiado.startsWith('https://wa.me/') && window.copiado.includes('%20') && !!document.querySelector('[aria-label=Copiado]')`, `--ve=wa.me/000000000000?text=(LADERA) Hola Café Ladera`],
  ['Publicar: sin nada pendiente dice que está todo', 'panel-funcionando', '1440', '--ve=Publicado', '--ve=Atendiendo', '--clic=Publicado', '--ve=Todo está en tu link. No hay nada sin publicar.', '--no-ve=Sin publicar'],
  ['Publicar: la lista pone primero lo que notan los Clientes', 'panel-con-cambios', '1440', '--clic=Publicar', `--cierto=(() => { const t = document.querySelector('${VENTANA_DE_PUBLICAR} ul').innerText; return t.indexOf('Lo notan tus Clientes') < t.indexOf('Solo lo ven tú y tu equipo') })()`],
  ['Publicar: si otro Dueño aplicó algo, no publica y vuelve la lista nueva', 'publicar-otro-dueno', '1440', '--clic=Publicar', TOCAR_PUBLICAR, '--ve=Alguien aplicó algo más', '--ve=Aplicada por Julián', '--ve=Vista previa', ...HASTA_PUBLICADO, '--no-ve=Alguien aplicó'],
  ['Publicar: si falla lo dice, y se vuelve a tocar', 'publicar-falla', '1440', '--clic=Publicar', TOCAR_PUBLICAR, '--ve=No pude publicar. Vuelve a tocar el botón en un momento.', '--ve=Vista previa', ...HASTA_PUBLICADO, '--no-ve=No pude publicar'],
  ['Publicar: una lista larga no se sale de la pantalla del teléfono', 'publicar-muchos', '390', '--clic=Publicar', `--cierto=(() => { const r = document.querySelector('${VENTANA_DE_PUBLICAR}').getBoundingClientRect(); return r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth })()`, `--cierto=(() => { const u = document.querySelector('${VENTANA_DE_PUBLICAR} ul'); return u.scrollHeight > u.clientHeight })()`],
  ['Publicar: la primera Sección entra al sidebar con su animación y se ve punteada', 'publicar-seccion', '1440', `--no-ve=Tus secciones`, `--cierto=(() => { new MutationObserver(() => { const e = [...document.querySelectorAll('[data-sidebar=menu-item],[data-slot=sidebar-menu-item]')].find((x) => x.textContent.includes('Pedidos por ciudad')); if (e && window.entrada === undefined) window.entrada = e.style.opacity }).observe(document.body, { childList: true, subtree: true }); return true })()`, '--espera=3200', '--ve=Tus secciones', `--cierto=window.entrada === '0'`, '--ve=Vista previa', '--clic=Pedidos por ciudad', PUNTEADOS(1)],
  ['Publicar: una Sección sin publicar se ve punteada en su ruta', 'publicar-seccion-sin-publicar', '1440', PUNTEADOS(1), '--clic=Publicar', ...HASTA_PUBLICADO, PUNTEADOS(0)],
  ['Constancias: lo publicado dice Publicada y ya no ofrece Deshacer', 'hilo-constancias', '1440', '--ve=Publicada', `--cierto=![...document.querySelectorAll('[data-conversacion] button')].some((b) => b.textContent.trim() === 'Deshacer')`],
]

const LLENAR_ENTRADA = `--cierto=(() => { for (const [n, v] of [['nombre', 'Lucía'], ['email', 'lucia@cafe.co'], ['password', 'una-clave-larga']]) { const c = document.querySelector('[name=' + n + ']'); if (c) c.value = v } return true })()`
const REDACTOR_DICE = (texto: string) => `--cierto=(() => { const c = document.querySelector('[data-pano=hilo] textarea'); return c.value === '${texto}' && document.activeElement === c && c.selectionStart === c.value.length })()`
const EL_TITULO = (texto: string) => `--cierto=document.querySelector('h1').textContent === '${texto}'`
const TOCAR_EN_TARJETA = (id: string, texto: string) => `--cierto=(() => { const b = [...document.querySelectorAll('[id="tarjeta-${id}"] button')].find((x) => x.textContent.trim() === '${texto}'); if (!b) return false; b.click(); return true })()`
const TARJETA_DICE = (id: string, texto: string) => `--cierto=document.getElementById('tarjeta-${id}').textContent.includes('${texto}')`
const TARJETA_SIN_BOTONES = (id: string) => `--cierto=![...document.querySelectorAll('[id="tarjeta-${id}"] button')].some((b) => /^(Aplicar|Enviar|Descartar)/.test(b.textContent.trim()))`
const SECCIONES_CON_ESTADOS: [string, string][] = [['inicio', 'lo de hoy'], ['casos', 'tus Casos'], ['conversaciones', 'tus conversaciones'], ['pedidos', 'tus pedidos'], ['agenda', 'tu agenda'], ['clientes', 'tus Clientes'], ['pedido', 'este pedido'], ['cliente', 'este Cliente'], ['tablero', 'tu Tablero'], ['seccion', 'esta Sección'], ['ajustes', 'los ajustes de tu negocio']]
const ESCENAS_DE_ESTADOS = ['entrar', 'entrar-registro', 'entrar-codigo', 'entrar-dispositivo', 'entrar-olvido', 'cuenta-por-pasar', 'cuenta-por-confirmar', 'ajustes', 'ajustes-armandose', 'ajustes-sin-ciudad', 'ajustes-largo', ...SECCIONES_CON_ESTADOS.flatMap(([id]) => [`cargando-${id}`, `error-${id}`]), 'seccion-sin-advertencia', 'error-de-verdad', 'seccion-no-esta', 'hilo-capacidad-faltante', 'hilo-tarjeta-vencio', 'hilo-error']

const ESCENAS_DEL_DETALLE = ['pedido-abierto', 'pedido-sin-conversacion', 'pedido-cancelado', 'pedido-largo', 'pedido-no-esta', 'cliente-abierto', 'cliente-con-caso', 'cliente-sin-nada', 'cliente-largo', 'cliente-no-esta']
const ESCENAS_DE_LA_TOMA = ['conversacion-tomada', 'conversacion-agente-terminando', 'conversacion-de-otro', 'conversacion-tuya-sin-ventana', 'conversacion-sin-ventana', 'conversacion-cliente-espera', 'conversacion-por-vencer', 'conversacion-se-acabo-el-tiempo', 'conversacion-no-salio', 'conversacion-whatsapp-no-lo-toma', 'conversacion-sin-saber', 'hilo-aviso-de-la-toma']
const TODAS_LAS_ESCENAS = [...ESCENAS_DE_LA_TOMA, ...ESCENAS_DEL_CASO, ...ESCENAS_DEL_DETALLE, ...ESCENAS_ESPERADAS, ...ESCENAS_DE_PUBLICAR, ...ESCENAS_DEL_ARMADO, ...ESCENAS_DE_ALBA, ...ESCENAS_DE_ESTADOS]

const RECORRIDOS_DE_ESTADOS: typeof RECORRIDOS = [
  ['Entrar: cada falla dice qué pasó, se vuelve a tocar y al final entra', 'entrar', '1440', LLENAR_ENTRADA, '--clic=Entrar', '--ve=Entrando…', '--espera=500', '--ve=El correo o la contraseña no coinciden. Revísalos y vuelve a intentar.', `--cierto=document.querySelector('[name=email]').value === 'lucia@cafe.co' && document.querySelector('[name=password]').value === 'una-clave-larga'`, '--clic=Entrar', '--no-ve=no coinciden', '--espera=500', '--ve=No me pude conectar. Revisa tu internet', '--clic=Entrar', '--espera=500', '--ve=Ya van muchos intentos', '--clic=Entrar', '--espera=500', '--ve=Ya entraste.'],
  ['Entrar, teléfono: la hoja llega hasta abajo y el titular va en el cielo', 'entrar', '390', `--cierto=(() => { const r = document.querySelector('main section').getBoundingClientRect(); return Math.abs(r.bottom - innerHeight) < 1 && r.width === innerWidth && document.querySelector('h1').getBoundingClientRect().bottom <= r.top })()`, `--cierto=getComputedStyle(document.querySelector('main')).backgroundImage.includes('linear-gradient')`],
  ['Entrar: el registro pide el código, uno equivocado lo dice y al final entra', 'entrar-codigo', '1440', LLENAR_ENTRADA, '--clic=Crear cuenta', '--ve=Confirma tu correo', '--ve=lucia@cafeladera.co', '--ve=Mándame otro código', `--cierto=(() => { document.querySelector('[name=codigo]').value = '000000'; return true })()`, '--clic=Confirmar', '--ve=Ese código no coincide.', `--cierto=(() => { document.querySelector('[name=codigo]').value = '424242'; return true })()`, '--clic=Confirmar', '--ve=Ya entraste.'],
  ['Entrar: desde un dispositivo nuevo pide un código', 'entrar-dispositivo', '390', LLENAR_ENTRADA, '--clic=Entrar', '--ve=Confirma que eres tú', '--ve=Volver'],
  ['Entrar: olvidó la contraseña, pide el correo, el código y la nueva', 'entrar-olvido', '390', '--clic=¿Olvidaste tu contraseña?', '--ve=Mandarme el código', `--cierto=(() => { document.querySelector('[name=email]').value = 'lucia@cafeladera.co'; return true })()`, '--clic=Mandarme el código', '--ve=Con él creas una contraseña nueva.', `--cierto=(() => { document.querySelector('[name=codigo]').value = '424242'; return true })()`, '--clic=Seguir', '--ve=Crea tu contraseña nueva', '--ve=Mínimo 15 caracteres.', `--cierto=(() => { document.querySelector('[name=password]').value = 'una-clave-larga-1'; return true })()`, '--clic=Guardar y entrar', '--ve=Ya entraste.'],
  ['Entrar: volver desde el código regresa a las credenciales', 'entrar-dispositivo', '1440', LLENAR_ENTRADA, '--clic=Entrar', '--ve=Confirma que eres tú', '--clic=Volver', '--ve=Entra a tu negocio'],
  ['Cuenta por confirmar: manda el código y uno equivocado lo dice', 'cuenta-por-confirmar', '390', '--ve=Confirma tu correo', '--clic=Mandarme el código', '--ve=Te mandé un código a lucia@cafeladera.co.', `--cierto=(() => { document.querySelector('[name=codigo]').value = '000000'; return true })()`, '--clic=Confirmar', '--ve=Ese código no coincide.'],
  ['Panel: el menú del Dueño ofrece Cerrar sesión', 'panel-funcionando', '1440', '--clic=Tu cuenta: Lucía', '--ve=Cerrar sesión'],
  ['Panel, teléfono: el cajón también lleva Cerrar sesión', 'panel-funcionando', '390', '--clic=Menú', '--espera=400', '--clic=Tu cuenta: Lucía', '--ve=Cerrar sesión'],
  ['Entrar: cabe en 320 px con el registro abierto', 'entrar-registro', '320', '--ve=Tu nombre', '--ve=Mínimo 15 caracteres.'],
  ['Entrar: los campos dicen su autocompletado, también al registrarse', 'entrar-registro', '1440', `--cierto=document.querySelector('[name=password]').autocomplete === 'new-password' && document.querySelector('[name=email]').autocomplete === 'email'`, '--clic=¿Ya tienes cuenta?', `--cierto=document.querySelector('[name=password]').autocomplete === 'current-password'`],
  ['Entrar: el correo que ya tiene cuenta lleva a entrar, y cambiar de modo limpia el error', 'entrar-registro', '1440', '--ve=Arma tu negocio', LLENAR_ENTRADA, '--clic=Crear cuenta', '--ve=Creando tu cuenta…', '--espera=500', '--ve=Ese correo ya tiene cuenta. Entra con tu contraseña.', '--clic=¿Ya tienes cuenta?', '--no-ve=Ese correo ya tiene cuenta', EL_TITULO('Entra a tu negocio'), '--no-ve=Tu nombre'],
  ['Ajustes: se llega desde el selector del Negocio', 'panel-funcionando', '1440', '--clic=CCafé Ladera', '--ve=Ajustes del negocio', '--clic=Ajustes del negocio', EL_TITULO('Ajustes del negocio'), '--ve=Manizales', '--ve=wa.me/000000000000', '--ve=Sigue el de tu teléfono o tu computador.', '--no-ve=Necesita tu ojo'],
  ['Ajustes, teléfono: se llega desde el cajón y queda en Tu negocio', 'telefono-cajon', '390', '--clic=CCafé Ladera', '--clic=Ajustes del negocio', EL_TITULO('Ajustes del negocio'), `--cierto=document.querySelector('[data-pano=lienzo]').checkVisibility()`],
  ['Ajustes: el selector también lleva a Inicio', 'ajustes', '1440', '--clic=CCafé Ladera', `--cierto=(() => { const a = [...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent === 'Café Ladera'); if (!a) return false; a.click(); return true })()`, '--espera=400', '--ve=Necesita tu ojo'],
  ['Ajustes: Cambiar empieza el mensaje en el redactor, sin enviar nada', 'ajustes', '1440', '--clic=Cambiar la ciudad', REDACTOR_DICE('Quiero cambiar la ciudad de mi negocio a '), `--cierto=document.querySelector('[data-conversacion]').innerText.includes('Hola, soy tu agente')`],
  ['Ajustes, teléfono: Cambiar lleva a Tu agente', 'ajustes', '390', '--clic=Cambiar la ciudad', REDACTOR_DICE('Quiero cambiar la ciudad de mi negocio a '), `--cierto=document.querySelector('[data-pano=hilo]').checkVisibility() && !document.querySelector('[data-pano=lienzo]').checkVisibility()`],
  ['Ajustes: con el negocio abierto el nombre no ofrece Cambiar y lo dice', 'ajustes', '1440', '--ve=el nombre todavía no se puede cambiar', `--cierto=!document.querySelector('[aria-label="Cambiar el nombre"]')`],
  ['Ajustes: armándose no hay link, y el nombre sí se cambia', 'ajustes-armandose', '1440', '--ve=Tu link sale cuando abras tu negocio.', '--no-ve=wa.me', '--clic=Cambiar el nombre', REDACTOR_DICE('Mi negocio se llama ')],
  ['Ajustes: sin ciudad lo dice y empieza a contarla', 'ajustes-sin-ciudad', '1440', '--ve=Tu agente todavía no la sabe.', '--clic=Cambiar la ciudad', REDACTOR_DICE('Mi negocio está en ')],
  ['Ajustes: los textos largos caben en 320 px', 'ajustes-largo', '320', '--ve=Hermanos Giraldo'],
  ...SECCIONES_CON_ESTADOS.map(([id, trae]): (typeof RECORRIDOS)[number] => [`Error de ${id}: dice qué no trajo y qué hacer`, `error-${id}`, '1440', `--ve=No pude traer ${trae}.`, '--ve=Vuelve a intentar en un momento.', '--clic=Volver a intentar', `--cierto=!!document.querySelector('[data-reintentos="1"]')`, `--cierto=document.querySelector('[data-pano=lienzo] [role=alert]') !== null`]),
  ['Error: en teléfono la cáscara sigue ahí', 'error-pedidos', '390', '--ve=No pude traer tus pedidos.', `--cierto=document.querySelector('${PESTANAS}').checkVisibility()`],
  ['Error: el archivo de verdad que usa Next vuelve a intentar', 'error-de-verdad', '1440', '--ve=No pude traer esta Sección.', '--evalua=window.yaNoFalla = true', '--clic=Volver a intentar', '--espera=500', '--ve=Ya cargó.'],
  ['Error: una Sección que ya no está dice qué hacer', 'seccion-no-esta', '1440', '--ve=Esta Sección no está en tu negocio.', '--ve=Mira las tuyas en el menú', EL_TITULO('Tu negocio')],
  ['Vacío: cada Sección dice qué sigue', 'pedidos-vacios', '1440', '--ve=Cuando tu agente tome uno, aparece aquí.', '--clic=Clientes', '--ve=Cuando un Cliente te escriba, aparece aquí.', '--clic=Casos', '--ve=Cuando algo la necesite, aparece aquí', '--clic=Conversaciones', '--ve=Cuando un Cliente te escriba, aparece aquí.', '--clic=Tablero', '--ve=Cuando tu agente tome uno, aparece aquí.'],
  ['Hilo: lo que no sabe hacer queda anotado, sin botón, venga de donde venga', 'hilo-capacidad-faltante', '1440', `--cierto=document.querySelector('[data-conversacion]').innerText.split('Todavía no sé hacer esto').length === 3`, '--ve=Quedó anotado para el equipo de Amanece. No cambié nada en tu negocio.', `--cierto=![...document.querySelectorAll('[data-conversacion] button')].some((b) => /^(Aplicar|Enviar)/.test(b.textContent.trim()))`, '--no-ve=Preparó lo que pediste', '--no-ve=Anotó algo'],
  ['Hilo: proponer sin tarjeta dice que revisó, no que preparó', 'hilo-capacidad-faltante', '1440', '--ve=Revisó lo que pediste'],
  ['Hilo: lo que no sabe hacer, en teléfono', 'hilo-capacidad-faltante', '390', '--ve=Todavía no sé hacer esto'],
  ['Hilo: si se corta la respuesta dice qué hacer', 'hilo-error', '1440', '--ve=Se cortó mi respuesta. Escríbeme de nuevo.', '--no-ve=Algo falló'],
  ['Tarjeta que venció sin refrescar: dice que venció y ya no deja tocar', 'hilo-tarjeta-vencio', '1440', '--ve=1 de 4', TOCAR_EN_TARJETA('v-aplicar', 'Aplicar'), '--espera=400', TARJETA_DICE('v-aplicar', 'Venció sin aplicarse. Pídela de nuevo'), TARJETA_SIN_BOTONES('v-aplicar'), '--ve=1 de 3', TOCAR_EN_TARJETA('v-enviar', 'Enviar'), '--espera=400', TARJETA_DICE('v-enviar', 'Venció sin enviarse. Pídele a tu agente'), TARJETA_SIN_BOTONES('v-enviar')],
  ['Tarjeta que otro ya resolvió: dice qué hacer y ya no deja tocar', 'hilo-tarjeta-vencio', '1440', TOCAR_EN_TARJETA('v-otro', 'Aplicar'), '--espera=400', TARJETA_DICE('v-otro', 'Esta tarjeta ya no está disponible. Pídesela de nuevo'), TARJETA_SIN_BOTONES('v-otro')],
  ['Tarjeta sin conexión: lo dice y se vuelve a tocar', 'hilo-tarjeta-vencio', '1440', TOCAR_EN_TARJETA('v-red', 'Aplicar'), '--espera=400', TARJETA_DICE('v-red', 'No me pude conectar'), TOCAR_EN_TARJETA('v-red', 'Aplicar')],
]

/** Qué no puede saltar al llegar los datos: la vista de verdad, su esqueleto y qué medir. `alto` compara solo la altura, porque arriba puede haber Indicadores del Negocio. */
const ENESIMA = (n: number) => `li:nth-child(${n})`
const ESQUELETOS_QUE_NO_SALTAN: { vista: string; esqueleto: string; arriba: string[]; alto?: string[] }[] = [
  { vista: 'telefono-tu-negocio', esqueleto: 'cargando-inicio', arriba: ['h3', 'li'] },
  { vista: 'casos-espera', esqueleto: 'cargando-casos', arriba: ['p'] },
  { vista: 'conversaciones-lista', esqueleto: 'cargando-conversaciones', arriba: ['li', ENESIMA(2)] },
  { vista: 'pedidos-lista', esqueleto: 'cargando-pedidos', arriba: ['h3', 'li'] },
  { vista: 'clientes-tabla', esqueleto: 'cargando-clientes', arriba: ['thead tr', 'tbody tr'] },
  { vista: 'agenda-lista', esqueleto: 'cargando-agenda', arriba: ['h3', 'li'] },
  { vista: 'pedido-abierto', esqueleto: 'cargando-pedido', arriba: ['.gap-6 h3', '.gap-6 li'] },
  { vista: 'cliente-abierto', esqueleto: 'cargando-cliente', arriba: ['.gap-6 > div', '.gap-6 h3'] },
  { vista: 'tablero', esqueleto: 'cargando-tablero', arriba: ['.grid > div'] },
  { vista: 'seccion-sin-advertencia', esqueleto: 'cargando-seccion', arriba: ['p', 'thead tr'] },
  { vista: 'ajustes', esqueleto: 'cargando-ajustes', arriba: ['p', ENESIMA(1), ENESIMA(2), ENESIMA(3), ENESIMA(4)] },
]

const COLUMNA_DE_LA_LISTA = `document.querySelector('[data-pano=lienzo] .border-r')`
const ELEGIDA = `document.querySelector('[data-pano=lienzo] [aria-current=true]')`
const RECORRIDOS_DEL_DETALLE: typeof RECORRIDOS = [
  ['Pedido: una fila abre su detalle, con la lista al lado y la Sección marcada', 'pedidos-lista', '1440', '--clic=#41Daniela Quintero · 2 tueste medio, grano 500 gPereira$76.000hace 12 min', '--ve=Pedido #41', '--ve=Lo que pidió', EL_TITULO('Pedidos')],
  ['Pedido: trae estado, lo que pidió, entrega, Cliente y conversación', 'pedido-abierto', '1440', '--ve=Pedido #41', '--ve=2 × Tueste medio, grano 500 g', '--ve=$76.000', '--ve=Carrera 8 # 21-40, Pereira', '--ve=Daniela Quintero', '--ve=Listo, tu pedido #41 por $76.000', EL_TITULO('Pedidos'), `--cierto=${ELEGIDA}.textContent.includes('Daniela Quintero')`, `--cierto=document.querySelector('[data-slot=sidebar-menu-button][data-active]').textContent.includes('Pedidos')`],
  ['Pedido: en PC la flecha vuelve a la lista entera, con su resumen', 'pedido-abierto', '1440', '--clic=Volver a los pedidos', '--ve=14 conversaciones hoy', '--no-ve=Pedido #41'],
  ['Pedido, teléfono: una pantalla a la vez', 'pedidos-lista', '390', '--clic=#41Daniela Quintero · 2 tueste medio, grano 500 gPereira$76.000hace 12 min', '--ve=Pedido #41', '--ve=Lo que pidió', `--cierto=!${COLUMNA_DE_LA_LISTA}.checkVisibility()`, '--clic=Volver a los pedidos', '--ve=Por confirmar', '--no-ve=Lo que pidió'],
  ['Pedido: el Cliente lleva a su detalle, y de ahí a la conversación', 'pedido-abierto', '1440', '--clic=Daniela Quintero', EL_TITULO('Clientes'), '--ve=Sus pedidos', '--clic=Ver toda la conversación', EL_TITULO('Conversaciones'), '--ve=Tu agente está atendiendo'],
  ['Pedido: sin mensajes dice qué sigue', 'pedido-sin-conversacion', '1440', '--ve=Todavía no te ha escrito', '--no-ve=Ver toda la conversación'],
  ['Pedido: cancelado abre su grupo plegado', 'pedido-cancelado', '1440', '--ve=Pedido #31', `--cierto=${ELEGIDA}.checkVisibility()`],
  ['Pedido: al final de una lista larga, la fila elegida queda a la vista', 'pedido-largo', '1440', `--cierto=(() => { const c = ${COLUMNA_DE_LA_LISTA}.getBoundingClientRect(); const r = ${ELEGIDA}.getBoundingClientRect(); return ${COLUMNA_DE_LA_LISTA}.scrollTop > 0 && r.top >= c.top && r.bottom <= c.bottom })()`],
  ['Pedido: los textos largos caben a 320 px', 'pedido-largo', '320', '--ve=Vereda La Esperanza'],
  ['Pedido de otro Negocio: lo dice y lleva a los suyos', 'pedido-no-esta', '1440', '--ve=Este pedido no está en tu negocio.', '--clic=Ver tus pedidos', '--ve=14 conversaciones hoy'],
  ['Cliente: una fila abre su detalle, con pedidos y conversación', 'clientes-tabla', '1440', '--clic=Daniela Quintero', '--ve=Sus pedidos', '--ve=$146.000', '--ve=en 3 pedidos', '--ve=Listo, tu pedido #41', EL_TITULO('Clientes'), `--cierto=${ELEGIDA}.textContent.includes('Daniela Quintero')`],
  ['Cliente: sus pedidos llevan a ese pedido', 'cliente-abierto', '1440', '--clic=#41 · 2 tueste medio, grano 500 gPor confirmar$76.000', '--ve=Pedido #41', EL_TITULO('Pedidos')],
  ['Cliente, teléfono: una pantalla a la vez', 'clientes-tabla', '390', '--clic=Daniela Quintero', '--ve=Sus pedidos', '--no-ve=Andrés Felipe Gómez', '--clic=Volver a los Clientes', '--ve=Andrés Felipe Gómez', '--no-ve=Sus pedidos'],
  ['Cliente: un Caso que espera lleva a Casos', 'cliente-con-caso', '1440', '--clic=Un Caso espera tu decisión', EL_TITULO('Casos')],
  ['Cliente: sin nombre ni pedidos, no repite el teléfono y dice qué sigue', 'cliente-sin-nada', '1440', '--ve=Todavía no ha pedido nada', '--ve=Todavía no te ha escrito', `--cierto=[...document.querySelectorAll('[data-pano=lienzo] .gap-6 *')].every((e) => !e.textContent.startsWith('+57'))`],
  ['Cliente: más pedidos que el límite dice el total', 'cliente-largo', '1440', '--ve=Ves los 50 más recientes de 1.205', '--ve=Ves los últimos 20 de 1.204'],
  ['Cliente: los textos largos caben a 320 px', 'cliente-largo', '320', '--ve=Sus pedidos'],
  ['Cliente de otro Negocio: lo dice y lleva a los suyos', 'cliente-no-esta', '1440', '--ve=Este Cliente no está en tu negocio.', '--clic=Ver tus Clientes', '--ve=Andrés Felipe Gómez'],
  ['Casos: Ver el pedido llega a ese pedido', 'casos-espera', '1440', '--clic=Ver el pedido', '--ve=Pedido #31', '--ve=Marcela Ríos', EL_TITULO('Pedidos')],
  ['Casos: un Caso resuelto también lleva a su pedido', 'pedidos-lista', '1440', '--clic=Casos', '--clic=Ver el pedido', '--ve=Pedido #38', EL_TITULO('Pedidos')],
  ['Inicio: Ver el pedido llega a ese pedido', 'panel-funcionando', '1440', '--clic=Ver el pedido', '--ve=Pedido #37', '--ve=Paola Andrea Vargas', EL_TITULO('Pedidos')],
]

const RECORRIDOS_DEL_TABLERO: typeof RECORRIDOS = [
  ['Tablero: cuatro tarjetas con sus cifras, y un reparto que sí tiene dato', 'tablero', '1440', '--ve=Ventas de la semana', '--ve=$1.284.000', '--ve=18\u00a0% más que la anterior', '--ve=Conversaciones hoy', '--ve=Resueltas sin ti', '--ve=93\u00a0%', '--ve=Necesitan atención', '--ve=De dónde llegan', '--ve=Tu link', '--ve=Anuncio de Meta', '--ve=Sin dato: no se sabe cómo llegaron', '--ve=Pedidos recientes', '--no-ve=Pedidos por estado'],
  ['Tablero: sin Clientes, De dónde llegan dice qué sigue', 'tablero-vacio', '390', '--ve=De dónde llegan', '--ve=Todavía no tienes Clientes', '--no-ve=Sin dato'],
  ['Tablero: los Clientes de antes cuentan como Sin dato y no se reparten', 'tablero-sin-origenes', '390', '--ve=antes de que esto se guardara', '--no-ve=Tu link', '--no-ve=Anuncio de Meta'],
  ['Tablero: sin Sin dato no se explica', 'tablero-agenda', '1440', '--ve=Tu link', '--no-ve=Sin dato'],
  ['Tablero: un Indicador propio lleva su cifra y sus barras', 'tablero', '1440', '--ve=14 pedidos', '--ve=$1.120.000', `--cierto=document.querySelectorAll('[data-pano=lienzo] ol[aria-label="Ventas por día"] li').length === 5`],
  ['Tablero: la barra más alta llena el eje y la de cero no pinta', 'tablero', '1440', `--cierto=${BARRA(4)}.querySelector('.barra-crece').getBoundingClientRect().height === ${BARRA(4)}.getBoundingClientRect().height && ${BARRA(5)}.querySelector('.barra-crece').getBoundingClientRect().height === 0`],
  ['Tablero: una barra dice su cifra al enfocarla, también la que no se rotula', 'tablero', '1440', `--cierto=getComputedStyle(${BARRA(2)}.lastElementChild).display === 'none'`, `--evalua=${BARRA(2)}.focus()`, `--cierto=getComputedStyle(${BARRA(2)}.lastElementChild).display === 'block' && ${BARRA(2)}.lastElementChild.textContent === '5 Jue 29 oct'`],
  ['Tablero: un lector de pantalla oye cada barra', 'tablero', '1440', `--cierto=${BARRA(4)}.querySelector('.sr-only').textContent === 'Sáb 31 oct: 8'`],
  ['Tablero: una barra enfocada no saca la página de su ancho a 320 px', 'tablero', '320', `--evalua=${BARRA(7)}.focus()`, `--cierto=${BARRA(7)}.lastElementChild.getBoundingClientRect().right <= innerWidth`],
  ['Tablero: las cifras nunca parten a 320 px', 'tablero', '320', `--cierto=[...document.querySelectorAll('[data-pano=lienzo] .font-heading')].filter((p) => p.textContent.startsWith('$1')).every((p) => p.getClientRects().length === 1 && p.getBoundingClientRect().height < 40)`],
  ['Tablero: sin pedidos dice qué falta, sin barras en cero', 'tablero-vacio', '1440', '--ve=Todavía no hay pedidos en estos 7 días', '--ve=Todavía no tienes pedidos', '--ve=—', `--cierto=!document.querySelector('[data-pano=lienzo] ol')`],
  ['Tablero: una agenda habla de citas', 'tablero-agenda', '1440', '--ve=Citas de la semana', '--ve=Citas por día', '--ve=Próximas citas', '--ve=Mariana Ospina', '--no-ve=Ventas de la semana', '--no-ve=Pedidos por día', '--no-ve=Pedidos recientes'],
  ['Tablero: una agenda con pedidos también los ve', 'tablero-agenda-con-pedidos', '1440', '--ve=Próximas citas', '--ve=Pedidos recientes'],
  ['Tablero: una agenda sin citas dice 0 y por qué', 'tablero-agenda-sin-citas', '1440', '--ve=Todavía sin citas esta semana', '--ve=Todavía no hay citas esta semana.', '--ve=No tienes citas por venir.'],
  ['Tablero: armándose ve la carta, sin cifras en cero', 'tablero-armandose', '1440', '--ve=Cuéntame de tu negocio.', '--no-ve=Conversaciones hoy', '--no-ve=$0', `--cierto=!document.querySelector('[data-pano=lienzo]')`],
  ['Tablero: un ranking va en barras con su nombre y sin cifra grande', 'tablero-muchos', '1440', '--ve=Ventas por ciudad', '--ve=$12.840.000', '--ve=Manizales'],
  ['Tablero: 30 días rotulan solo los extremos del eje', 'tablero-muchos', '1440', `--cierto=document.querySelector('[data-pano=lienzo] ol[aria-label^="Ventas de los"]').parentElement.nextElementSibling.innerText.replace(/\\s+/g, ' ') === '1 oct 30 oct'`],
  ['Sección propia: el nombre va en el encabezado, con lo que pidió el Dueño', 'seccion-propia', '1440', `--cierto=document.querySelector('h1').textContent === 'Pedidos con novedad'`, '--ve=Pedidos que la transportadora no pudo entregar', '--ve=Marcela Ríos', '--ve=Dirección incompleta'],
  ['Sección propia: una columna de números va a la derecha', 'seccion-propia', '1440', `--cierto=getComputedStyle(${COLUMNA('Total')}).textAlign === 'right' && getComputedStyle(${COLUMNA('Ciudad')}).textAlign !== 'right'`],
  ['Sección propia: en teléfono quedan nombre y última columna, y lo demás sube debajo del nombre', 'seccion-propia', '390', `--cierto=${COLUMNA('Ciudad')} && getComputedStyle(${COLUMNA('Ciudad')}).display === 'none' && getComputedStyle(${COLUMNA('Novedad')}).display !== 'none'`, '--ve=Ciudad: Manizales', '--ve=Total: 96.000', '--ve=Dirección incompleta'],
  ['Sección propia: en PC cada columna va en su lugar y no se repite debajo', 'seccion-propia', '1440', `--cierto=getComputedStyle(${COLUMNA('Ciudad')}).display !== 'none'`, '--no-ve=Ciudad: Manizales'],
  ['Sección propia: recortada lo dice una vez, con la cuenta de verdad', 'seccion-larga', '1440', '--ve=Hay 312 y el Panel muestra 50', '--no-ve=muestro'],
  ['Sección propia: sin filas y sin poder calcular dicen qué pasa', 'seccion-sin-filas', '1440', '--ve=Nada por ahora', '--clic=Devoluciones del mes', '--ve=No se pudo calcular ahora'],
]

const RECORRIDOS_DE_LISTAS: typeof RECORRIDOS = [
  ['Pedidos: los grupos van en el orden del diseño, con su cuenta y cancelado al final', 'pedidos-lista', '1440', `--cierto=${ENCABEZADOS}.map((h) => h.textContent.trim().replace(/\\s+/g, ' ')).join('|') === 'Con novedad 1|Por confirmar 1|Confirmado 2|Enviado 3|Entregado 5|Cancelado 1'`],
  ['Casos: Enviar desde la Sección deja lo mismo en el Hilo', 'casos-espera', '1440', enElPano('lienzo', 'Espera tu decisión'), enElPano('hilo', 'Le voy a responder'), tocarEn('lienzo', 'Enviar'), '--espera=500', `--cierto=!document.querySelector('[data-pano=lienzo]').innerText.includes('Espera tu decisión')`, enElPano('lienzo', 'Resueltos'), enElPano('lienzo', 'El envío a Cali cuesta'), enElPano('hilo', 'Enviada a Marcela Ríos')],
  ['Casos: Enviar desde el Hilo deja lo mismo en la Sección', 'casos-espera', '1440', tocarEn('hilo', 'Enviar'), '--espera=500', enElPano('hilo', 'Enviada a Marcela Ríos'), `--cierto=!document.querySelector('[data-pano=lienzo]').innerText.includes('Espera tu decisión')`, enElPano('lienzo', 'El envío a Cali cuesta')],
  ['Casos: Descartar en la Sección lo deja esperando y dice qué sigue, igual en el Hilo', 'casos-espera', '1440', tocarEn('lienzo', 'Descartar'), '--espera=500', enElPano('lienzo', 'Espera tu decisión'), enElPano('lienzo', 'Descartada'), enElPano('lienzo', 'Sigue sin resolver'), enElPano('hilo', 'Descartada')],
  ['Casos: la tarjeta de la Sección no repite el ancla del Hilo', 'casos-espera', '1440', `--cierto=document.querySelectorAll('[id="tarjeta-p-caso"]').length === 1 && !!document.querySelector('[data-pano=hilo] [id="tarjeta-p-caso"]')`],
  ['Casos: sin botón vivo dice por qué y qué sigue', 'casos-sin-boton', '1440', '--ve=Todavía no hay una respuesta lista para enviar', '--ve=Descartada', '--ve=Venció sin enviarse', '--ve=WhatsApp no la tomó', `--cierto=![...document.querySelectorAll('[data-pano=lienzo] button')].some((b) => /^(Enviar|Descartar)$/.test(b.textContent.trim()))`],
  ['Casos: sin nada, dice qué sigue', 'casos-vacios', '1440', '--ve=Nada espera tu decisión', '--no-ve=Resueltos'],
  ['Casos: sin nada esperando no hay encabezado de decisión', 'pedidos-lista', '1440', '--clic=Casos', '--ve=Resueltos', '--ve=Pregunta por envío a San Andrés', `--no-ve=Espera tu decisión`],
  ['Casos: más que el límite dice el total', 'casos-muchos', '1440', '--ve=Ves los 50 más recientes de 60', '--ve=Ves los 50 más recientes de 1.204'],
  ['Conversaciones: PC con lista y detalle, y la primera elegida', 'conversaciones-lista', '1440', '--ve=Listo, tu pedido #41 por $76.000', '--ve=Santiago Herrera', '--ve=Tu agente está atendiendo', '--ve=Tomar la conversación', '--no-ve=Un Caso espera tu decisión'],
  // La fila empieza por las iniciales del avatar, y `--clic` busca por el comienzo del texto.
  ['Conversaciones: tocar otra cambia el detalle y conserva la Sección', 'conversaciones-lista', '1440', '--clic=SHSantiago Herrera', '--ve=Buenas, tengo greca en la casa', '--no-ve=Hola, quiero pedir 2 tueste medio', `--cierto=document.querySelector('h1').textContent === 'Conversaciones'`, `--cierto=document.querySelector('[aria-current=true]').textContent.includes('Santiago')`],
  ['Conversaciones: un Caso que espera lleva a Casos', 'conversacion-con-caso', '1440', '--clic=Un Caso espera tu decisión', '--ve=Espera tu decisión', `--cierto=document.querySelector('h1').textContent === 'Casos'`],
  ['Conversaciones: teléfono, una pantalla a la vez', 'conversaciones-lista', '390', '--ve=Santiago Herrera', '--no-ve=Tu agente está atendiendo', '--clic=SHSantiago Herrera', '--ve=Buenas, tengo greca en la casa', '--ve=Tu agente está atendiendo', '--no-ve=Daniela Quintero', '--clic=Volver a las conversaciones', '--ve=Daniela Quintero', '--no-ve=Tu agente está atendiendo'],
  ['Conversaciones: sin nada, dice qué sigue', 'conversaciones-vacias', '1440', '--ve=Todavía no te ha escrito nadie', '--no-ve=Tu agente está atendiendo'],
  ['Conversaciones: más que el límite dice el total y abre en lo último', 'conversaciones-muchas', '1440', '--ve=Ves las 100 más recientes de 1.204', '--ve=Ves los últimos 200 de 1.204', `--cierto=(() => { const s = [...document.querySelectorAll('[data-pano=lienzo] .overflow-y-auto')].find((e) => getComputedStyle(e).flexDirection === 'column-reverse'); return s.scrollTop >= -1 && s.scrollHeight > s.clientHeight })()`],
  ['Pedidos: el resumen lleva las cifras de arriba', 'pedidos-lista', '1440', '--ve=$1.284.000', '--ve=14 conversaciones hoy', '--ve=13 resueltas sin ti'],
  ['Pedidos: las etiquetas llevan su tono', 'pedidos-lista', '1440', `--cierto=${TONO_DE(0, '--ojo')}`, `--cierto=${TONO_DE(1, '--foreground')}`, `--cierto=${TONO_DE(2, '--bien')}`, `--cierto=${TONO_DE(3, '--muted-foreground')}`, `--cierto=${TONO_DE(4, '--muted-foreground')}`, `--cierto=${TONO_DE(5, '--muted-foreground')}`],
  ['Pedidos en oscuro: las etiquetas llevan su tono', 'pedidos-lista', '1440', '--oscuro', `--cierto=${TONO_DE(0, '--ojo')}`, `--cierto=${TONO_DE(2, '--bien')}`],
  ['Pedidos: lo cancelado se ve plegado y se abre', 'pedidos-lista', '1440', '--no-ve=Felipe Mora', '--clic=Cancelado', '--ve=Felipe Mora'],
  ['Pedidos en PC: número, ciudad y tiempo a la vista', 'pedidos-lista', '1440', '--ve=#41', '--ve=Pereira', '--ve=hace 12 min', `--cierto=getComputedStyle([...document.querySelectorAll('[data-pano=lienzo] li span')].find((s) => s.textContent === '$76.000')).fontVariantNumeric === 'tabular-nums'`],
  ['Pedidos en teléfono: se esconden número, ciudad y tiempo', 'pedidos-lista', '390', '--ve=Daniela Quintero', '--ve=$76.000', '--no-ve=#41', '--no-ve=Pereira', '--no-ve=hace 12 min'],
  ['Pedidos en PC angosto: el lienzo manda, no la ventana', 'pedidos-lista', '1024', '--ve=$76.000', '--no-ve=#41', '--no-ve=Pereira'],
  ['Pedidos en PC: el encabezado pega arriba del lienzo', 'pedidos-muchos', '1440', `--cierto=${PEGA_ARRIBA}`],
  ['Pedidos en teléfono: el encabezado pega arriba del lienzo', 'pedidos-muchos', '390', `--cierto=${PEGA_ARRIBA}`],
  ['Pedidos: con más filas que el límite dice cuántas ves', 'pedidos-muchos', '320', '--ve=Ves los 50 más recientes de 312.', '--ve=Ves los 50 más recientes de 12.480.'],
  ['Pedidos: filas largas caben en PC angosto', 'pedidos-muchos', '1024'],
  ['Pedidos: sin pedidos dice qué sigue y ninguna cifra', 'pedidos-vacios', '1440', '--ve=Todavía no tienes pedidos', '--no-ve=esta semana'],
  ['Clientes en PC: todas las columnas', 'clientes-tabla', '1440', '--ve=Pereira', '--ve=hace 12 min', '--ve=$146.000', `--cierto=${SIN_DESPLAZAR}`],
  ['Clientes en teléfono: nombre y cifras sin desplazar, sin ciudad ni último', 'clientes-tabla', '390', '--ve=Daniela Quintero', '--ve=$146.000', '--no-ve=Pereira', '--no-ve=hace 12 min', `--cierto=${SIN_DESPLAZAR}`],
  ['Clientes: las cifras de la tabla no bailan', 'clientes-tabla', '1440', `--cierto=[...document.querySelectorAll('td.text-right')].filter((c) => /^[$\\d]/.test(c.textContent)).every((c) => getComputedStyle(c).fontVariantNumeric === 'tabular-nums')`],
  ['Clientes: un nombre largo se recorta en 320 sin desplazar', 'clientes-muchos', '320', `--cierto=${SIN_DESPLAZAR}`, `--cierto=${NOMBRE_RECORTADO}`, '--ve=Ves los 100 más recientes de 1.204.'],
  ['Clientes: un nombre largo se recorta en PC angosto', 'clientes-muchos', '1024', `--cierto=${SIN_DESPLAZAR}`, `--cierto=${NOMBRE_RECORTADO}`],
  ['Clientes: un nombre largo no empuja la tabla en PC', 'clientes-muchos', '1440', `--cierto=${SIN_DESPLAZAR}`, `--cierto=${NOMBRE_RECORTADO}`],
  ['Clientes: sin Clientes dice qué sigue', 'clientes-vacios', '1440', '--ve=Todavía no te ha escrito nadie'],
]

const CARD_CASO = 'document.getElementById("tarjeta-p-caso")'
const ESCOGER = (primero: string, tipo: string, ...mas: string[]) => `(() => { const d = new DataTransfer(); for (const n of ${JSON.stringify([primero, ...mas])}) d.items.add(new File(['x'], n, { type: ${JSON.stringify(tipo)} })); const i = document.querySelector('[data-adjuntar]'); i.files = d.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
const RECORRIDOS_DEL_HILO: typeof RECORRIDOS = [
  ['Hilo: el Dueño va en globo secondary y el agente sin globo', 'panel-un-caso', '1440', `--cierto=(() => { const dueno = [...document.querySelectorAll('[data-conversacion] div')].filter((d) => d.textContent === 'Cuando un pedido sea para fuera de mi ciudad, no prometas fecha').at(-1); const agente = [...document.querySelectorAll('[data-conversacion] p')].find((p) => p.textContent.startsWith('Una clienta')); const probe = document.createElement('i'); probe.style.background = 'var(--secondary)'; document.body.append(probe); const secundario = getComputedStyle(probe).backgroundColor; probe.remove(); return getComputedStyle(dueno).backgroundColor === secundario && getComputedStyle(agente).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(agente).fontSize === '14.5px' })()`],
  ['Hilo: hasta dos sugerencias y con adjuntar', 'panel-un-caso', '1440', `--cierto=[...document.querySelectorAll('[data-pano=hilo] button')].filter((b) => /^(Quiero ver|Muéstrame|Cuando un pedido)/.test(b.textContent)).length === 2`, `--cierto=!!document.querySelector('[aria-label="Adjuntar"]').checkVisibility()`],
  ['Redactor: un PDF sube, y con él se puede enviar sin texto', 'panel-funcionando', '1440', `--evalua=${ESCOGER('lista.pdf', 'application/pdf')}`, '--ve=Subiendo', `--cierto=document.querySelector('form button[aria-label="Enviar"]').disabled`, '--no-ve=Subiendo', `--cierto=!document.querySelector('form button[aria-label="Enviar"]').disabled`],
  ['Redactor: lo que falla dice qué hacer, no se envía y se puede quitar', 'panel-funcionando', '390', `--evalua=${ESCOGER('falla.jpg', 'image/jpeg')}`, '--ve=No se subió. Revisa tu conexión', `--cierto=document.querySelector('form button[aria-label="Enviar"]').disabled`, '--clic=Quitar falla.jpg', '--no-ve=No se subió'],
  ['Redactor: el cuarto archivo no sube', 'panel-funcionando', '1440', `--evalua=${ESCOGER('a.pdf', 'application/pdf', 'b.pdf', 'c.pdf', 'd.pdf')}`, '--ve=Puedes mandar hasta 3 archivos'],
  ['Redactor: subiendo, listo y con error, sin desplazar en 320', 'hilo-adjuntando', '320', '--ve=Subiendo', '--ve=Pesa más de 4 MB', `--cierto=document.querySelector('form button[aria-label="Enviar"]').disabled`],
  ['Redactor: en la carta del armado también se adjunta', 'armado-leyendo', '390', `--cierto=!!document.querySelector('[aria-label="Adjuntar"]').checkVisibility()`],
  ['Hilo: el archivo va en el globo del Dueño, enlazado a su ruta', 'hilo-con-archivos', '1440', '--ve=Lista de precios noviembre.pdf', '--ve=PDF de 2 páginas', '--ve=Leyó tu archivo', `--cierto=[...document.querySelectorAll('[data-conversacion] a')].some((a) => a.getAttribute('href') === '/api/dueno/archivos/a1')`],
  ['Hilo: un PDF recortado lo dice en su globo, sin desplazar en 320', 'hilo-con-archivos', '320', '--ve=Leo las primeras 20 de 64 páginas'],
  ['Hilo: la tarjeta de un archivo pide comparar, dice que es de un archivo y termina en Aplicar', 'hilo-con-archivos', '1440', '--ve=Compara cada precio con tu PDF', '--ve=Lo que leí de tu archivo', `--cierto=[...document.querySelectorAll('[data-conversacion] button')].some((b) => b.textContent.trim() === 'Aplicar')`, '--no-ve=no falta ninguno'],
  ['Redactor: vacío no se enciende; con texto se enciende con --sol y su tinta', 'panel-funcionando', '1440', `--cierto=document.querySelector('form button[aria-label="Enviar"]').disabled && getComputedStyle(document.querySelector('form button[aria-label="Enviar"]')).backgroundImage === 'none'`, `--evalua=(() => { const t = document.querySelector('form textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Hola'); t.dispatchEvent(new Event('input', { bubbles: true })); return 'escrito' })()`, '--espera=500', `--cierto=(() => { const b = getComputedStyle(document.querySelector('form button[aria-label="Enviar"]')); const probe = document.createElement('i'); probe.style.color = 'var(--sol-foreground)'; document.body.append(probe); const tinta = getComputedStyle(probe).color; probe.remove(); return b.backgroundImage.includes('linear-gradient') && b.color === tinta })()`],
  ['Rastro: un check o tres puntos', 'hilo-trabajando', '1440', '--ve=Revisó tu negocio', '--ve=Preparó lo que pediste', `--cierto=document.querySelectorAll('[data-conversacion] .puntos').length === 1`],
  ['Tarjeta de un Caso: etiqueta, lo que escribió, la respuesta, a quién le llega', 'panel-un-caso', '1440', '--ve=Quiere saber cuánto cuesta un envío · pedido #31', '--ve=Marcela Ríos escribió', '--ve=¿Cuánto cuesta enviar a Cali?', '--ve=Le voy a responder', '--ve=Sale por WhatsApp a Marcela Ríos'],
  ['Enviar confirma en su sitio y pliega en una constancia que se vuelve a abrir', 'panel-un-caso', '1440', `--evalua=(() => { const r = ${CARD_CASO}.getBoundingClientRect(); window.__x = r.x; return 'medido' })()`, '--clic=Enviar', '--espera=500', '--ve=Enviada a Marcela Ríos', '--no-ve=Le voy a responder', `--cierto=${CARD_CASO}.getBoundingClientRect().x === window.__x`, '--no-ve=Sale por WhatsApp', `--cierto=(() => { const b = [...${CARD_CASO}.querySelectorAll('button')]; return b.length === 1 && b[0].getAttribute('aria-label') === 'Ver el detalle' })()`, `--evalua=${CARD_CASO}.querySelector('button').click()`, '--espera=500', '--ve=Le voy a responder', '--ve=Enviada a Marcela Ríos'],
  ['Descartar queda en la tarjeta', 'panel-un-caso', '1440', '--clic=Descartar', '--espera=500', '--ve=Descartada', '--no-ve=Le voy a responder'],
  ['Teléfono: Enviar también confirma en su sitio', 'panel-un-caso', '390', '--clic=Enviar', '--espera=500', '--ve=Enviada a Marcela Ríos'],
  ['Movimiento: con prefers-reduced-motion la tarjeta se pliega sin animar', 'panel-un-caso', '1440', '--menos-movimiento', '--clic=Enviar', '--espera=60', '--no-ve=Le voy a responder', '--ve=Enviada a Marcela Ríos'],
  ['Constancias: cada desenlace', 'hilo-constancias', '1440', '--ve=Enviada a Camila Rojas', '--ve=La bolsa llegó rota · pedido #31', '--ve=Aplicada por Julián', '--ve=Aplicada por Julián, y revertida después', '--ve=Nuevo Indicador', '--ve=Descartada', '--ve=Nueva Sección', '--ve=Venció sin aplicarse. Pídela de nuevo si todavía la quieres.'],
  ['Una tarjeta vencida no deja tocar, tenga estado o no', 'hilo-constancias', '1440', `--cierto=![...document.querySelectorAll('[data-conversacion] button')].some((b) => /^(Enviar|Aplicar|Descartar)/.test(b.textContent))`, `--cierto=document.getElementById('tarjeta-c-sin-estado').textContent.includes('Venció sin enviarse')`],
  ['Varias decisiones: la más urgente arriba, con 1 de 3', 'hilo-varias-decisiones', '1440', '--ve=1 de 3', '--ve=2 de 3', '--ve=3 de 3', `--cierto=document.querySelector('[data-conversacion] > button').textContent.includes('Quiere saber cuánto cuesta')`, `--cierto=document.getElementById('tarjeta-v-caso').textContent.includes('1 de 3')`, '--clic=Descartar', '--espera=400', '--ve=1 de 2', '--no-ve=3 de 3'],
]

const FILA = (dato: string, estado: string) => `--cierto=[...document.querySelectorAll('section li')].find((l) => l.textContent.includes('${dato}')).querySelector('[aria-label="${estado}"]') !== null`
const TITULAR = (texto: string) => `--cierto=document.querySelector('h1').textContent === '${texto}'`

/** Cuadro a cuadro: un vistazo a una hora fija depende de lo cargada que esté la máquina. */
const MUESTREAR_EL_CIELO = `--evalua=(() => { window.cielo = []; const m = () => { const e = document.querySelector('.cielo'); if (e) { const c = getComputedStyle(e); window.cielo.push([Number(c.opacity), new DOMMatrix(c.transform).m42]); requestAnimationFrame(m) } }; m(); return 'listo' })()`

const REDACTOR_EMPEZADO = [`--cierto=document.activeElement === document.querySelector('textarea') && document.activeElement.value === ${JSON.stringify(EMPIEZA_A_CORREGIR)} && document.activeElement.selectionStart === ${EMPIEZA_A_CORREGIR.length}`]

const RECORRIDOS_DEL_ARMADO: typeof RECORRIDOS = [
  ['Armado: recién entrado, todo falta y Tu Panel va en gris', 'panel-vacio', '1440', TITULAR('Cuéntame de tu negocio.'), '--ve=Hola, soy tu agente', FILA('Nombre', 'Falta'), '--no-ve=$0'],
  ['Armado: leyendo dice qué lee y no tiene temporizador que lo saque del paso', 'armado-leyendo', '1440', TITULAR('Estoy leyendo tu negocio.'), '--ve=Leyendo cafeladera.com', '--espera=4000', TITULAR('Estoy leyendo tu negocio.')],
  ['Armado: lo leído no se marca hasta tocar el botón, y al tocarlo se marca', 'armado-confirmar', '1440', TITULAR('¿Están bien estos productos?'), '--ve=Lo que encontré · 8 productos', FILA('Productos', 'Por confirmar'), FILA('Envíos', 'Por confirmar'), '--ve=Por confirmar', '--clic=Están bien y no falta ninguno', '--espera=500', FILA('Productos', 'Lo sé'), FILA('Envíos', 'Lo sé'), FILA('Nombre', 'Lo sé'), TITULAR('Solo me falta una cosa.'), '--ve=Confirmada'],
  ['Corregir: lleva al redactor, con el foco y el mensaje empezado, sin formulario ni cifras de la tarjeta', 'armado-confirmar', '1440', '--clic=Corregir', ...REDACTOR_EMPEZADO, FILA('Productos', 'Por confirmar'), '--escribe=el tueste claro vale 26.000', '--clic=Enviar', `--ve=${EMPIEZA_A_CORREGIR}el tueste claro vale 26.000`],
  ['Corregir: en teléfono también llega al redactor', 'armado-confirmar', '390', '--clic=Corregir', ...REDACTOR_EMPEZADO],
  ['Corregir: la tarjeta nueva dice lo corregido, termina en Confirmada, y la vieja queda atrás', 'armado-corregida', '1440', TITULAR('¿Están bien estos productos?'), '--ve=Corrigió lo que leyó', '--ve=Quité Tueste claro, grano 250 g.', '--ve=Lo que encontré · 7 productos', '--clic=Ver lo anterior', '--ve=Descartada', '--clic=Ocultar lo anterior', '--clic=Están bien y no falta ninguno', '--espera=500', '--ve=Confirmada', FILA('Productos', 'Lo sé')],
  ['Corregir: si nada cambió, el rastro no dice que corrigió', 'armado-no-corrigio', '1440', '--ve=Revisó lo que leyó', '--no-ve=Corrigió lo que leyó'],
  ['Corregir: con el Negocio abierto, la misma tarjeta llega al redactor del Hilo', 'hilo-lectura-espera', '1440', '--clic=Corregir', ...REDACTOR_EMPEZADO],
  ['Corregir: con el Negocio abierto, en teléfono', 'hilo-lectura-espera', '390', '--clic=Corregir', ...REDACTOR_EMPEZADO],
  ['Corregir: solo en lo leído, una regla o un Caso no lo ofrecen', 'panel-un-caso', '1440', '--ve=Enviar', '--no-ve=Corregir'],
  ['Armado: el cobro se responde con un botón, y el paso sale de lo que se sabe', 'armado-cobro', '1440', TITULAR('Solo me falta una cosa.'), FILA('Cómo cobras', 'Falta'), '--clic=1Contra entrega', '--espera=500', TITULAR('Café Ladera puede abrir.'), FILA('Cómo cobras', 'Lo sé'), '--ve=Mis clientes me pagan contra entrega.'],
  ['Armado: el cobro también se responde con el número', 'armado-cobro', '1440', `--evalua=(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })); return 'listo' })()`, '--espera=500', '--ve=Mis clientes me pagan por transferencia.'],
  ['Armado: el cobro se puede dejar para después, y sigue sin marcarse', 'armado-cobro', '1440', '--clic=Te lo digo después', '--espera=500', TITULAR('Café Ladera puede abrir.'), FILA('Cómo cobras', 'Falta')],
  ['Armado: si faltan más cosas no dice que solo falta una', 'armado-cobro-con-mas-faltantes', '1440', TITULAR('Me falta saber cómo te pagan.')],
  ['Armado: el redactor sigue en todos los pasos', 'armado-listo', '1440', '--cierto=!!document.querySelector(\'textarea[aria-label="Escríbele a tu agente"]\')', '--ve=Abrir Café Ladera', '--ve=listo para abrir'],
  ['Armado: abrir saca el cielo hacia arriba y lleva a la operación', 'armado-listo', '1440', MUESTREAR_EL_CIELO, '--clic=Abrir Café Ladera', '--espera=1200', `--cierto=window.cielo.some(([o, y]) => o > 0 && o < 1 && y < 0 && y > -300)`, '--ve=Todavía no te ha escrito nadie.', `--cierto=!document.querySelector('.cielo')`],
  ['Armado: con prefers-reduced-motion el cielo sale sin recorrido y abrir igual lleva a la operación', 'armado-listo', '1440', '--menos-movimiento', MUESTREAR_EL_CIELO, '--clic=Abrir Café Ladera', '--espera=1200', `--cierto=window.cielo.length > 0 && window.cielo.every(([, y]) => y === 0 || y === -300)`, '--ve=Todavía no te ha escrito nadie.'],
  ['Armado: fuera del orden del guion, lo dicho se marca y el paso no se adelanta', 'armado-fuera-de-orden', '1440', TITULAR('Cuéntame de tu negocio.'), FILA('Cómo cobras', 'Lo sé'), FILA('Tono', 'Lo sé'), FILA('Nombre', 'Falta'), FILA('Productos', 'Falta'), '--no-ve=¿Cómo te pagan tus clientes?', '--no-ve=Abrir'],
  ['Armado: un nombre largo no saca el botón Abrir de la carta a 320', 'armado-textos-largos', '320', `--cierto=(() => { const s = document.querySelector('.cielo').nextElementSibling; return s.scrollWidth <= s.clientWidth })()`],
  ['Armado: en teléfono Tu Panel queda debajo de la carta', 'armado-listo', '390', `--cierto=document.querySelector('aside').getBoundingClientRect().top > document.querySelector('main').getBoundingClientRect().bottom`],
  ['Armado: en PC Tu Panel queda a la derecha', 'armado-listo', '1024', `--cierto=document.querySelector('aside').getBoundingClientRect().left >= document.querySelector('main').getBoundingClientRect().right`],
]

const CAJA = `document.querySelector('textarea')`
const CLAVE_ESCRITO = `localStorage.getItem('amanece:lo-escrito')`
const SIN_RUTA_DEL_AGENTE = `--cierto=performance.getEntriesByType('resource').every((r) => !r.name.includes('/api/dueno'))`
const MARCADOR_FIJO = `--cierto=${CAJA}.placeholder === 'Pega el link de tu negocio o cuéntame qué haces'`
const EN_ENTRAR = `--cierto=location.pathname === '/entrar'`

const RECORRIDOS_DE_ALBA: typeof RECORRIDOS = [
  ['Alba: pestañas y las tres plantillas, con Remixear y Ver', 'alba', '1440', '--ve=¿Qué hace tu negocio?', '--ve=Venta contra entrega', '--ve=Envíos y paquetería', '--ve=Servicios con agenda', '--ve=Remixear', '--ve=Ver', '--cierto=!!document.querySelector(\'a[href="/panel"]\')'],
  ['Alba: el título sobre el cielo va con --foreground', 'alba', '1440', `--cierto=getComputedStyle(document.querySelector('h1')).color === getComputedStyle(document.body).color`],
  ['Alba: la caja escribe ejemplos sola y se detiene cuando el Dueño escribe', 'alba', '1440', '--espera=1200', `--cierto=${CAJA}.placeholder !== 'Pega el link de tu negocio o cuéntame qué haces' && 'cafeladera.co'.startsWith(${CAJA}.placeholder)`, '--escribe=Vendo café', MARCADOR_FIJO, '--espera=1000', MARCADOR_FIJO],
  ['Alba: con prefers-reduced-motion no hay máquina de escribir', 'alba', '1440', '--menos-movimiento', '--espera=1500', MARCADOR_FIJO],
  ['Alba: Lo que puede hacer dice cuatro cosas', 'alba', '390', '--clic=Lo que puede hacer', '--espera=600', '--ve=Tomo pedidos y los confirmo', '--ve=Te busco solo cuando algo necesita tu decisión', `--cierto=document.querySelectorAll('[role=tabpanel] li').length === 4`],
  ['Alba: Ver abre lo que ve el Dueño junto a lo que ve el Cliente', 'alba', '390', '--clic=Ver', '--ve=Lo que ve tu Cliente en WhatsApp', '--ve=es un negocio de ejemplo', '--clic=Cerrar', '--espera=400', '--no-ve=Lo que ve tu Cliente en WhatsApp'],
  ['Alba: ninguna tarjeta nombra lo que el Panel no tiene', 'alba', '1440', '--no-ve=Bandeja', '--no-ve=Contactos', '--no-ve=Tarifas', '--no-ve=Pacientes', '--no-ve=Citas de hoy', '--no-ve=Agenda de hoy', '--no-ve=Agenda citas', '--no-ve=las recuerda', '--no-ve=sigue cada envío'],
  ['Alba: Remixear pone el chip en la caja y el cursor queda ahí', 'alba', '390', '--clic=Remixear', '--espera=500', '--ve=Parte de Venta contra entrega', '--ve=Elegida', `--cierto=document.activeElement === ${CAJA}`, '--clic=Quitar la plantilla', '--espera=400', '--no-ve=Parte de Venta contra entrega', '--no-ve=Elegida'],
  ['Alba: desde Ver también se remixea', 'alba', '1440', '--clic=Ver', '--espera=300', '--ve=nada de este ejemplo entra a tu negocio', `--evalua=[...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.includes('Remixear')).click()`, '--espera=500', '--ve=Parte de Venta contra entrega', '--no-ve=Lo que ve tu Cliente en WhatsApp', `--cierto=document.activeElement === ${CAJA}`],
  ['Alba: la plantilla viaja con lo escrito y llega al armado con su rastro', 'alba-al-armado', '1440', '--clic=Remixear', '--espera=400', '--escribe=Vendo mochilas en Cali', '--clic=Empezar', '--espera=800', '--ve=Vendo mochilas en Cali', '--ve=Parto de Venta contra entrega', `--cierto=${CLAVE_ESCRITO} === null`],
  ['Alba: volver de pedir la cuenta trae también la plantilla', 'alba', '1440', '--clic=Remixear', '--espera=400', '--escribe=Vendo mochilas', '--clic=Empezar', '--espera=4000', EN_ENTRAR, '--clic=Amanece', '--espera=2500', '--ve=Parte de Venta contra entrega', `--cierto=${CAJA}.value === 'Vendo mochilas'`],
  ['Armado: el rastro de la plantilla se queda aunque lo anterior esté plegado', 'armado-desde-plantilla', '390', '--ve=Parto de Servicios con agenda', '--no-ve=nada del ejemplo entra', '--clic=Ver lo anterior', '--espera=300', '--ve=nada del ejemplo entra'],
  ['Hilo: ya abierto ofrece lo que trae la plantilla, y el rastro sigue', 'hilo-desde-plantilla', '390', '--ve=Parto de Servicios con agenda', '--ve=Muéstrame quién me escribió esta semana', '--ve=Quiero ver cuántas conversaciones tengo por día', '--no-ve=Muéstrame los pedidos con novedad'],
  ['Alba: en teléfono las plantillas son un carrusel y la página no se desborda', 'alba', '390', `--cierto=(() => { const c = document.querySelector('[data-carrusel]'); return c.scrollWidth > c.clientWidth && document.documentElement.scrollWidth <= innerWidth })()`],
  ['Alba: sin texto no se empieza', 'alba', '1440', `--cierto=document.querySelector('button[aria-label=Empezar]').disabled`],
  ['Alba: lo escrito pasa por la puerta de sesión, llega a pedir la cuenta y no toca al agente', 'alba', '1440', '--escribe=Vendo café en Manizales', '--clic=Empezar', '--espera=4000', EN_ENTRAR, '--ve=Crear cuenta', '--ve=Vendo café en Manizales', '--ve=Crea tu cuenta y sigo', SIN_RUTA_DEL_AGENTE],
  ['Alba: quien ya tiene cuenta está a un toque y lo escrito sigue ahí', 'alba', '1440', '--escribe=Vendo café en Manizales', '--clic=Empezar', '--espera=4000', '--clic=¿Ya tienes cuenta', '--ve=Entra a tu negocio', '--ve=Entra y sigo', '--ve=Vendo café en Manizales'],
  ['Alba: Entrar con algo escrito tampoco lo pierde', 'alba', '1440', '--escribe=Agendo citas', '--clic=Entrar', '--espera=4000', EN_ENTRAR, '--ve=Agendo citas'],
  ['Alba: Entrar sin nada escrito lleva a entrar, no a registrarse', 'alba', '1440', '--clic=Entrar', '--espera=4000', EN_ENTRAR, '--ve=Entra a tu negocio', `--cierto=${CLAVE_ESCRITO} === null`],
  ['Alba: volver atrás trae lo escrito a la caja, y borrarlo lo olvida', 'alba', '1440', '--escribe=Vendo café', '--clic=Empezar', '--espera=4000', '--clic=Amanece', '--espera=2500', `--cierto=location.pathname === '/' && ${CAJA}.value === 'Vendo café'`, `--evalua=(() => { const c = ${CAJA}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(c, ''); c.dispatchEvent(new Event('input', { bubbles: true })); return 'borrado' })()`, '--espera=200', `--cierto=${CLAVE_ESCRITO} === null`],
  ['Alba: lo de hace más de un día ya no vuelve', 'alba', '1440', `--evalua=(() => { localStorage.setItem('amanece:lo-escrito', JSON.stringify({ texto: 'De ayer', hasta: Date.now() - 1 })); location.reload(); return 'recargando' })()`, '--espera=2500', `--cierto=${CAJA}.value === ''`],
  ['Alba: lo escrito llega al armado sin volver a escribir, una sola vez', 'alba-al-armado', '1440', '--escribe=Vendo café en Manizales', '--clic=Empezar', '--espera=800', '--ve=Vendo café en Manizales', TITULAR('Cuéntame de tu negocio.'), `--cierto=${CLAVE_ESCRITO} === null`, `--cierto=[...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && e.textContent === 'Vendo café en Manizales').length === 1`],
]

/** Con su límite: un recorrido colgado es una falla, no una suite esperando para siempre. */
const mirar = (base: string, ...argumentos: string[]) => spawnSync('tsx', [join(RAIZ, 'scripts/mirar-vitrina.mts'), ...argumentos], { cwd: RAIZ, encoding: 'utf8', timeout: 180_000, env: { ...process.env, VITRINA_URL: base } })

const hijos = new Set<ChildProcess>()

function matarHijos() {
  for (const h of hijos) {
    try {
      if (h.pid) process.kill(-h.pid, 'SIGKILL')
    } catch {
      // ya había salido
    }
  }
  hijos.clear()
}

process.on('exit', matarHijos)
for (const senal of ['SIGINT', 'SIGTERM'] as const) process.on(senal, () => process.exit(1))

function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const servidor = createServer()
    servidor.once('error', rechazar)
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address() as { port: number }
      servidor.close(() => resolver(port))
    })
  })
}

async function servir(modo: 'start' | 'dev', env: Record<string, string> = {}) {
  const puerto = await puertoLibre()
  const salida: string[] = []
  const hijo = spawn(process.execPath, [NEXT, modo, '-p', String(puerto), '-H', 'localhost'], {
    cwd: RAIZ,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  hijos.add(hijo)
  for (const flujo of [hijo.stdout, hijo.stderr]) flujo.on('data', (d: Buffer) => salida.push(String(d)))
  const base = `http://localhost:${puerto}`
  const limite = Date.now() + 180_000
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) throw new Error(`next ${modo} salió con ${hijo.exitCode}:\n${salida.join('').slice(-2000)}`)
    if (await fetch(`${base}/entrar`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) }).then((r) => r.status < 500, () => false)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  return {
    base,
    salida: () => salida.join('').slice(-2000),
    parar: () => {
      matarHijos()
    },
  }
}

const ver = (url: string, opciones: RequestInit = {}) => fetch(url, { signal: AbortSignal.timeout(120_000), redirect: 'manual', ...opciones })

function nombres(carpeta: string): string[] {
  return readdirSync(carpeta, { withFileTypes: true }).flatMap((e) => [e.name, ...(e.isDirectory() ? nombres(join(carpeta, e.name)) : [])])
}

console.log('\nqué tarjeta espera al Dueño')
{
  const tarjeta = (propuesta: string, accion: string, vence = '2099-01-01T00:00:00Z') => ({ id: propuesta, role: 'assistant', parts: [{ type: 'data-tarjeta', data: { propuesta, accion, vence } }] }) as never
  const espera = { estado: 'espera_al_dueno', accion: 'enviar', aprobadaPor: null, asunto: null, publicada: false } as const
  afirmar('Sin tarjetas no hay decisión', decisionQueEspera([], {}) === null)
  afirmar('La que espera al Dueño cuenta', decisionQueEspera([tarjeta('a', 'enviar')], { a: espera }) === 'a')
  afirmar('Una ya aplicada no cuenta', decisionQueEspera([tarjeta('a', 'aplicar')], { a: { ...espera, estado: 'aplicada' } }) === null)
  afirmar('Recién llegada en el stream cuenta si no venció', decisionQueEspera([tarjeta('a', 'aplicar')], {}) === 'a')
  afirmar('Vencida sin estado no cuenta', decisionQueEspera([tarjeta('a', 'aplicar', '2020-01-01T00:00:00Z')], {}) === null)
  afirmar('Deshacer no es una decisión que espera', decisionQueEspera([tarjeta('a', 'deshacer')], {}) === null)
  afirmar('Entre varias manda la más reciente', decisionQueEspera([tarjeta('a', 'enviar'), tarjeta('b', 'enviar')], { a: espera, b: espera }) === 'b')
  const vieja = tarjeta('vieja', 'confirmar', '2030-01-01T00:00:00Z')
  const nueva = tarjeta('nueva', 'confirmar', '2030-01-02T00:00:00Z')
  afirmar('Lo leído corregido: la vieja deja de esperar aunque su estado todavía no llegue', JSON.stringify(decisionesEnEspera([vieja, nueva], {}).map((t) => t.propuesta)) === '["nueva"]')
  const orden = decisionesEnEspera([tarjeta('r', 'aplicar', '2030-01-01T00:00:00Z'), tarjeta('c2', 'enviar', '2030-01-03T00:00:00Z'), tarjeta('c1', 'enviar', '2030-01-02T00:00:00Z'), tarjeta('d', 'deshacer')], {}).map((t) => t.propuesta)
  afirmar('La más urgente primero: lo que espera un Cliente y después lo que vence antes', orden.join() === 'c1,c2,r', orden)
}

console.log('\nuna tarjeta sigue pasando por sus rutas')
{
  const llamadas: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  const tarjeta = { propuesta: 'p1', huella: 'h1' } as never
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    return new Response(JSON.stringify({ tipo: 'descartada' }))
  }) as typeof fetch
  for (const accion of ['aprobar', 'descartar', 'deshacer'] as const) {
    const r = await tocarTarjeta(tarjeta, accion)
    const ultima = llamadas.at(-1)!
    afirmar(`${accion}: POST a su ruta con la huella`, ultima.url === `/api/propuestas/p1/${accion}` && ultima.init.method === 'POST' && ultima.init.body === JSON.stringify({ huella: 'h1' }) && r.tipo === 'descartada', ultima)
    afirmar(`${accion}: la ruta existe`, existsSync(join(RAIZ, `src/app/api/propuestas/[id]/${accion}/route.ts`)))
  }
  globalThis.fetch = (async () => {
    throw new Error('sin red')
  }) as typeof fetch
  afirmar('Sin red el error vuelve a la tarjeta', (await tocarTarjeta(tarjeta, 'aprobar')).tipo === 'error')
  afirmar('Sin red el error vuelve a Publicar', (await pedirPublicar('h1')).tipo === 'error')
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    return new Response(JSON.stringify({ error: 'No pude publicar. Vuelve a tocar el botón en un momento.' }), { status: 500 })
  }) as typeof fetch
  const fallida = await pedirPublicar('h1')
  const deLaRuta = llamadas.at(-1)!
  afirmar('Publicar: POST a su ruta con la huella', deLaRuta.url === '/api/publicar' && deLaRuta.init.method === 'POST' && deLaRuta.init.body === JSON.stringify({ huella: 'h1' }), deLaRuta)
  afirmar('Publicar: la ruta existe', existsSync(join(RAIZ, 'src/app/api/publicar/route.ts')))
  afirmar('Publicar: el error de la ruta llega con su texto', fallida.tipo === 'error' && fallida.mensaje.startsWith('No pude publicar'), fallida)
  globalThis.fetch = original
}

try {
  console.log('\nnext dev, sin base de datos ni sesión')
  const SIN_BASE = { DATABASE_URL: '', DATABASE_URL_UNPOOLED: '', DATABASE_URL_CONSULTAS: '' }
  let desarrollo = await servir('dev', SIN_BASE)
  const indice = await ver(`${desarrollo.base}/vitrina`)
  const html = await indice.text()
  afirmar('dev: /vitrina da 200', indice.status === 200, { estado: indice.status, servidor: desarrollo.salida() })
  const ids = [...html.matchAll(/href="\/vitrina\/([\w-]+)"/g)].map((m) => m[1])
  afirmar('dev: el índice enlaza las escenas esperadas', TODAS_LAS_ESCENAS.every((id) => ids.includes(id)), ids)

  for (const id of new Set([...ids, ...TODAS_LAS_ESCENAS])) {
    const r = await ver(`${desarrollo.base}/vitrina/${id}`)
    afirmar(`dev: /vitrina/${id} da 200`, r.status === 200, { estado: r.status, servidor: desarrollo.salida() })
  }

  const funcionando = await (await ver(`${desarrollo.base}/vitrina/panel-funcionando`)).text()
  afirmar('dev: panel-funcionando pinta el Negocio de prueba', funcionando.includes('Café Ladera') && funcionando.includes('Necesita tu ojo'))

  const noExiste = await ver(`${desarrollo.base}/vitrina/no-hay-esta`)
  afirmar('dev: una escena que no existe da 404', noExiste.status === 404, noExiste.status)
  const entrada = await (await ver(`${desarrollo.base}/entrar`)).text()
  afirmar('dev: /entrar pinta sin sesión ni base', entrada.includes('Entra a tu negocio') && entrada.includes('Con el correo y la contraseña'))
  afirmar('dev: /entrar?modo=registro abre en registro', (await (await ver(`${desarrollo.base}/entrar?modo=registro`)).text()).includes('Arma tu negocio'))

  for (const ruta of RUTAS_DEL_PANEL) {
    const panel = await ver(`${desarrollo.base}${ruta}`)
    afirmar(`dev: ${ruta} sin sesión redirige a /entrar`, [302, 307].includes(panel.status) && (panel.headers.get('location') ?? '').includes('/entrar'), { estado: panel.status, destino: panel.headers.get('location') })
  }

  // Teléfono y PC valen igual: ninguna escena se desborda a lo ancho a ninguno de los dos anchos.
  const captura = join(mkdtempSync(join(tmpdir(), 'vitrina-')), 'escena.png')
  for (const id of new Set([...ids, ...TODAS_LAS_ESCENAS])) {
    for (const [ancho, alto] of [['390', '844'], ['1440', '900']]) {
      const r = mirar(desarrollo.base, id, captura, ancho, alto)
      afirmar(`dev: ${id} cabe en ${ancho} px`, r.status === 0, r.stderr.slice(-500))
    }
  }
  for (const id of ESCENAS_DE_320) {
    const r = mirar(desarrollo.base, id, captura, '320', '700')
    afirmar(`dev: ${id} cabe en 320 px`, r.status === 0, r.stderr.slice(-500))
  }

  for (const [titulo, escena, anchoDeLaVentana, ...pasos] of [...RECORRIDOS_DE_LA_TOMA, ...RECORRIDOS_DEL_CASO, ...RECORRIDOS, ...RECORRIDOS_DEL_DETALLE, ...RECORRIDOS_DE_LISTAS, ...RECORRIDOS_DEL_TABLERO, ...RECORRIDOS_DEL_HILO, ...RECORRIDOS_DE_PUBLICAR, ...RECORRIDOS_DE_ESTADOS, ...RECORRIDOS_DEL_ARMADO, ...RECORRIDOS_DE_ALBA]) {
    const r = mirar(desarrollo.base, escena, captura, anchoDeLaVentana, '900', ...pasos)
    afirmar(titulo, r.status === 0, r.stderr.slice(-500))
  }

  // Tras cientos de páginas y unos 20 minutos, el mismo `next dev` deja de responderle a Chrome.
  desarrollo.parar()
  desarrollo = await servir('dev', SIN_BASE)
  for (const { vista, esqueleto, arriba } of ESQUELETOS_QUE_NO_SALTAN) {
    for (const anchoDeLaVentana of ['1440', '390']) {
      const medir = `--evalua=${JSON.stringify(arriba)}.map((s) => { const e = document.querySelector('[data-pano=lienzo] ' + s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)] })`
      const medidas = [vista, esqueleto].map((escena) => {
        const r = mirar(desarrollo.base, escena, captura, anchoDeLaVentana, '900', medir)
        if (!r.stdout.trim()) throw new Error(`${escena} a ${anchoDeLaVentana} no midió nada (estado ${r.status}, señal ${r.signal}): ${r.stderr.slice(-500)}`)
        return JSON.parse(r.stdout.split('\n')[0]) as ([number, number] | null)[]
      })
      const iguales = arriba.every((_, i) => medidas[0][i] && medidas[1][i] && Math.abs(medidas[0][i][0] - medidas[1][i][0]) <= 1 && Math.abs(medidas[0][i][1] - medidas[1][i][1]) <= 1)
      afirmar(`${esqueleto} a ${anchoDeLaVentana}: nada salta al llegar los datos`, iguales, { arriba, medidas })
    }
  }
  desarrollo.parar()

  console.log('\nbuild')
  const build = spawnSync(process.execPath, [NEXT, 'build'], { cwd: RAIZ, encoding: 'utf8', timeout: 540_000 })
  afirmar('next build termina bien', build.status === 0, `${build.stdout}\n${build.stderr}`.slice(-2000))

  const manifiesto = JSON.parse(readFileSync(join(RAIZ, '.next/app-path-routes-manifest.json'), 'utf8')) as Record<string, string>
  const rutas = Object.entries(manifiesto).flat()
  afirmar('El build publica cada Sección del Panel', RUTAS_DEL_PANEL.map((r) => r.replace('una-seccion', '[clave]').replace(/un-(pedido|cliente)/, '[id]')).every((r) => rutas.includes(r)), rutas)
  afirmar('El build no publica ninguna ruta de la vitrina', !rutas.some((r) => r.includes('vitrina')), rutas)
  const nombresDelServidor = nombres(join(RAIZ, '.next/server/app'))
  afirmar('Nada bajo .next/server/app se llama vitrina', !nombresDelServidor.some((n) => n.includes('vitrina')), nombresDelServidor.filter((n) => n.includes('vitrina')))

  const conDatosDePrueba = spawnSync('grep', ['-rl', 'Marcela Ríos', join(RAIZ, '.next/server'), join(RAIZ, '.next/static')], { encoding: 'utf8' }).stdout.trim()
  afirmar('Los datos inventados no salen en el build', conDatosDePrueba === '', conDatosDePrueba)

  console.log('\nnext start')
  const produccion = await servir('start')
  const portada = await ver(`${produccion.base}/`)
  const portadaEnTexto = await portada.text()
  afirmar('start: / es Alba, público y sin sesión', portada.status === 200 && portadaEnTexto.includes('¿Qué hace tu negocio?') && !portadaEnTexto.includes('Escríbele a Café Ladera'), portada.status)
  for (const ruta of ['/vitrina', '/vitrina/componentes']) {
    const r = await ver(`${produccion.base}${ruta}`)
    afirmar(`start: ${ruta} da 404`, r.status === 404, r.status)
  }
  produccion.parar()

} catch (error) {
  afirmar('La prueba de la vitrina corrió completa', false, error instanceof Error ? `${error.message} ${String(error.cause ?? '')}` : error)
} finally {
  matarHijos()
}

terminar()
