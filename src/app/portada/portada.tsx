import type { Metadata } from 'next'
import { Alba } from '../alba'
import { Dia } from './dia'
import { PiezaDelDia } from './piezas'
import { PreguntaDificil } from './pregunta-dificil'
import { APOYO, BLOQUE, CafeLadera, Cierre, NOTA, Pie, Preguntas, Rubros, TITULO } from './secciones'
import { RUTA_DE_IDIOMA, TEXTOS, type Idioma } from './textos'

export function metadatosDePortada(idioma: Idioma): Metadata {
  const { titulo, descripcion } = TEXTOS[idioma].meta
  return {
    metadataBase: new URL('https://app.amanece.co'),
    title: titulo,
    description: descripcion,
    alternates: { canonical: RUTA_DE_IDIOMA[idioma], languages: RUTA_DE_IDIOMA },
  }
}

export function Portada({ idioma }: { idioma: Idioma }) {
  const t = TEXTOS[idioma]
  const [primera] = t.dia.momentos
  return (
    <div lang={idioma} className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col">
        <Alba idioma={idioma} />
        <Dia titulo={t.dia.titulo} nota={t.dia.nota} primera={{ hora: primera.hora, meridiano: primera.meridiano }}>
          {t.dia.momentos.map((m) => (
            <article key={m.hora} data-hora={m.hora} data-meridiano={m.meridiano} className="flex flex-col gap-[13px]">
              <h3 className="font-heading text-[clamp(24px,3.6vw,36px)] leading-[1.1] font-semibold tracking-tight text-balance">
                <span className="sr-only">
                  {m.hora} {m.meridiano}.{' '}
                </span>
                {m.titulo}
              </h3>
              <PiezaDelDia pieza={m.pieza} enLinea={t.enLinea} />
            </article>
          ))}
        </Dia>
        <Rubros t={t.rubros} enLinea={t.enLinea} />
        <section className={BLOQUE}>
          <h2 className={`${TITULO} max-w-[21ch]`}>{t.dificil.titulo}</h2>
          <p className={APOYO}>{t.dificil.subtitulo}</p>
          <PreguntaDificil t={t.dificil} enLinea={t.enLinea} />
          <p className={`${NOTA} mt-3.5`}>{t.dificil.nota}</p>
        </section>
        <CafeLadera t={t.qr} />
        <Preguntas t={t.preguntas} />
        <Cierre t={t.cierre} cta={t.cta} />
      </main>
      <Pie t={t.pie} idioma={idioma} />
    </div>
  )
}
