@AGENTS.md

# Cómo se construye Amanece

Toda sesión que escribe código en este repo corre `/pstack:poteto-mode`. El vocabulario (Negocio, Dueño, Cliente, Cambio, Caso, Sección, Indicador) es el de `docs/diseno.md` y se usa tal cual.

## Qué se decide aquí y qué no

Este repo decide **cómo** se construye. El **qué** y el **porqué** se deciden en el mapa privado de Amanece (`danielmedinac22/amanece`, issue "Mapa de Amanece"). Cuando una pregunta es de producto o de arquitectura, abre un ticket en el mapa y sigue con lo demás. El trabajo llega como issues de `danielmedinac22/amanece` con la etiqueta `ready-for-agent`. El PR enlaza su issue. Si al construir ves que una decisión del mapa no se sostiene, abre un ticket `wayfinder:grilling` en el mapa con lo que encontraste y construye según la decisión vigente hasta que cierre.

## El tamaño decide el recorrido

Se aplica lo de la fila que corresponde y, además, lo de **Siempre**.

| Tamaño | Recorrido |
| --- | --- |
| **Siempre** | Nombra la forma de los datos antes del código. Cumple **Hecho** antes de decir que algo está hecho. `pstack:unslop` en todo lo que lee Daniel. `pstack:no-comments` antes del commit. `pstack:show-me-your-work` en corridas largas o autónomas. |
| **Pieza compartida** | `how`, `architect` (arena con al menos dos diseños de forma distinta), `interrogate` y `blast-radius`. La escribe el modelo de `hardest tasks`. |
| **Cruza módulos** sin tocar una pieza compartida | `how` y un boceto de tipos y firmas, de una sola mano, antes de llenarlo. |
| **Local** (un archivo, un bug que se reproduce) | El playbook Bug fix o Feature tal cual. |

Las **piezas compartidas** son lo que tocan todos los Negocios a la vez:

- La salida: `src/nucleo/salida/`. `despachar` es la única salida, `decidir` la compuerta y `kapso.ts` el único `fetch` a Kapso, con `ENVIO_SIMULADO`.
- La entrada: `src/nucleo/entrada.ts` (el webhook, la ficha `(CODIGO)` y quién es cada teléfono) y `src/app/api/kapso/webhook/route.ts`.
- El estado de un Negocio: `src/nucleo/estado/`. `elementos.ts` es la frontera (qué puede dejar un Cambio y qué se cumple hoy), `leerEstado` en `index.ts` el único lector, `validarEscritura` en `index.ts` la única validación de una escritura y `escribir.ts` el único escritor, que valida dentro de la transacción y solo importan `src/nucleo/cambios/` y `scripts/`. `otrosNegocios` en `index.ts` es la única consulta de los nombres de los otros Negocios.
- La puerta del Negocio: `src/negocio/sesion.ts`. El Negocio sale de la sesión y nunca entra como parámetro.
- Las propuestas: `src/nucleo/cambios/` (`proponer`, `aprobar`, `descartar`, `historial`; `traducir.ts`, el único que ramifica por `Quiere`; `alta.ts`, la entrevista) y `src/db/pool.ts`, la única transacción interactiva. `puente.ts` es lo único que llama al `aplicarCambio` viejo, solo para Sección e Indicador, y se borra el 2-nov.
- El Agente de clientes: `src/nucleo/clientes/` (`turno.ts` compone, `reglas.ts` hace cumplir las reglas del Dueño, `acciones.ts` es el puerto). `atender.ts` es lo único que junta `turno` y `despachar`.
- Los permisos del Agente del dueño: las herramientas de `src/agentes/dueno.ts`, qué existe. El modelo propone; aplicar, revertir y responder un Caso son el botón del Dueño. `src/lib/leer-enlace.ts` es lo único que pide una URL que escribe el Dueño: revisa la IP resuelta en el `lookup`, cada salto, el tiempo y los bytes.
- El generador de piezas y su aplicación, hasta el 2-nov: `src/agentes/generador.ts` y `src/negocio/cambios.ts`. Y lo que arma y ensaya una propuesta: `src/nucleo/cambios/lectura.ts` (lo leído de un enlace espera el botón; `origenDelPrecio` decide quién escribió un precio) y `src/nucleo/cambios/ensayar.ts` (la vista previa por tipo; lo que guarda no lleva texto de Clientes).
- El intérprete aislado: `src/lib/aislado.ts`.
- El esquema: `src/db/esquema.ts`, `src/db/viejo.ts` (las tablas de antes, sin lector hasta el 4-nov; eslint las prohíbe en `src/`) y `drizzle/`.

## Hecho

Algo está hecho cuando se cumplen las cuatro:

1. `tsc --noEmit`, `pnpm lint` y `pnpm build` pasan.
2. `pnpm probar` corre los `scripts/probar-*.mts` contra Neon y Muse Spark reales, con `ENVIO_SIMULADO=1`, y sale con 0. Cada cambio agrega su caso al `probar` de su área con `afirmar` de `scripts/afirmar.mts`. Ese caso afirma lo que queda en la base o lo que se habría enviado, nunca el texto exacto del modelo.
3. Si tocaste el Panel, ábrelo en Chrome, recorre lo que cambió y míralo.
4. Lo revisó otro modelo: `interrogate` si es pieza compartida, `/code-review` en lo demás.

## Lo que sale hacia afuera

Avanza sin preguntar en todo lo reversible: código, ramas, commits y push a tu rama, PRs en borrador, previews de Vercel, migraciones en una rama de Neon, issues y comentarios en `danielmedinac22/amanece`, correr los `probar` con `ENVIO_SIMULADO=1` y borrar lo que la propia prueba creó.

Esto espera el OK de Daniel en la sesión, aunque poteto-mode diga otra cosa:

- Merge o push a `main`, y cualquier deploy a producción.
- Apagar `ENVIO_SIMULADO`, o cualquier mensaje a una persona real por WhatsApp, Slack o correo.
- Cambios en Kapso o en Meta.
- Variables de entorno de producción y migraciones contra la rama principal de Neon.
- Borrar datos que tu sesión no creó.

Cada unidad de trabajo va en su propia rama con su PR.
