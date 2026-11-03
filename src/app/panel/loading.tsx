import { Skeleton } from '@/components/ui/skeleton'

export default function Cargando() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
