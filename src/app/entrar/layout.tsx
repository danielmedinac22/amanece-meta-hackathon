import type { ReactNode } from 'react'
import { ProveedorDeSesion } from '@/lib/auth/proveedor'

export default function LayoutDeEntrar({ children }: { children: ReactNode }) {
  return <ProveedorDeSesion>{children}</ProveedorDeSesion>
}
