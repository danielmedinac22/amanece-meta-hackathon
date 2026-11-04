import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import type { CSSProperties } from 'react'
import { TEXTOS, type Idioma, type MensajeDeMuestra } from './textos'

export const TAMANO_DE_IMAGEN = { width: 1200, height: 630 }

// next/og no lee los tokens de globals.css ni entiende oklch: son sus valores en hexadecimal.
const COLOR = {
  tinta: '#151d2d',
  tintaSuave: '#4f586c',
  primario: '#1d2842',
  fondoDelChat: '#eef1f6',
  globoCliente: '#d1f2d7',
  globoAgente: '#ffffff',
  ojo: '#a94700',
  ojoSuave: '#ffe8cc',
}

const CIELO = 'linear-gradient(180deg, #0a0f2a 0%, #12173a 46%, #2a2a5c 72%, #6b4468 90%, #b5665a 100%)'
const ESTRELLAS = [[352, 38], [536, 96], [604, 300], [24, 300], [596, 470], [1150, 34], [640, 40], [920, 62], [1172, 440]] as const

const letra = (archivo: string) => readFile(join(process.cwd(), 'src/app/portada/letras', archivo))

function Globo({ mensaje }: { mensaje: MensajeDeMuestra }) {
  const delCliente = mensaje.de === 'cliente'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignSelf: delCliente ? 'flex-end' : 'flex-start', maxWidth: 468, padding: '11px 16px 9px', borderRadius: 16, fontSize: 24, lineHeight: 1.3, color: COLOR.tinta, backgroundColor: delCliente ? COLOR.globoCliente : COLOR.globoAgente }}>
      <span>{mensaje.texto}</span>
      <span style={{ alignSelf: 'flex-end', marginTop: 2, fontSize: 17, color: COLOR.tintaSuave }}>{mensaje.hora}</span>
    </div>
  )
}

export async function imagenParaCompartir(idioma: Idioma) {
  const t = TEXTOS[idioma]
  const piezas = t.dia.momentos.map((m) => m.pieza)
  const conversacion = piezas.find((p) => p.tipo === 'conversacion')
  const caso = piezas.find((p) => p.tipo === 'caso')
  if (!conversacion || !caso) throw new Error('El día de la portada ya no trae una conversación y un Caso para la imagen.')

  const tarjeta: CSSProperties = { display: 'flex', flexDirection: 'column', width: 500, overflow: 'hidden', borderRadius: 26, boxShadow: '0 18px 50px rgba(5, 8, 30, 0.45)' }

  return new ImageResponse(
    <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', padding: '48px 56px', gap: 48, backgroundImage: CIELO, color: '#ffffff', fontFamily: 'Hanken' }}>
      {ESTRELLAS.map(([x, y]) => (
        <div key={`${x}-${y}`} style={{ position: 'absolute', left: x, top: y, width: 3, height: 3, borderRadius: 3, backgroundColor: 'rgba(255, 255, 255, 0.7)' }} />
      ))}

      <div style={{ display: 'flex', flex: 1, flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: 'Bricolage', fontSize: 36 }}>
          <svg width="48" height="48" viewBox="0 0 64 64">
            <defs>
              <linearGradient id="a" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#a9c7f2" />
                <stop offset=".38" stopColor="#d5d3ee" />
                <stop offset=".72" stopColor="#fbd6c6" />
                <stop offset="1" stopColor="#ffe9c9" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="15" fill="url(#a)" />
            <circle cx="32" cy="32" r="15" fill={COLOR.tinta} />
          </svg>
          Amanece
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'Bricolage', fontSize: 58, lineHeight: 1.07, letterSpacing: '-0.015em' }}>
          {t.cierre.titulo.split(/(?<=\.) /).map((frase, i) => (
            <span key={frase} style={{ textWrap: 'balance', color: i === 0 ? '#ffffff' : '#ffd2b4' }}>
              {frase}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignSelf: 'flex-start', padding: '15px 28px', borderRadius: 999, fontSize: 27, fontWeight: 600, color: COLOR.tinta, backgroundColor: '#ffffff' }}>{t.cta}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16 }}>
        <div style={{ ...tarjeta, backgroundColor: COLOR.fondoDelChat }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', backgroundColor: COLOR.primario }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 44, fontFamily: 'Bricolage', fontSize: 21, backgroundColor: 'rgba(255, 255, 255, 0.16)' }}>{conversacion.negocio[0]}</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ fontSize: 23, fontWeight: 600 }}>{conversacion.negocio}</span>
              <span style={{ fontSize: 17, opacity: 0.8 }}>{t.enLinea}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
            {conversacion.mensajes.map((m) => (
              <Globo key={m.texto} mensaje={m} />
            ))}
          </div>
        </div>

        <div style={{ ...tarjeta, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '16px 18px 16px 22px', color: COLOR.tinta, backgroundColor: '#ffffff' }}>
          <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ padding: '2px 11px', borderRadius: 999, fontSize: 17, fontWeight: 600, color: COLOR.ojo, backgroundColor: COLOR.ojoSuave }}>{caso.etiqueta}</span>
            <span style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.2 }}>{caso.titulo}</span>
          </div>
          <span style={{ padding: '10px 22px', borderRadius: 13, fontSize: 21, fontWeight: 600, color: '#ffffff', backgroundColor: COLOR.primario }}>{caso.principal.texto}</span>
        </div>

        <span style={{ alignSelf: 'flex-end', fontSize: 16, color: 'rgba(255, 255, 255, 0.92)' }}>{t.dia.nota}</span>
      </div>
    </div>,
    {
      ...TAMANO_DE_IMAGEN,
      fonts: [
        { name: 'Bricolage', data: await letra('BricolageGrotesque-SemiBold.ttf'), weight: 600, style: 'normal' },
        { name: 'Hanken', data: await letra('HankenGrotesk-Regular.ttf'), weight: 400, style: 'normal' },
        { name: 'Hanken', data: await letra('HankenGrotesk-SemiBold.ttf'), weight: 600, style: 'normal' },
      ],
    },
  )
}
