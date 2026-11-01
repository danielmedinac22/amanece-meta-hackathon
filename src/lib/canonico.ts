/** El mismo valor da el mismo texto: claves de objeto ordenadas. Para huellas y para comparar contenido jsonb. */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
