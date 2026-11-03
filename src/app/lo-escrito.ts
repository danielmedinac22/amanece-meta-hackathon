'use client'

import { useEffect, useSyncExternalStore } from 'react'

type Guardado = { texto: string; hasta: number }

const CLAVE = 'amanece:lo-escrito'
// En un computador compartido, lo que alguien escribió ayer no le llega al Hilo de otra persona.
const VIGENCIA_MS = 24 * 60 * 60 * 1000

function leerLoEscrito(): string | null {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Guardado | null
    return typeof guardado?.texto === 'string' && guardado.hasta > Date.now() ? guardado.texto : null
  } catch {
    return null
  }
}

export function guardarLoEscrito(texto: string) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ texto: texto.trim(), hasta: Date.now() + VIGENCIA_MS } satisfies Guardado))
  } catch {
    // Con el almacenamiento bloqueado, el Dueño sigue y le toca volver a contar. Lo demás funciona igual.
  }
}

export function olvidarLoEscrito() {
  try {
    localStorage.removeItem(CLAVE)
  } catch {}
}

function alCambiarEnOtraPestana(avisar: () => void) {
  window.addEventListener('storage', avisar)
  return () => window.removeEventListener('storage', avisar)
}

export function useLoEscrito() {
  return useSyncExternalStore(alCambiarEnOtraPestana, leerLoEscrito, () => null)
}

/**
 * Lo escrito antes de tener cuenta llega al agente la primera vez que hay Hilo, sin importar cómo se entró: quien
 * pide la cuenta no sabe de este texto, y este texto no sabe de la cuenta. Se borra antes de enviarlo, porque
 * un mensaje repetido gasta otro turno del modelo y confunde más que uno perdido.
 */
export function useRecogerLoEscrito(hayHilo: boolean, alEnviar: (texto: string) => void) {
  useEffect(() => {
    if (!hayHilo) return
    const texto = leerLoEscrito()
    if (!texto) return
    olvidarLoEscrito()
    alEnviar(texto)
  }, [hayHilo, alEnviar])
}
