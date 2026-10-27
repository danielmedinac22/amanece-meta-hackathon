# Diseño del prototipo

Amanece para la hackatón de Meta, del 27 de octubre al 4 de noviembre de 2026. Es un prototipo que mide; las decisiones de Amanece se toman en su mapa, no aquí.

## La escena

1. **El Dueño se da de alta en la web** y conversa con su Agente del dueño, que le pregunta por el Negocio: qué vende, precios, ciudad, envíos, horario y tono. Con eso arma el catálogo y la configuración, y le entrega un link `wa.me` con el código del Negocio.
2. **Un Cliente abre el link**, le escribe al número de Amanece y lo atiende el Agente de clientes de ese Negocio: responde por el catálogo, toma el pedido y lo confirma.
3. **El Dueño pide un Cambio** y queda funcionando solo en su Negocio. Ejemplos: "si preguntan por envíos fuera de la ciudad, no prometas fecha y abre un Caso", o "quiero ver los pedidos confirmados por día".
4. **Cuando se abre un Caso**, el Agente del dueño lo trae al Hilo del Dueño con una propuesta. El Dueño la aprueba y el Agente de clientes le responde al Cliente.

## La frontera del Cambio

| Cambio | Qué se guarda | Quién lo ejecuta |
|---|---|---|
| Regla | Texto de la regla, versionado | El núcleo la inyecta en el Agente de clientes, que la cumple con sus herramientas (por ejemplo, abrir un Caso). |
| Conocimiento | Datos del Negocio: catálogo, envíos, horario, preguntas frecuentes | El núcleo, igual que la regla. |
| Indicador | Código generado: una función `calcular(datos)` que devuelve un número o una serie | Un intérprete aislado (QuickJS en WebAssembly), sin red ni disco, con tiempo y memoria limitados. |
| Sección | Código generado: una función `consultar(datos)` que devuelve filas, más una vista declarativa (tabla o tarjetas, columnas) | El mismo intérprete aislado. La vista la pinta un componente fijo. |

**El aislamiento se garantiza por construcción.** El servidor saca el Negocio de la sesión del Dueño, carga solo sus datos y se los pasa a la función. El código generado no puede pedir nada más porque no tiene con qué.

**Ver antes de aplicar.** Un Cambio se propone, corre contra los datos del Negocio y el Dueño ve el resultado antes de aplicarlo. La vista previa nunca le escribe a un Cliente.

**Revertir** vuelve a la versión anterior de la regla o del código. Lo que la regla ya hizo con Clientes no se deshace y queda en el historial.

**Qué no hace el núcleo, ni con un Cambio:**
- mandar desde un número que no sea el de Amanece;
- escribirle a un Cliente fuera de la ventana de 24 horas;
- mandar mensajes publicitarios fuera del horario de la Ley 2300.

Lo que el núcleo no sabe hacer queda registrado como Capacidad faltante.

## Medición, que vuelve al mapa

Cada Cambio guarda tokens de entrada y salida, costo estimado y latencia, desde el pedido hasta que queda aplicado. Lo mismo cada turno de los agentes. La página `/medicion` lo muestra.

## Piezas

- **Next.js** (App Router) en Vercel, TypeScript, pnpm.
- **Postgres con Drizzle.** En desarrollo corre en Docker; en producción, una base administrada.
- **Clerk** para el alta y el inicio de sesión. Cada Dueño queda ligado a su Negocio.
- **Modelos de Meta** por `api.meta.ai/v1` con el SDK de Vercel AI (`@ai-sdk/openai-compatible`). El modelo se elige con `MODEL_ID`: `muse-spark-1.3-contributor` para probar, `muse-spark-1.3` cuando lo prueben personas.
- **Kapso.** Por el webhook `whatsapp.message.received`, firmado, entran los mensajes del número de Amanece; por la API de Kapso salen las respuestas. Un solo número para todos los Negocios: el código del link `wa.me` dice a qué Negocio habla cada Cliente.

## Qué es nuevo

Todo el código de este repo se escribió durante la hackatón, después del kickoff del 26 de octubre de 2026. Waichat, Aura y Eurocolombia, los productos previos de Daniel, solo se leyeron como referencia; no se copió código de ellos.
