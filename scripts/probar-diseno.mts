/**
 * Los tokens de `src/app/globals.css` contra la tabla de contraste de DESIGN.md, y que no quede nada de la
 * mirada anterior ni de lucide. Estática: no necesita base de datos ni modelo.
 *
 *   pnpm tsx scripts/probar-diseno.mts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afirmar, terminar } from './afirmar.mjs'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(RAIZ, 'src/app/globals.css'), 'utf8')

type Variables = Record<string, string>

function variablesDe(bloque: string): Variables {
  return Object.fromEntries([...bloque.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const claro = variablesDe(/^:root \{([\s\S]*?)^\}/m.exec(css)?.[1] ?? '')
const sobreescritas = variablesDe(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? '')
const oscuro = { ...claro, ...sobreescritas }

type Rgb = [number, number, number]

function oklchARgbLineal(valor: string): Rgb {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(valor)
  if (!m) throw new Error(`No es un oklch simple: ${valor}`)
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180]
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, c))) as Rgb
}

function hexARgbLineal(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as Rgb
}

const aRgbLineal = (valor: string) => (valor.startsWith('#') ? hexARgbLineal(valor) : oklchARgbLineal(valor))

/** Luminancia relativa de WCAG: el color ya está en sRGB lineal y dentro de la gama. */
const luminancia = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(aRgbLineal(a)), luminancia(aRgbLineal(b))]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const TOLERANCIA = 0.1

/** [par, token del texto, token del fondo, mínimo claro, mínimo oscuro]: los de la tabla "Contraste" de DESIGN.md. */
const PARES: readonly [string, string, string, number, number][] = [
  ['Texto sobre fondo', '--foreground', '--background', 16.5, 16.5],
  ['Texto tenue sobre fondo', '--muted-foreground', '--background', 6.1, 8.3],
  ['Texto tenue sobre muted', '--muted-foreground', '--muted', 5.7, 7.0],
  ['Texto sobre primary', '--primary-foreground', '--primary', 14.2, 11.7],
  ['bien sobre bien-suave', '--bien', '--bien-suave', 4.9, 7.0],
  ['ojo sobre ojo-suave', '--ojo', '--ojo-suave', 4.9, 6.9],
  ['Texto del globo del Cliente', '--globo-cliente-foreground', '--globo-cliente', 13.1, 9.2],
  ['destructive sobre background', '--destructive', '--background', 4.7, 6.6],
  ['destructive sobre card', '--destructive', '--card', 4.8, 6.1],
]

for (const [par, texto, fondo, minClaro, minOscuro] of PARES) {
  for (const [modo, variables, minimo] of [['claro', claro, minClaro], ['oscuro', oscuro, minOscuro]] as const) {
    const ratio = contraste(variables[texto], variables[fondo])
    afirmar(`${par}, ${modo}: ${ratio.toFixed(2)} (documentado ${minimo})`, ratio >= minimo - TOLERANCIA, { texto: variables[texto], fondo: variables[fondo], ratio })
  }
}

const TINTA = claro['--sol-foreground']
afirmar('La tinta de --sol es la de DESIGN.md y no cambia en oscuro', TINTA === 'oklch(0.23 0.035 265)' && oscuro['--sol-foreground'] === TINTA, { claro: TINTA, oscuro: oscuro['--sol-foreground'] })
for (const extremo of ['#ff9a5c', '#ff6b8b']) {
  const ratio = contraste(TINTA, extremo)
  afirmar(`Tinta sobre el extremo ${extremo} de --sol: ${ratio.toFixed(2)} (documentado 6.2)`, ratio >= 6.2 - TOLERANCIA)
}
afirmar('--sol sigue siendo el degradado documentado', claro['--sol'] === 'linear-gradient(120deg, #ff9a5c, #ff6b8b)', claro['--sol'])

afirmar('El modo oscuro cambia el fondo', oscuro['--background'] !== claro['--background'])
afirmar('El modo oscuro sigue al sistema, sin clase ni variante propia', !/\.dark\b|@custom-variant\s+dark\b/.test(css))
afirmar('color-scheme declara claro y oscuro', /color-scheme:\s*light dark/.test(css))
afirmar('--fuente y --fuente-titulo las pone next/font, no :root', !/^\s*--fuente(-titulo)?:/m.test(css))
afirmar('--sol y --alba no son colores de Tailwind', !/--color-(sol|alba)\b/.test(css))

const VIEJOS = /--fondo\b|--tinta\b|--suave\b|--borde\b|--tarjeta\b|--verde\b|sol-claro|bg-sol\b|text-sol\b|bg-verde\b|bg-fondo\b|text-tinta\b|text-suave\b|border-borde\b|bg-tarjeta\b|Geist/

function archivos(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((n) => {
    const ruta = join(carpeta, n)
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta]
  })
}

const fuentes = archivos(join(RAIZ, 'src')).filter((r) => /\.(tsx?|css)$/.test(r))
const conViejos = fuentes.filter((r) => VIEJOS.test(readFileSync(r, 'utf8'))).map((r) => r.slice(RAIZ.length))
afirmar('Ningún token ni clase de la mirada anterior queda en src', conViejos.length === 0, conViejos)

const conLucide = fuentes.filter((r) => /lucide/i.test(readFileSync(r, 'utf8'))).map((r) => r.slice(RAIZ.length))
afirmar('Ningún archivo de src usa lucide', conLucide.length === 0, conLucide)
afirmar('package.json no depende de lucide', !/lucide/i.test(readFileSync(join(RAIZ, 'package.json'), 'utf8')))

const COLOR_A_MANO = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow)-(?:red|amber|green|blue|yellow|orange|gray|slate|zinc|neutral|stone|emerald|rose|pink|purple|indigo|sky|teal|lime|cyan|violet|fuchsia|white|black)\b|\[(?:color:)?(?:oklch|rgba?|hsla?)\(|["'`\s\[:]#[0-9a-fA-F]{3,8}\b/
const pantallas = [...archivos(join(RAIZ, 'src/app')), ...archivos(join(RAIZ, 'src/components'))].filter((r) => r.endsWith('.tsx'))
const conColorAMano = pantallas.filter((r) => COLOR_A_MANO.test(readFileSync(r, 'utf8'))).map((r) => r.slice(RAIZ.length))
afirmar('Ninguna pantalla ni componente escribe un color a mano: todo color sale de un token', conColorAMano.length === 0, conColorAMano)

const conOtraLetra = fuentes.filter((r) => /next\/font\//.test(readFileSync(r, 'utf8'))).map((r) => r.slice(RAIZ.length))
afirmar('Las letras se cargan en un solo lugar, el layout raíz', conOtraLetra.length === 1 && conOtraLetra[0].endsWith('src/app/layout.tsx'), conOtraLetra)

terminar()
