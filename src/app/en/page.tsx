import { metadatosDePortada, Portada } from '../portada/portada'

export const metadata = metadatosDePortada('en')

export default function Page() {
  return <Portada idioma="en" />
}
