# DESIGN.md

Cómo se ve, se mueve y habla Amanece. Lo cumple toda pantalla nueva y toda pantalla que se toque.

- **Decidido** es lo que Daniel eligió frente a un prototipo el 2 de noviembre de 2026. Cambiarlo es decisión suya.
- **Derivado** es lo que sale de lo decidido, sin ronda propia. Sigue la regla hasta que Daniel la revise.
- **Destino** es lo decidido que todavía no existe en el código.

El vocabulario es el de `docs/diseno.md`. Los ejemplos en vivo están en el prototipo de la rama `prototipo/diseno` de `danielmedinac22/amanece`, que es privado.

## La idea

Amanece se ve como un buen producto de hoy y le habla a quien vende por WhatsApp, no a quien programa. Cuatro reglas ordenan todo:

1. **El agente trae, el Dueño decide.** Lo que espera una decisión llega como tarjeta, con la acción a la vista.
2. **Ver antes de que cuente.** Todo Cambio se muestra con datos del Negocio antes de llegar a un Cliente.
3. **El color significa algo.** La tinta lleva la lectura, y el color queda para el cielo, el botón de enviar y los estados.
4. **Teléfono y PC valen igual.** Cada pantalla se termina en los dos.

## Pila

| Pieza | Qué se usa |
|---|---|
| Componentes | shadcn, estilo `base-nova`, sobre Base UI. Partir de un componente suyo y de shadcn studio antes de escribir uno a mano. |
| Estilos | Tailwind 4, con los tokens de abajo y consultas de contenedor dentro del lienzo |
| Íconos | `@phosphor-icons/react`. Peso `regular`; `fill` para el activo y los estados |
| Movimiento | `motion`, con `MotionConfig reducedMotion="user"` en la raíz |
| Letras | `next/font/google`: Bricolage Grotesque y Hanken Grotesk |

Eurocolombia ya usa `base-nova` sobre NexaCRM de shadcn studio, y sirve de referencia para Tablero, tablas y bandeja. Este repo ya usa esos tokens y esas letras. Para ver una pantalla sin sesión, mira `/vitrina`.

**Vitrina.** `/vitrina` pinta las pantallas con datos inventados, sin sesión ni base de datos, y solo existe en `next dev`: sus páginas son `page.dev.tsx` y un build no las incluye. Para agregar una pantalla, suma una fila a `ESCENAS` en `src/app/vitrina/escenas.tsx` con su `id`, su título y lo que pinta. Con `pnpm dev` corriendo, `pnpm tsx scripts/mirar-vitrina.mts <escena> <salida.png> [ancho] [alto] [--oscuro]` la captura y avisa si se desborda a lo ancho; sus pasos (`--clic`, `--ve`, `--cierto` y los demás, en la cabecera del script) tocan y afirman como lo haría el Dueño. Los datos de prueba van en `src/app/vitrina/datos.ts` y nada fuera de esa carpeta los importa. Una pantalla que se pinte desde datos separa su vista de su lectura, como `src/app/panel/vista.tsx`.

## Tokens

**Decidido.** Mirada Alba. Los valores viven en `src/app/globals.css`, que es la fuente: este documento dice para qué sirve cada uno y no los repite. El modo oscuro sigue la configuración del sistema solo con CSS, por `prefers-color-scheme`, sin clase ni script ni parpadeo. `--alba` y `--sol` son degradados y no se registran como colores de Tailwind: se usan con `var()`.

### Para qué es cada color

| Token | Se usa en |
|---|---|
| `--primary` | El botón principal, el activo y las barras. Un solo botón principal por tarjeta. |
| `--bien` | Lo resuelto o funcionando: `Atendiendo`, `Confirmado`, el check de una constancia |
| `--ojo` | Lo que espera al Dueño o está en vista previa: `Vista previa`, `Con novedad`, el número de Casos |
| `--alba` | Solo el cielo de la entrada y del armado |
| `--sol` | Solo el botón de enviar activo, siempre con ícono en `--sol-foreground`, la tinta `oklch(0.23 0.035 265)`, que no cambia en oscuro |
| `--globo-cliente` | **Derivado.** El globo de lo que escribe el Cliente en una muestra de WhatsApp. El texto va en `--globo-cliente-foreground`. |
| `--velo` | **Derivado.** El velo que oscurece lo de atrás cuando abre un diálogo o un cajón. Es el de `base-nova`. |
| `--destructive` | **Derivado.** Errores y acciones que borran. Valores de `base-nova`: `oklch(0.577 0.245 27.325)` en claro y `oklch(0.704 0.191 22.216)` en oscuro. Su contraste está medido en la tabla de abajo. |

### Contraste

Medido sobre los tokens de `src/app/globals.css`, en claro y oscuro. `scripts/probar-diseno.mts` lo vuelve a medir y falla si un token se aleja de esta tabla:

| Par | Claro | Oscuro |
|---|---|---|
| Texto sobre fondo | 16,5 | 16,5 |
| Texto tenue sobre fondo | 6,1 | 8,3 |
| Texto tenue sobre `--muted` | 5,7 | 7,0 |
| Texto sobre `--primary` | 14,2 | 11,7 |
| `--bien` sobre `--bien-suave` | 4,9 | 7,0 |
| `--ojo` sobre `--ojo-suave` | 4,9 | 6,9 |
| Texto del globo del Cliente sobre `--globo-cliente` | 13,1 | 9,2 |
| `--destructive` sobre el fondo | 4,7 | 6,6 |
| `--destructive` sobre `--card` | 4,8 | 6,1 |
| Tinta sobre `--sol` | de 6,2 a 8,1 | de 6,2 a 8,1 |

- Sobre `--alba` escribe con `--foreground` o `text-foreground/75`. `--muted-foreground` se queda corto en la parte alta del cielo (3,6).
- El blanco sobre `--sol` no llega a 3:1, por eso el ícono va en tinta.
- `--border` es decorativo (1,2). Un campo se distingue también por su marcador, su sombra o su posición.

## Letras

**Decidido**: las familias. **Derivado**: la escala, tomada del prototipo.

| Uso | Letra | Tamaño |
|---|---|---|
| Título de la entrada | Bricolage, 600 | `clamp(34px, 5.6vw, 58px)`, interlínea 1.04 |
| Título del armado | Bricolage, 600 | `clamp(32px, 4.4vw, 50px)` |
| Frase de Inicio | Bricolage, 500 con cifras en 600 | de 20 a 28 px, interlínea 1.28 |
| Cifra de Tablero | Bricolage, 600 | 24 px |
| Título de un paño | Bricolage, 600 | 15 px |
| Mensaje del Hilo | Hanken | 14,5 px, interlínea 1.5 |
| Interfaz | Hanken | 13 a 14 px |
| Apoyo | Hanken | 11 a 12 px, el mínimo |
| Link | Mono del sistema | 12 a 13 px |

Usa `tabular-nums` en cifras dentro de tablas, listas y tarjetas. En una frase corrida, deja los números normales. Balancea los títulos con `text-balance` y los párrafos con `text-pretty`.

## Forma

**Derivado.** Tarjetas y marcos con `--radius`; piezas dentro de una tarjeta con `calc(var(--radius) - 4px)`; chips y el botón de enviar redondos. Relleno de 12 a 16 px en tarjetas, 16 px en teléfono y 24 px en el lienzo de PC. La sombra alzada, `0 1px 2px rgb(0 0 0 / .04), 0 16px 40px -16px rgb(30 30 60 / .18)`, es solo para lo que flota sobre otra cosa: la caja de la entrada, popovers y el chat flotante.

## Movimiento

Cada animación informa algo: de dónde salió una cosa o que una acción funcionó.

| Qué | Duración | Curva |
|---|---|---|
| Entrada de un elemento | 240 ms, sube 6 px | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Paños y desplazamientos | de 160 a 280 ms | `cubic-bezier(0.25, 1, 0.5, 1)` |
| Plegar una tarjeta | 260 ms en altura | la de entrada |
| Cambio de texto en un botón | 140 ms, 3 px | la de entrada |
| Confirmación (check, número nuevo) | 350 ms | resorte, `bounce: 0.35` |
| Cielo al abrir el Negocio | 500 ms, sale hacia arriba | la de entrada |

- Confirma en el lugar donde se tocó: el botón o la tarjeta cambia, sin avisos en una esquina.
- Lo que aparece sale de donde estaba: una Sección nueva entra al sidebar, una tarjeta se pliega en su sitio.
- Anima `transform` y `opacity`. Altura y ancho solo para plegar tarjetas y ocultar el Hilo.
- Respeta `prefers-reduced-motion`: el cambio de estado se queda y el movimiento se va.
- Las acciones del teclado no llevan animación.

## Estructura

### Entrada: Alba

**Decidido.** Como Lovable: cielo completo, `¿Qué hace tu negocio?` al centro y una caja grande que escribe ejemplos sola mientras está vacía y se detiene cuando el Dueño escribe. Debajo sube una hoja con dos pestañas: `Plantillas` y `Lo que puede hacer`.

**Plantillas.** Tres, nombradas por Rubro, con negocios inventados: Venta contra entrega, Envíos y paquetería, y Servicios con agenda. Cada tarjeta dibuja el Panel real a escala, con dos globos del WhatsApp encima, y ofrece `Remixear` y `Ver`. Al remixear, la plantilla entra como chip a la caja y el cursor queda ahí. `Ver` abre lo que ve el Dueño junto a lo que ve el Cliente. En teléfono son un carrusel. **Destino**: hoy el armado no parte de plantillas, así que la tarjeta ofrece solo `Ver` hasta que `Remixear` sea de verdad.

**Lo que puede hacer.** Cada fila es algo que el producto hace hoy. Lo que todavía no existe no se promete aquí.

**Portada.** Alba vive en `/`, con `Entrar` arriba. Nada de esta pantalla llama al servidor, así que un visitante sin cuenta no gasta modelo.

**Lo escrito.** **Derivado.** La caja lo guarda en el navegador por un día, sigue a `/panel` y la puerta de sesión pide la cuenta si hace falta. Después de cualquier entrada, lo guardado llega al agente sin volver a escribirlo.

### Armado

**Decidido.** A la izquierda, la carta del agente: un paso a la vez, con un titular que cambia, la decisión en tarjeta y `Lo que ya sé` marcándose fila por fila. A la derecha, **Tu Panel**, que se va armando con lo que el agente sabe: primero en gris, luego con datos reales, en ceros hasta abrir. En teléfono el Panel queda debajo. Termina en una tarjeta con el link y `Abrir [Negocio]`, que lleva a la operación.

### Operación: tres paños

**Decidido.** En PC, de izquierda a derecha:

1. **Sidebar** abierto, de 216 px, que colapsa a íconos.
2. **Hilo**, de 348 px.
3. **Lienzo**, enmarcado, con el nombre de la Sección, el estado y Publicar.

**Ocultar** pliega el Hilo y deja una caja flotante centrada abajo. Un caret abre la conversación encima del lienzo, y un pin lo fija de nuevo. Si llega una decisión, la conversación se abre sola.

**En teléfono** (menos de 1024 px): el sidebar es un cajón, Publicar va arriba, y `Tu agente` y `Tu negocio` son dos pestañas abajo. Un punto `--ojo` en `Tu agente` avisa que algo espera decisión.

### Sidebar

**Decidido.** Lista simple: Inicio, Casos, Conversaciones, Pedidos, Clientes y Tablero. Debajo, `Tus secciones`, con las propias del Negocio. Un número solo donde algo espera decisión. Arriba, el Negocio; abajo, los Créditos de la Prueba gratis y el Dueño.

### Inicio: Hoy

**Decidido.** Una frase con las cifras en negrita, `Necesita tu ojo` con cada cosa y su acción, y `Lo último`. Lo resuelto sale de la lista enseguida. Recién abierto el Negocio, muestra `Todavía no te ha escrito nadie.` con el link para copiar.

La frase se arma por Rubro con datos del Negocio: una tienda habla de ventas y una agenda de citas. Cada cifra sale de un dato real, nunca del modelo.

**Derivado.** Las definiciones viven en `src/nucleo/hoy.ts` y las palabras en `hoy-palabras.ts`:

- **Esta semana** va desde el lunes en la zona del Negocio. `la anterior` es la semana pasada hasta este mismo momento, y solo se compara con al menos 3 pedidos en ese tramo.
- **Lo vendido** usa `CUENTA_COMO_VENTA`, la misma definición de las Secciones y los Indicadores.
- **Una conversación de hoy** es un Cliente que escribió hoy. **Resuelta sin ti** es una donde el último mensaje es del agente y salió, y ese Cliente no tiene un Caso abierto ni un Caso abierto o resuelto hoy.
- **El Rubro** es texto libre: lo que suena a agenda habla de quién escribió, porque nada guarda una cita todavía, y todo lo demás habla de ventas.

### Tablero

**Decidido.** Sección aparte. Cuatro tarjetas de Indicadores, gráfica, reparto y tabla reciente, en la forma de Eurocolombia.

### Pedidos: Lista

**Decidido.** Agrupados por lo que falta hacer, con este orden: Con novedad, Por confirmar, Confirmado, Enviado y Entregado. Encabezados pegajosos con su cuenta. Filas densas, sin gráficas. En teléfono se esconden número, ciudad y tiempo.

**Derivado.** Conversaciones y Clientes siguen esta densidad. Conversaciones es lista y detalle en dos columnas, y en teléfono una pantalla a la vez. Las tablas esconden columnas según el ancho, de modo que el nombre y el estado quepan sin desplazar.

**Derivado.** Las definiciones viven en `src/nucleo/listas.ts` y las palabras en `listas-palabras.ts`:

- **Cancelado** va al final, plegado y con el tono de Entregado.
- **Una línea de items** escribe la cantidad solo si pasa de 1 y separa los productos con `+`, porque un nombre puede llevar coma: `2 tueste medio, grano 500 g + Molino manual`.
- **El límite** son 50 filas por grupo y 100 Clientes, los más recientes. La cuenta siempre es la de verdad, y una línea dice cuántas ves.
- **En Conversaciones**, la lista son los Clientes que tienen mensajes, los 100 más recientes. El detalle trae los últimos 200 y abre en lo último. El pie dice quién atiende: hoy siempre `Tu agente está atendiendo`, porque el Agente de clientes no se calla con un Caso abierto, y un enlace si hay un Caso sin resolver.
- **En Casos**, `Espera tu decisión` lleva la misma tarjeta del Hilo, leída con `estadosDeTarjetas`. Un Caso solo se cierra enviando: descartar o que venza lo deja esperando, con su constancia y qué sigue. En `Resueltos`, una respuesta aprobada que no salió lo dice.
- **En Clientes**, `Pedidos` y `Total` usan `CUENTA_COMO_VENTA`. `Ciudad` es la del último pedido que dijo una, y `Último` lo más reciente entre escribir y pedir. Un Cliente sin nombre sale con su teléfono.

## Hilo: Nota

**Decidido.** El agente escribe sin globo, en `--texto-hilo`. El Dueño, en un globo `--secondary` a la derecha. El trabajo del agente es un **rastro**: una línea tenue con un check, o tres puntos mientras trabaja. Encima del redactor van hasta dos sugerencias como chips.

### Tarjeta de decisión

**Decidido.** Queda en medio de la conversación, y hay tarjeta siempre. El botón depende de quién lo nota:

| Caso | La tarjeta muestra | Acciones | Al resolver |
|---|---|---|---|
| Caso | Lo que escribió el Cliente, la respuesta en `--muted` y la regla que aplica | `Enviar`, `Descartar` | `Enviada a [Cliente]`, `Descartada` |
| Indicador o Sección | El resultado con datos reales, ya en la vista previa | `Deshacer` | `Deshecha`, `Publicada` |
| Regla o conocimiento | La regla y una conversación de prueba | `Aplicar`, `Descartar` | `Aplicada`, `Publicada`, `Descartada` |
| Lo leído de una página | Lo encontrado | `Están bien y no falta ninguno`, `Corregir` | `Confirmada` |

Estructura: etiqueta arriba, en texto chico; cuerpo; acciones abajo con una línea que dice a quién le llega.

**Constancia.** Al resolver, el cuerpo se pliega y quedan dos líneas: de qué se trataba y qué pasó, con un caret para volver a verlo. Desenlaces que ya existen en el código: `Aplicada por [Dueño]`, `y revertida después` y `Venció sin aplicarse. Pídela de nuevo si todavía la quieres.`

**Derivado: varias decisiones a la vez.** Cada tarjeta se queda en su lugar de la conversación y lleva su `1 de 3`. Arriba del Hilo queda una línea con la más urgente, que lleva a ella: primero lo que un Cliente está esperando y después lo que vence antes.

**Hoy el código** aplica un Indicador o una Sección sin tarjeta, y una regla aplicada queda funcionando de una vez. La tarjeta y la vista previa de esta tabla llegan con el ticket de Publicar.

### Redactor

**Decidido.** Caja con adjuntar, texto y enviar. El botón de enviar es redondo y se enciende con `--sol` cuando hay texto. **Destino**: adjuntar, porque el Hilo todavía no recibe archivos.

## Publicar

**Destino**, se construye en [Publicar](https://github.com/danielmedinac22/amanece/issues/34). Lo aplicado queda en vista previa hasta que el Dueño lo manda a su link.

| Estado | Botón | Lienzo |
|---|---|---|
| Nada pendiente | `Publicado`, con punto `--bien`, contorno | `Atendiendo` |
| Con cambios | `Publicar` con su número, principal | `Vista previa`; el bloque nuevo con borde punteado `--ojo` |
| Mientras corre | `Publicando` con indicador | `Vista previa` |

Al abrirlo muestra los links con copiar y abrir, lo que falta por publicar y, por cada cosa, si la notan los Clientes o solo la ve el equipo. Después, el agente lo confirma en el Hilo.

## Palabras

- Escribe de tú, en español de Colombia, con frases cortas y como le hablarías a quien atiende su negocio.
- Usa los nombres de `docs/diseno.md` y los sinónimos evitados se quedan fuera, también los técnicos: Panel, nunca dashboard ni CRM; Publicar, nunca deploy.
- Cada acción conserva su nombre de principio a fin: `Aplicar` termina en `Aplicada`, `Enviar` en `Enviada`, `Publicar` en `Publicado`.
- **Derivado.** Un error dice qué pasó y qué hacer, sin disculpas. Un estado vacío dice qué sigue.
- Las cifras son datos del Negocio. Las promesas de precio y tiempo salen de lo que el Dueño confirmó.
- Plata con punto de mil, sin decimales: `$1.284.000`.

## Lo que falta decidir

- **Demo en vivo.** Si la portada lleva la demo en vivo de la ronda 3 sigue abierto. Para la pieza de demo, usa el skill `stageshow`.
- **Clientes, formularios, ajustes y errores** no tuvieron ronda. Son **Derivado**.
- **Lo que ve el equipo** cuando exista un rol distinto del Dueño.
