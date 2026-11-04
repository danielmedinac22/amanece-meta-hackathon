'use client'

import { CircleNotch, FilePdf, Image as Imagen, Plus, Warning, X } from '@phosphor-icons/react'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { adjuntoEnPalabras, LADO_MAXIMO_DE_LA_FOTO, RECHAZO_EN_PALABRAS, TOPES_DE_ARCHIVO, type Adjunto, type ClaseDeArchivo } from '@/nucleo/archivos'
import type { SubirArchivo } from './subir-archivo'

/** Un archivo en el redactor, antes de enviarlo. */
export type EnElRedactor = { readonly local: string; readonly nombre: string; readonly clase: ClaseDeArchivo } & ({ readonly estado: 'subiendo' } | { readonly estado: 'listo'; readonly adjunto: Adjunto } | { readonly estado: 'fallo'; readonly error: string })

/** El navegador muestra lo que puede subir. Una foto en otro formato, como WebP, sale de `prepararFoto` en JPEG. */
const LO_QUE_ACEPTA = 'image/jpeg,image/png,image/webp,application/pdf'

const CALIDAD_DE_LA_FOTO = 0.85
const esPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

/**
 * Una foto de teléfono suele pasar de 4 MB, y arriba de 2400 px el modelo cobra lo mismo. Al pasar por el lienzo también se le va
 * la ubicación que guarda la cámara. Una imagen que el navegador no sabe abrir sube tal cual, y el servidor decide.
 */
async function prepararFoto(f: File): Promise<Blob> {
  if (f.type === 'image/png' && f.size <= 1_000_000) return f
  try {
    const imagen = await createImageBitmap(f)
    const escala = Math.min(1, LADO_MAXIMO_DE_LA_FOTO / Math.max(imagen.width, imagen.height))
    const lienzo = document.createElement('canvas')
    lienzo.width = Math.round(imagen.width * escala)
    lienzo.height = Math.round(imagen.height * escala)
    const pincel = lienzo.getContext('2d')
    if (pincel) {
      // JPEG no tiene transparencia: sin fondo, lo transparente de un PNG saldría negro.
      pincel.fillStyle = 'white'
      pincel.fillRect(0, 0, lienzo.width, lienzo.height)
      pincel.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
    }
    imagen.close()
    const reducida = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, 'image/jpeg', CALIDAD_DE_LA_FOTO))
    return reducida ?? f
  } catch {
    return f
  }
}

/** Lo que falla al escoger no llega a subir: el Dueño lo ve en el mismo lugar que un error del servidor. */
export function useAdjuntos(alSubir: SubirArchivo, iniciales: readonly EnElRedactor[] = []) {
  const [lista, setLista] = useState(iniciales)
  const secuencia = useRef(0)

  const poner = useCallback((local: string, cambio: Partial<EnElRedactor> & Pick<EnElRedactor, 'estado'>) => setLista((l) => l.map((x) => (x.local === local ? ({ ...x, ...cambio } as EnElRedactor) : x))), [])

  const subir = useCallback(
    async (local: string, f: File, clase: ClaseDeArchivo) => {
      const blob = clase === 'foto' ? await prepararFoto(f) : f
      if (blob.size > TOPES_DE_ARCHIVO.bytes) return poner(local, { estado: 'fallo', error: RECHAZO_EN_PALABRAS.muy_grande })
      const r = await alSubir(blob, f.name)
      poner(local, 'adjunto' in r ? { estado: 'listo', adjunto: r.adjunto } : { estado: 'fallo', error: r.error })
    },
    [alSubir, poner],
  )

  const agregar = (archivos: readonly File[]) => {
    let cuantos = lista.filter((x) => x.estado !== 'fallo').length
    const nuevos = archivos.map((f): EnElRedactor => {
      const local = `local-${++secuencia.current}`
      const clase: ClaseDeArchivo = esPdf(f) ? 'pdf' : 'foto'
      if (cuantos >= TOPES_DE_ARCHIVO.porMensaje) return { local, nombre: f.name, clase, estado: 'fallo', error: RECHAZO_EN_PALABRAS.muchos }
      cuantos++
      void subir(local, f, clase)
      return { local, nombre: f.name, clase, estado: 'subiendo' }
    })
    setLista((l) => [...l, ...nuevos])
  }

  const quitar = (local: string) => setLista((l) => l.filter((x) => x.local !== local))
  const vaciar = () => setLista([])

  return { lista, listos: lista.flatMap((x) => (x.estado === 'listo' ? [x.adjunto] : [])), subiendo: lista.some((x) => x.estado === 'subiendo'), agregar, quitar, vaciar }
}

const Icono = ({ clase, className }: { clase: ClaseDeArchivo; className: string }) => (clase === 'pdf' ? <FilePdf className={className} /> : <Imagen className={className} />)

/** El botón de adjuntar con su selector. `onChange` limpia el valor para poder escoger otra vez el mismo archivo después de un error. */
export function BotonAdjuntar({ alEscoger }: { alEscoger: (archivos: readonly File[]) => void }) {
  const selector = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button type="button" variant="ghost" size="icon" aria-label="Adjuntar" title="Adjunta una foto o un PDF" onClick={() => selector.current?.click()} className="size-9 shrink-0 flotante:hidden">
        <Plus className="size-4" />
      </Button>
      <input
        ref={selector}
        type="file"
        multiple
        hidden
        accept={LO_QUE_ACEPTA}
        data-adjuntar
        onChange={(e) => {
          alEscoger([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </>
  )
}

/** Lo que va a salir con el mensaje: subiendo, listo o con su error. */
export function TiraDeAdjuntos({ lista, alQuitar }: { lista: readonly EnElRedactor[]; alQuitar: (local: string) => void }) {
  if (!lista.length) return null
  return (
    <ul className="flex w-full basis-full flex-col gap-1.5" aria-label="Archivos para enviar" aria-live="polite">
      {lista.map((x) => (
        <li key={x.local} className="flex min-h-9 items-center gap-2 rounded-[calc(var(--radius)-4px)] bg-muted py-1 pr-1 pl-2.5 text-[13px]">
          {x.estado === 'subiendo' ? <CircleNotch className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" /> : x.estado === 'fallo' ? <Warning weight="fill" className="size-4 shrink-0 text-destructive" /> : <Icono clase={x.clase} className="size-4 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{x.nombre}</span>
            {x.estado === 'subiendo' && <span className="block text-xs text-muted-foreground">Subiendo</span>}
            {x.estado === 'fallo' && <span className="block text-xs text-pretty text-muted-foreground" role="alert">{x.error}</span>}
          </span>
          <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${x.nombre}`} onClick={() => alQuitar(x.local)} className="size-9 shrink-0">
            <X className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** El archivo en el globo del Dueño. Abre en otra pestaña, con la misma sesión. */
export function ArchivoEnElGlobo({ adjunto }: { adjunto: Adjunto }) {
  const detalle = adjunto.paginasDelOriginal ? `Leo las primeras ${adjunto.paginas} de ${adjunto.paginasDelOriginal} páginas` : adjunto.clase === 'pdf' ? adjuntoEnPalabras(adjunto) : null
  return (
    <a href={`/api/dueno/archivos/${adjunto.id}`} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 rounded-[calc(var(--radius)-4px)] bg-background/60 px-2.5 py-1.5 text-[13px] underline-offset-2 hover:underline">
      <Icono clase={adjunto.clase} className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate">{adjunto.nombre}</span>
        {detalle && <span className="block text-xs text-muted-foreground">{detalle}</span>}
      </span>
    </a>
  )
}
