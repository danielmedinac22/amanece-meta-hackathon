const SECCIONES = [
  { titulo: 'Quién responde', parrafos: ['Daniel Medina, Colombia. danielmedina2205@gmail.com.'] },
  {
    titulo: 'Qué guardamos',
    parrafos: [
      'Si armas un Negocio: tu nombre y correo, lo que le escribes a tu agente, tus archivos y los datos del Negocio.',
      'Si le escribes a un Negocio por WhatsApp: tu número, tu nombre de perfil, tus mensajes, y tus pedidos y citas. Ese Negocio ve tu conversación.',
    ],
  },
  { titulo: 'Para qué', parrafos: ['Para contestar, tomar pedidos y citas, y mostrarle al Dueño lo que necesita. No vendemos tus datos ni los usamos para publicidad.'] },
  { titulo: 'Quién más los procesa', parrafos: ['Clerk (cuentas), Neon (base de datos), Vercel (servidores), Kapso y Meta (WhatsApp), y Muse Spark de Meta, que lee los mensajes para responder.'] },
  { titulo: 'Con Google', parrafos: ['Solo recibimos tu nombre, correo y foto, para identificar tu cuenta.'] },
  { titulo: 'Tus derechos', parrafos: ['Puedes pedir por correo conocer, corregir o borrar tus datos. En Colombia te protege la Ley 1581 de 2012.'] },
] as const

export function PoliticaDePrivacidad() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-5 py-12 text-foreground">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Política de privacidad</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última actualización: 4 de noviembre de 2026.</p>
      {SECCIONES.map((s) => (
        <section key={s.titulo} className="mt-8">
          <h2 className="font-heading text-lg font-semibold">{s.titulo}</h2>
          {s.parrafos.map((p) => (
            <p key={p} className="mt-2 leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  )
}
