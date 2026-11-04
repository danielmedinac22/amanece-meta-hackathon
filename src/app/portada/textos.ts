export type Idioma = 'es' | 'en'

/** Solo las Secciones que tiene un Panel de verdad. Algo que el Panel no tiene no se puede poner en una tarjeta. */
export type SeccionDePlantilla = 'Inicio' | 'Casos' | 'Conversaciones' | 'Pedidos' | 'Clientes' | 'Tablero'

/** Dónde vive la portada de cada idioma. */
export const RUTA_DE_IDIOMA: Record<Idioma, string> = { es: '/', en: '/en' }

/** Un texto con partes en negrita, para que el diccionario no lleve HTML. */
export type Frase = readonly (string | { readonly fuerte: string })[]

export type MensajeDeMuestra = { readonly de: 'cliente' | 'agente'; readonly texto: string; readonly hora?: string }

export type AccionDeMuestra = { readonly texto: string; readonly resultado: string }

type DatosDeTarjeta = { readonly etiqueta: string; readonly principal: AccionDeMuestra; readonly secundaria: AccionDeMuestra; readonly nota: string }

export type Pieza =
  | { readonly tipo: 'conversacion'; readonly negocio: string; readonly mensajes: readonly MensajeDeMuestra[] }
  | { readonly tipo: 'lista'; readonly filas: readonly string[] }
  | { readonly tipo: 'frase'; readonly frase: Frase; readonly encabezado: { readonly titulo: string; readonly estado: string } | null }
  | (DatosDeTarjeta & { readonly tipo: 'caso'; readonly titulo: string; readonly escribio: string; readonly respuesta: string })
  | (DatosDeTarjeta & { readonly tipo: 'indicador'; readonly titulo: string; readonly barras: readonly number[] })

export type Momento = { readonly hora: string; readonly meridiano: 'am' | 'pm'; readonly titulo: string; readonly pieza: Pieza }

export type Pregunta = { readonly pregunta: string; readonly respuesta: string; readonly porQue: string; readonly caso: { readonly titulo: string; readonly respuesta: string } | null }

export type IconoDeRubro = 'paquete' | 'camion' | 'agenda'

export type TextosDeDificil = {
  readonly titulo: string
  readonly subtitulo: string
  readonly preguntale: string
  readonly negocio: string
  readonly loQueTeLlega: string
  readonly nada: string
  readonly porQue: string
  readonly nota: string
  readonly tarjeta: DatosDeTarjeta
  readonly preguntas: readonly Pregunta[]
}

export type TextosDePortada = {
  readonly meta: { readonly titulo: string; readonly descripcion: string }
  readonly idioma: { readonly grupo: string }
  readonly entrar: string
  readonly cta: string
  readonly enLinea: string
  readonly alba: {
    readonly titulo: string
    readonly subtitulo: string
    readonly ejemplos: readonly string[]
    readonly marcador: string
    readonly siTienesPagina: string
    readonly empezar: string
    readonly parteDe: string
    readonly quitarPlantilla: string
    readonly plantillas: string
    readonly loQuePuede: string
    readonly filasDeLoQuePuede: readonly { readonly que: string; readonly ejemplo: string }[]
    readonly nota: string
  }
  readonly plantillas: {
    readonly remixear: string
    readonly elegida: string
    readonly ver: string
    readonly verComoQueda: string
    readonly cerrar: string
    readonly loQueVes: string
    readonly loQueVeTuCliente: string
    readonly esDeEjemplo: string
    readonly secciones: Readonly<Record<SeccionDePlantilla, string>>
  }
  readonly dia: { readonly titulo: string; readonly nota: string; readonly momentos: readonly Momento[] }
  readonly rubros: {
    readonly titulo: string
    readonly subtitulo: string
    readonly nota: string
    readonly tarjetas: readonly { readonly icono: IconoDeRubro; readonly titulo: string; readonly descripcion: string; readonly negocio: string; readonly mensajes: readonly MensajeDeMuestra[] }[]
  }
  readonly dificil: TextosDeDificil
  readonly qr: { readonly alt: string; readonly titulo: string; readonly descripcion: string; readonly aviso: string; readonly boton: string }
  readonly preguntas: { readonly titulo: string; readonly lista: readonly { readonly pregunta: string; readonly respuesta: string }[] }
  readonly cierre: { readonly titulo: string }
  readonly pie: { readonly texto: string }
}

export const TEXTOS: Record<Idioma, TextosDePortada> = {
  es: {
    meta: { titulo: 'Amanece: arma tu agente gratis', descripcion: 'Arma conversando el agente que atiende a tus clientes por WhatsApp.' },
    idioma: { grupo: 'Idioma' },
    entrar: 'Entrar',
    cta: 'Arma tu agente gratis',
    enLinea: 'en línea',
    alba: {
      titulo: '¿Qué hace tu negocio?',
      subtitulo: 'Cuéntaselo a tu agente. Él arma otro que les contesta a tus clientes por WhatsApp, y lo que necesite tu decisión te espera en la mañana.',
      ejemplos: ['cafeladera.co', 'Vendo ropa contra entrega en Medellín y me preguntan por tallas todo el día.', 'Tengo un consultorio en Pereira y todo el día me preguntan precios y horarios.', 'Envío paquetes entre Bogotá y la costa, y todo el día me preguntan a dónde llego.'],
      marcador: 'Pega el link de tu negocio o cuéntame qué haces',
      siTienesPagina: 'Si tienes página, la leo',
      empezar: 'Empezar',
      parteDe: 'Parte de',
      quitarPlantilla: 'Quitar la plantilla',
      plantillas: 'Plantillas',
      loQuePuede: 'Lo que puede hacer',
      filasDeLoQuePuede: [
        { que: 'Le respondo a tus Clientes por WhatsApp', ejemplo: 'Sí, te llega a Pereira en 3 días.' },
        { que: 'Tomo pedidos y los confirmo', ejemplo: 'Tu pedido #41 quedó por $76.000. Pagas al recibir.' },
        { que: 'Te busco solo cuando algo necesita tu decisión', ejemplo: 'Una bolsa llegó rota. ¿Se la repongo?' },
        { que: 'Te agrego al Panel lo que quieras ver de tus datos', ejemplo: 'Muéstrame los pedidos confirmados por día.' },
      ],
      nota: 'Negocios y cifras de ejemplo.',
    },
    plantillas: {
      remixear: 'Remixear',
      elegida: 'Elegida',
      ver: 'Ver',
      verComoQueda: 'Ver cómo queda',
      cerrar: 'Cerrar',
      loQueVes: 'Lo que tú ves',
      loQueVeTuCliente: 'Lo que ve tu Cliente en WhatsApp',
      esDeEjemplo: 'es un negocio de ejemplo. Al remixear, tu agente arma el tuyo con tus datos, y nada de este ejemplo entra a tu negocio.',
      secciones: { Inicio: 'Inicio', Casos: 'Casos', Conversaciones: 'Conversaciones', Pedidos: 'Pedidos', Clientes: 'Clientes', Tablero: 'Tablero' },
    },
    dia: {
      titulo: 'Un día cualquiera en tu negocio.',
      nota: 'Negocio y cifras de ejemplo.',
      momentos: [
        {
          hora: '11:47',
          meridiano: 'pm',
          titulo: 'Una clienta pregunta por una talla. Tú ya te acostaste.',
          pieza: {
            tipo: 'conversacion',
            negocio: 'Tienda Rosal',
            mensajes: [
              { de: 'cliente', texto: 'Hola, ¿tienen la blusa negra en M?', hora: '11:47 pm' },
              { de: 'agente', texto: 'Sí, en M la tenemos. $89.000 y pagas al recibir. ¿Te la confirmo?', hora: '11:47 pm' },
            ],
          },
        },
        {
          hora: '2:10',
          meridiano: 'am',
          titulo: 'Camila compra de madrugada. Su pedido queda confirmado.',
          pieza: { tipo: 'lista', filas: ['Pedido de Camila confirmado', 'Dirección y ciudad anotadas', 'Listo para que lo despaches en la mañana'] },
        },
        {
          hora: '6:12',
          meridiano: 'am',
          titulo: 'Amaneció. Abres tu Panel y ves lo que pasó de noche.',
          pieza: { tipo: 'frase', encabezado: null, frase: ['Anoche hubo ', { fuerte: '14 conversaciones' }, ', entraron ', { fuerte: '6 pedidos' }, ' y hay ', { fuerte: 'un caso' }, ' para ti.'] },
        },
        {
          hora: '9:30',
          meridiano: 'am',
          titulo: 'Te trae lo único que necesita tu decisión, con la respuesta lista.',
          pieza: {
            tipo: 'caso',
            etiqueta: 'Caso',
            titulo: 'Sofía quiere cambiar su dirección',
            escribio: 'Sofía escribió: “Me mudé. ¿Me pueden cambiar la dirección? Ya salió el pedido.”',
            respuesta: 'Hola Sofía. Tu pedido ya salió. Le pido el cambio a la transportadora y te aviso hoy mismo.',
            principal: { texto: 'Enviar', resultado: 'Enviada a Sofía' },
            secundaria: { texto: 'Descartar', resultado: 'Descartada' },
            nota: 'Le llega a Sofía',
          },
        },
        {
          hora: '12:20',
          meridiano: 'pm',
          titulo: 'Le pides ver los pedidos confirmados por día, como se lo pedirías a alguien de tu equipo.',
          pieza: {
            tipo: 'indicador',
            etiqueta: 'Indicador en vista previa',
            titulo: 'Pedidos confirmados por día',
            barras: [44, 62, 52, 78, 70, 100],
            principal: { texto: 'Publicar', resultado: 'Publicada' },
            secundaria: { texto: 'Deshacer', resultado: 'Deshecha' },
            nota: 'Ya salió de tus datos',
          },
        },
        {
          hora: '6:40',
          meridiano: 'pm',
          titulo: 'Cierras el día. Tu agente sigue contestando.',
          pieza: { tipo: 'frase', encabezado: { titulo: 'Inicio', estado: 'Atendiendo' }, frase: ['Hoy te escribieron ', { fuerte: '41 personas' }, ' y ', { fuerte: '12 ya compraron' }, '.'] },
        },
      ],
    },
    rubros: {
      titulo: 'Cada negocio arma el suyo.',
      subtitulo: 'Así se ve en tres rubros. El tuyo queda con tus productos y tus reglas.',
      nota: 'Negocios y precios de ejemplo.',
      tarjetas: [
        {
          icono: 'paquete',
          titulo: 'Venta contra entrega',
          descripcion: 'Confirma pedidos antes de despachar y te trae el que necesita tu decisión.',
          negocio: 'Tienda Rosal',
          mensajes: [
            { de: 'cliente', texto: '¿Tienen la blusa en talla M?' },
            { de: 'agente', texto: 'Sí. Te queda en $89.000 y pagas al recibir. ¿La confirmo?' },
          ],
        },
        {
          icono: 'camion',
          titulo: 'Envíos y paquetería',
          descripcion: 'Contesta a dónde llegas y cuánto cobras, con lo que le contaste, y le dice a cada cliente en qué va su pedido.',
          negocio: 'Envíos Cordillera',
          mensajes: [
            { de: 'cliente', texto: '¿Cuánto vale una caja de 5 kilos a Pereira?' },
            { de: 'agente', texto: 'A Pereira, $24.500. ¿Te lo dejo listo?' },
          ],
        },
        {
          icono: 'agenda',
          titulo: 'Servicios con agenda',
          descripcion: 'Contesta precios, horarios y preguntas de tu consultorio o local. Todavía no agenda: quien quiere cita te llega a ti.',
          negocio: 'Consultorio Arrayán',
          mensajes: [
            { de: 'cliente', texto: '¿Atienden los sábados?' },
            { de: 'agente', texto: 'Sí, de 8 a 12. Si quieres cita, le aviso al consultorio.' },
          ],
        },
      ],
    },
    dificil: {
      titulo: 'Hazle la pregunta difícil.',
      subtitulo: 'Lo que preocupa de dejar a alguien contestando es lo que pueda decir. Sé el cliente de Café Ladera y míralo tú.',
      preguntale: 'Pregúntale',
      negocio: 'Café Ladera',
      loQueTeLlega: 'Lo que te llega a ti, el dueño',
      nada: 'Nada. Lo resolvió solo.',
      porQue: 'Por qué contestó así',
      nota: 'Negocio, precios y respuestas de ejemplo.',
      tarjeta: { etiqueta: 'Caso', principal: { texto: 'Enviar', resultado: 'Enviada al cliente' }, secundaria: { texto: 'Descartar', resultado: 'Descartada' }, nota: 'Tú decides' },
      preguntas: [
        {
          pregunta: '¿Me la dejas en $20.000?',
          respuesta: 'Esa bolsa vale $38.000 y no puedo cambiar el precio. Si quieres, le paso tu pregunta al equipo.',
          porQue: 'Un precio que no está en tu catálogo no sale. Cada respuesta se revisa antes de enviarse.',
          caso: null,
        },
        {
          pregunta: '¿Eres una persona?',
          respuesta: 'No, soy el asistente virtual de Café Ladera. Si prefieres hablar con alguien del equipo, le paso tu mensaje.',
          porQue: 'Nunca dice que es una persona.',
          caso: null,
        },
        {
          pregunta: '¿Este café me sirve para la gastritis?',
          respuesta: 'Eso no te lo puedo asegurar, mejor consúltalo con tu médico. Lo que sí te puedo contar es cómo es cada café.',
          porQue: 'No dice que tu producto cure nada.',
          caso: null,
        },
        {
          pregunta: 'Me llegó la bolsa rota.',
          respuesta: 'Qué pena contigo. Ya se lo pasé al equipo y te responden por aquí.',
          porQue: 'Una queja no la resuelve adivinando. Te la trae con una respuesta lista.',
          caso: { titulo: 'Un cliente recibió una bolsa rota', respuesta: 'Hola. Qué pena lo de la bolsa. ¿Me mandas una foto para reponértela?' },
        },
        {
          pregunta: 'Necesito 30 bolsas para mi oficina.',
          respuesta: 'Qué bueno. Ya le pasé tu pedido al equipo y te responden por aquí.',
          porQue: 'Lo que se sale de lo normal te llega a ti. El pedido grande no se pierde esperando.',
          caso: { titulo: 'Piden 30 bolsas para una oficina', respuesta: 'Hola. Claro, te despachamos las 30. ¿A qué dirección y para cuándo las necesitas?' },
        },
      ],
    },
    qr: {
      alt: 'Código QR para escribirle a Café Ladera por WhatsApp',
      titulo: 'Escríbele a uno que ya atiende.',
      descripcion: 'Café Ladera es un negocio de muestra que funciona con Amanece. Escríbele y te contesta su agente, en tu teléfono.',
      aviso: 'WhatsApp te deja escrito (LADERA) Hola Café Ladera. Envíalo así, porque el código le dice a qué negocio le escribes.',
      boton: 'Escríbele a Café Ladera',
    },
    preguntas: {
      titulo: 'Lo que te vas a preguntar.',
      lista: [
        { pregunta: '¿Tengo que saber de tecnología?', respuesta: 'No. Le cuentas a tu agente cómo trabajas, como le contarías a alguien que entra nuevo.' },
        { pregunta: '¿Usa mi número de WhatsApp?', respuesta: 'Todavía no. Tu agente atiende desde el número de Amanece y tú compartes un link con el código de tu negocio. Ponlo donde hoy das tu WhatsApp.' },
        { pregunta: '¿Y si el agente no sabe algo?', respuesta: 'Te trae el caso con una respuesta lista, y tú decides si se envía. A tu cliente le dice que ya se lo pasó al equipo.' },
        { pregunta: '¿Mis clientes ven lo que cambio?', respuesta: 'Solo lo que apruebes. Cada regla te llega en una tarjeta y empieza a contar cuando tocas Aplicar. Solo cambia tu negocio.' },
        { pregunta: '¿Qué no hace todavía?', respuesta: 'No cobra, no agenda citas y no le escribe primero a tus clientes. Tampoco se conecta con tu tienda en línea ni con una transportadora. Si se lo pides, le queda anotado al equipo de Amanece.' },
        { pregunta: '¿Funciona fuera de Colombia?', respuesta: 'Por ahora está hecho para Colombia, con precios en pesos y el agente en español.' },
      ],
    },
    cierre: { titulo: 'Esta noche alguien te va a escribir. Que tenga quién le conteste.' },
    pie: { texto: 'Funciona con Muse Spark de Meta. Hecho en Colombia.' },
  },
  en: {
    meta: { titulo: 'Amanece: build your agent for free', descripcion: 'Build, just by talking, the agent that answers your customers on WhatsApp.' },
    idioma: { grupo: 'Language' },
    entrar: 'Log in',
    cta: 'Build your agent for free',
    enLinea: 'online',
    alba: {
      titulo: 'What does your business do?',
      subtitulo: 'Tell your agent. It builds another one to answer your customers on WhatsApp, and whatever needs your call is waiting for you in the morning.',
      ejemplos: ['cafeladera.co', 'I sell clothes cash on delivery in Medellín and get asked about sizes all day.', 'I run a practice in Pereira and get asked about prices and hours all day.', 'I ship parcels between Bogotá and the coast and get asked all day where I deliver.'],
      marcador: 'Paste your business link or tell me what you do',
      siTienesPagina: 'If you have a website, I’ll read it',
      empezar: 'Start',
      parteDe: 'Starts from',
      quitarPlantilla: 'Remove the template',
      plantillas: 'Templates',
      loQuePuede: 'What it can do',
      filasDeLoQuePuede: [
        { que: 'I answer your customers on WhatsApp', ejemplo: 'Yes, it reaches Pereira in 3 days.' },
        { que: 'I take orders and confirm them', ejemplo: 'Your order #41 comes to COP 76,000. You pay on delivery.' },
        { que: 'I only come to you when something needs your call', ejemplo: 'A bag arrived torn. Should I replace it?' },
        { que: 'I add anything you want to see from your data to your Panel', ejemplo: 'Show me confirmed orders per day.' },
      ],
      nota: 'Sample businesses and figures.',
    },
    plantillas: {
      remixear: 'Remix',
      elegida: 'Chosen',
      ver: 'View',
      verComoQueda: 'See how this looks:',
      cerrar: 'Close',
      loQueVes: 'What you see',
      loQueVeTuCliente: 'What your customer sees on WhatsApp',
      esDeEjemplo: 'is a sample business. When you remix it, your agent builds yours with your data, and nothing from this sample enters your business.',
      secciones: { Inicio: 'Home', Casos: 'Cases', Conversaciones: 'Conversations', Pedidos: 'Orders', Clientes: 'Customers', Tablero: 'Overview' },
    },
    dia: {
      titulo: 'Any given day in your business.',
      nota: 'Sample business and figures.',
      momentos: [
        {
          hora: '11:47',
          meridiano: 'pm',
          titulo: 'A customer asks about a size. You’re already in bed.',
          pieza: {
            tipo: 'conversacion',
            negocio: 'Tienda Rosal',
            mensajes: [
              { de: 'cliente', texto: 'Hi, do you have the black blouse in M?', hora: '11:47 pm' },
              { de: 'agente', texto: 'Yes, we have it in M. COP 89,000, pay on delivery. Shall I confirm it?', hora: '11:47 pm' },
            ],
          },
        },
        {
          hora: '2:10',
          meridiano: 'am',
          titulo: 'Camila buys at 2 am. Her order gets confirmed.',
          pieza: { tipo: 'lista', filas: ['Camila’s order confirmed', 'Address and city noted', 'Ready for you to ship in the morning'] },
        },
        {
          hora: '6:12',
          meridiano: 'am',
          titulo: 'The sun’s up. You open your Panel and see what happened overnight.',
          pieza: { tipo: 'frase', encabezado: null, frase: [{ fuerte: '14 conversations' }, ' last night, ', { fuerte: '6 new orders' }, ' and ', { fuerte: 'one case' }, ' for you.'] },
        },
        {
          hora: '9:30',
          meridiano: 'am',
          titulo: 'It brings you the one thing that needs your call, reply already written.',
          pieza: {
            tipo: 'caso',
            etiqueta: 'Case',
            titulo: 'Sofía wants to change her address',
            escribio: 'Sofía wrote: “I moved. Can you change my address? The order already shipped.”',
            respuesta: 'Hi Sofía. Your order already shipped. I’ll ask the carrier to change it and let you know today.',
            principal: { texto: 'Send', resultado: 'Sent to Sofía' },
            secundaria: { texto: 'Dismiss', resultado: 'Dismissed' },
            nota: 'Goes to Sofía',
          },
        },
        {
          hora: '12:20',
          meridiano: 'pm',
          titulo: 'You ask to see confirmed orders per day, the way you’d ask someone on your team.',
          pieza: {
            tipo: 'indicador',
            etiqueta: 'New number, in preview',
            titulo: 'Confirmed orders per day',
            barras: [44, 62, 52, 78, 70, 100],
            principal: { texto: 'Publish', resultado: 'Published' },
            secundaria: { texto: 'Undo', resultado: 'Undone' },
            nota: 'Built from your data',
          },
        },
        {
          hora: '6:40',
          meridiano: 'pm',
          titulo: 'You call it a day. Your agent keeps answering.',
          pieza: { tipo: 'frase', encabezado: { titulo: 'Home', estado: 'Answering' }, frase: [{ fuerte: '41 people' }, ' wrote to you today and ', { fuerte: '12 already bought' }, '.'] },
        },
      ],
    },
    rubros: {
      titulo: 'Every business builds its own.',
      subtitulo: 'Here’s how it looks in three kinds of business. Yours runs on your products and your rules.',
      nota: 'Sample businesses and prices.',
      tarjetas: [
        {
          icono: 'paquete',
          titulo: 'Cash on delivery',
          descripcion: 'Confirms orders before they ship and brings you the ones that need your call.',
          negocio: 'Tienda Rosal',
          mensajes: [
            { de: 'cliente', texto: 'Do you have the blouse in size M?' },
            { de: 'agente', texto: 'Yes. It’s COP 89,000 and you pay on delivery. Shall I confirm it?' },
          ],
        },
        {
          icono: 'camion',
          titulo: 'Shipping and parcels',
          descripcion: 'Answers where you deliver and what you charge, from what you told it, and tells each customer where their order stands.',
          negocio: 'Envíos Cordillera',
          mensajes: [
            { de: 'cliente', texto: 'How much for a 5 kg box to Pereira?' },
            { de: 'agente', texto: 'To Pereira, COP 24,500. Want me to set it up?' },
          ],
        },
        {
          icono: 'agenda',
          titulo: 'Appointment businesses',
          descripcion: 'Answers prices, hours and questions for your practice or shop. It can’t book yet, so anyone who wants an appointment comes to you.',
          negocio: 'Consultorio Arrayán',
          mensajes: [
            { de: 'cliente', texto: 'Are you open Saturdays?' },
            { de: 'agente', texto: 'Yes, 8 to noon. If you want an appointment, I’ll let the office know.' },
          ],
        },
      ],
    },
    dificil: {
      titulo: 'Ask it the hard question.',
      subtitulo: 'The worry with letting someone answer for you is what they might say. Be a Café Ladera customer and see for yourself.',
      preguntale: 'Ask it',
      negocio: 'Café Ladera',
      loQueTeLlega: 'What reaches you, the owner',
      nada: 'Nothing. It handled this on its own.',
      porQue: 'Why it answered that way',
      nota: 'Sample business, prices and replies.',
      tarjeta: { etiqueta: 'Case', principal: { texto: 'Send', resultado: 'Sent to the customer' }, secundaria: { texto: 'Dismiss', resultado: 'Dismissed' }, nota: 'Your call' },
      preguntas: [
        {
          pregunta: 'Can you do it for COP 20,000?',
          respuesta: 'That bag is COP 38,000 and I can’t change the price. If you’d like, I’ll pass your question to the team.',
          porQue: 'A price that isn’t in your catalog doesn’t go out. Every reply is checked before it’s sent.',
          caso: null,
        },
        {
          pregunta: 'Are you a person?',
          respuesta: 'No, I’m Café Ladera’s virtual assistant. If you’d rather talk to someone on the team, I’ll pass your message along.',
          porQue: 'It never says it’s a person.',
          caso: null,
        },
        {
          pregunta: 'Will this coffee help my gastritis?',
          respuesta: 'I can’t promise that, so it’s best to ask your doctor. What I can tell you is what each coffee is like.',
          porQue: 'It won’t claim your product cures anything.',
          caso: null,
        },
        {
          pregunta: 'My bag arrived torn.',
          respuesta: 'I’m so sorry. I’ve passed this to the team and they’ll answer you here.',
          porQue: 'It doesn’t guess its way through a complaint. It brings it to you with a reply ready.',
          caso: { titulo: 'A customer got a torn bag', respuesta: 'Hi. I’m sorry about the bag. Could you send me a photo so I can replace it?' },
        },
        {
          pregunta: 'I need 30 bags for my office.',
          respuesta: 'Great. I’ve passed your order to the team and they’ll answer you here.',
          porQue: 'Anything out of the ordinary comes to you, so a big order doesn’t get lost.',
          caso: { titulo: 'Someone wants 30 bags for an office', respuesta: 'Hi. Sure, we can ship all 30. What address, and when do you need them?' },
        },
      ],
    },
    qr: {
      alt: 'QR code to message Café Ladera on WhatsApp',
      titulo: 'Text one that’s already live.',
      descripcion: 'Café Ladera is a sample business running on Amanece. Text it and its agent answers on your phone.',
      aviso: 'WhatsApp fills in (LADERA) Hola Café Ladera. Send it as is. The code tells it which business you’re writing to.',
      boton: 'Text Café Ladera',
    },
    preguntas: {
      titulo: 'What you’ll want to ask.',
      lista: [
        { pregunta: 'Do I need to be technical?', respuesta: 'No. You tell your agent how you work, the way you’d explain it to a new hire.' },
        { pregunta: 'Does it use my WhatsApp number?', respuesta: 'Not yet. Your agent answers from Amanece’s number, and you share a link with your business’s code. Put it wherever you share your WhatsApp today.' },
        { pregunta: 'What if the agent doesn’t know something?', respuesta: 'It brings you the case with a reply ready, and you decide whether it goes out. It tells your customer it has passed this to the team.' },
        { pregunta: 'Will my customers see what I change?', respuesta: 'Only what you approve. Each rule comes to you on a card and takes effect when you tap Apply. It only changes your business.' },
        { pregunta: 'What can’t it do yet?', respuesta: 'It doesn’t take payments, book appointments or message customers first. It doesn’t connect to your online store or a carrier either. If you ask, your request goes to the Amanece team.' },
        { pregunta: 'Does it work outside Colombia?', respuesta: 'Not yet. For now it’s built for Colombia, with prices in pesos and the agent in Spanish.' },
      ],
    },
    cierre: { titulo: 'Someone’s going to text you tonight. Make sure they get an answer.' },
    pie: { texto: 'Runs on Muse Spark from Meta. Made in Colombia.' },
  },
}
