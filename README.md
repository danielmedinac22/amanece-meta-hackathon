# Amanece

**IA para todas las empresas de Latinoamérica.** Un Dueño arma, conversando, el agente que atiende a sus Clientes por WhatsApp. Su propio agente, el Agente del dueño, trabaja para él 24/7: le trae cada Caso resuelto y deja funcionando en su Negocio cada cosa que le pide, sea una regla, una Sección o un Indicador.

Construido para el [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details) (track Startups), con **Muse Spark** por la API de modelos de Meta.

## Qué es nuevo

Todo el código de este repo se escribió durante la hackatón, después del kickoff del 26 de octubre de 2026. Waichat, Aura y Eurocolombia, los productos anteriores del fundador, solo se leyeron como referencia; no se copió código de ellos.

## Cómo funciona

Ver [`docs/diseno.md`](docs/diseno.md).

## Correr en local

```bash
pnpm install
vercel env pull .env.local   # llaves de Meta, Kapso y Neon
pnpm drizzle-kit migrate
pnpm dev
```
