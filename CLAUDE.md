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

- La compuerta de envío: `enviarAlCliente` en `src/negocio/whatsapp.ts` y el webhook de `src/app/api/kapso/webhook/route.ts`.
- La puerta del Negocio: `src/negocio/sesion.ts`. El Negocio sale de la sesión y nunca entra como parámetro.
- Los permisos del Agente del dueño: las herramientas de `src/agentes/dueno.ts`, qué existe y qué pide aprobación.
- El generador de Cambios y su aplicación: `src/agentes/generador.ts` y `src/negocio/cambios.ts`.
- El intérprete aislado: `src/lib/aislado.ts`.
- El esquema: `src/db/esquema.ts` y `drizzle/`.

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
