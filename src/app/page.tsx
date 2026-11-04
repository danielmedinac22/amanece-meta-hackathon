import { metadatosDePortada, Portada } from './portada/portada'

export const metadata = metadatosDePortada('es')

export default function Page() {
  return <Portada idioma="es" />
}
