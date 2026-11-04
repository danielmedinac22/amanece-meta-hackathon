import { ArrowRight, CheckCircle, Warning } from '@phosphor-icons/react/ssr'
import { buttonVariants } from '@/components/ui/button'
import { fraseDeHoy, MIENTRAS_NADIE_ESCRIBE } from '@/nucleo/hoy-palabras'
import type { Hoy } from '@/nucleo/hoy'
import { CopiarLink } from './copiar-link'
import { IrASeccion } from './ir-a-seccion'
import { LoNuevo } from './lo-nuevo'

export type DatosDeHoy = { hoy: Hoy; link: string; reglas: { clave: string; texto: string }[] }

export function InicioHoy({ hoy, link, reglas }: DatosDeHoy) {
  if (hoy.recienAbierto) return <RecienAbierto voz={hoy.voz} link={link} />
  return (
    <div className="mx-auto flex max-w-[38rem] flex-col gap-7 pt-2">
      <p className="font-heading text-[clamp(20px,5cqw,28px)] leading-[1.28] font-medium tracking-tight text-pretty">
        {fraseDeHoy(hoy.voz, hoy.cifras).map((parte, i) =>
          typeof parte === 'string' ? (
            parte
          ) : (
            <b key={i} className="font-semibold">
              {parte.cifra}
            </b>
          ),
        )}
      </p>
      <LoNuevo />
      <section>
        <h3 className="mb-2 text-sm font-medium">Necesita tu ojo</h3>
        {hoy.ojo.length ? (
          <ul className="flex flex-col gap-2">
            {hoy.ojo.map((o) => (
              <li key={o.clave} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-(--radius) border border-border p-3">
                <Warning weight="fill" className="size-4 shrink-0 text-ojo" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-pretty">{o.titulo}</p>
                  <p className="text-xs text-muted-foreground">{o.detalle}</p>
                </div>
                <IrASeccion href={o.ruta} className={buttonVariants({ size: 'sm', variant: 'secondary' })}>
                  {o.accion} <ArrowRight className="size-3.5" />
                </IrASeccion>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nada por ahora. Cuando algo necesite tu ojo, aparece aquí.</p>
        )}
      </section>
      {hoy.ultimo.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-medium">Lo último</h3>
          <ul>
            {hoy.ultimo.map((u) => (
              <li key={u.clave} className="flex items-baseline gap-3 border-b border-border/60 py-2.5 text-sm last:border-0">
                <CheckCircle weight="fill" className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-pretty wrap-anywhere">{u.texto}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{u.cuando}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-2 text-sm font-medium">Tus Clientes te escriben aquí</h3>
        <CopiarLink link={link} />
      </section>
      {reglas.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Reglas de tu agente de clientes</h3>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {reglas.map((r) => (
              <li key={r.clave}>{r.texto}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function RecienAbierto({ voz, link }: { voz: Hoy['voz']; link: string }) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-5">
      <LoNuevo />
      <div>
        <div className="font-heading text-3xl font-semibold tracking-tight text-balance">Todavía no te ha escrito nadie.</div>
        <p className="mt-2 text-muted-foreground">{MIENTRAS_NADIE_ESCRIBE[voz]}</p>
      </div>
      <CopiarLink link={link} />
    </div>
  )
}
