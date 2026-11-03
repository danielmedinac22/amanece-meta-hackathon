# Diseño

Este repo es la base de código de Amanece. Arrancó en la hackatón de Meta, del 27 de octubre al 4 de noviembre de 2026, y se construye con el mismo método que el proyecto completo. Lo escrito hasta ahora es el primer diseño: entra al mapa de decisiones de Amanece como un candidato más, y cambia cuando esas decisiones cierren.

## La escena

1. **El Dueño se da de alta en la web** y conversa con su Agente del dueño, que le pregunta por el Negocio: qué vende, precios, ciudad, envíos, horario y tono. Con eso arma el catálogo y la configuración, y le entrega un link `wa.me` con el código del Negocio.
2. **Un Cliente abre el link**, le escribe al número de Amanece y lo atiende el Agente de clientes de ese Negocio: responde por el catálogo, toma el pedido y lo confirma.
3. **El Dueño pide un Cambio**, lo ve en su vista previa y lo manda a su link con **Publicar**. Solo le toca a su Negocio. Ejemplos: "si preguntan por envíos fuera de la ciudad, no prometas fecha y abre un Caso", o "quiero ver los pedidos confirmados por día".
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

**Revertir** vuelve a la versión anterior de la regla o del código. Lo que la regla ya hizo con Clientes no se deshace y queda en el historial. Revertir algo que los Clientes ya tienen les llega de una, sin Publicar, porque frena. Revertir algo sin publicar solo lo saca de la vista previa.

## Aplicado y publicado

Lo aplicado es lo que ve el Dueño: su vista previa. Lo publicado es lo que notan sus Clientes: el Agente de clientes atiende con eso.

| Cambio | Tarjeta | Después |
|---|---|---|
| Indicador o Sección | Muestra el resultado, ya en la vista previa, y solo ofrece Deshacer | Publicar |
| Regla o conocimiento | Muestra la vista previa y ofrece Aplicar y Descartar | Publicar |

- **Publicar es un botón del Dueño.** El Agente del dueño lo explica y no lo toca. Publicar manda todo lo que está sin publicar, y la huella lo ata a la lista que el Dueño vio: si otro Dueño aplicó algo más, no se publica nada y vuelve la lista nueva.
- **Se guarda en una sola fila.** Cada fila de `elementos` lleva `sin_publicar`, y solo baja de true a false. Abajo quiere decir que les llegó a los Clientes. Lo aplicado es la última fila de cada clave. Lo publicado es la última fila de cada clave con el bit abajo. `escribir` decide con qué bit nace una fila, y solo `src/nucleo/estado/escribir.ts` lo baja.
- **Publicar sella solo lo que el Dueño vio en la lista:** la última fila de cada clave que difiere de lo publicado. Una fila que quedó enterrada, o una clave editada y devuelta a lo publicado, se queda con el bit arriba para siempre, porque nunca les llegó a los Clientes. Por eso lo que frena devuelve lo que los Clientes tenían: la última fila sellada por debajo de lo revertido.
- **Lo que no espera Publicar:** responder un Caso, que es un mensaje; y mientras se arma, porque no hay Clientes reales. Abrir el Negocio es la primera publicación.
- **"Solo lo ve el equipo" todavía no le cambia la pantalla a nadie:** hoy solo existe el Dueño, y los Dueños ven la vista previa. Un Indicador se guarda, se cuenta y se publica igual.
- **Por WhatsApp no hay botón todavía.** Publicar se toca en la web.
- **Corte y vuelta atrás:** la migración va antes del código y no copia nada, porque el `DEFAULT` deja lo de hoy publicado. Para volver a un despliegue anterior, los pasos son estos, en este orden. Sin `retirar-sin-publicar`, lo aplicado sin publicar les llega a los Clientes de una.
  1. `scripts/retirar-sin-publicar.mts`, justo antes de cambiar el despliegue.
  2. Si ese despliegue no conoce Secciones ni Indicadores, `scripts/quitar-panel.mts`: con una sola fila viva de esas, su lector lanza y el Negocio queda sin atender.
  3. Cambiar el despliegue.
  4. `scripts/retirar-sin-publicar.mts` otra vez, justo después: en medio, el código nuevo puede dejar filas sin publicar.
  5. `scripts/quitar-panel.mts` otra vez, si corrió en el paso 2, por lo mismo.

**Qué no hace el núcleo, ni con un Cambio:**
- mandar desde un número que no sea el de Amanece;
- escribirle a un Cliente fuera de la ventana de 24 horas;
- mandar mensajes publicitarios fuera del horario de la Ley 2300.

Lo que el núcleo no sabe hacer queda registrado como Capacidad faltante.

## Medición, que vuelve al mapa

Cada Cambio guarda tokens de entrada y salida, costo estimado y latencia, desde el pedido hasta que queda aplicado. Lo mismo cada turno de los agentes. La página `/medicion` lo muestra.

## Piezas

- **Next.js** (App Router) en Vercel, TypeScript, pnpm.
- **Postgres en Neon con Drizzle**, creado desde Vercel. Desarrollo y producción usan la misma base por ahora.
- **Clerk** para el alta y el inicio de sesión. Cada Dueño queda ligado a su Negocio.
- **Modelos de Meta** por `api.meta.ai/v1` con el SDK de Vercel AI (`@ai-sdk/openai-compatible`). El modelo se elige con `MODEL_ID`: `muse-spark-1.3-contributor` para probar, `muse-spark-1.3` cuando lo prueben personas.
- **Kapso.** Por el webhook `whatsapp.message.received`, firmado, entran los mensajes del número de Amanece; por la API de Kapso salen las respuestas. Un solo número para todos los Negocios: el código del link `wa.me` dice a qué Negocio habla cada Cliente.

## Qué es nuevo

Todo el código de este repo se escribió durante la hackatón, después del kickoff del 26 de octubre de 2026. Waichat, Aura y Eurocolombia, los productos previos de Daniel, solo se leyeron como referencia; no se copió código de ellos.
