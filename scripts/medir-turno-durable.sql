-- Prototipo desechable de la medición del turno durable (ticket #13). Se aplica solo en una rama de Neon
-- que se borra al terminar; no es una migración de Drizzle ni toca `src/db/esquema.ts`.
-- `scripts/medir-turno-durable.mts` corta este archivo por las líneas `--;` y corre cada trozo por separado,
-- porque el driver HTTP de Neon manda una sentencia por petición.

-- Una fila por trabajo. `clave` única es la deduplicación: `entrada:<wamid>` para un mensaje que entra.
create table if not exists trabajos (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  tipo text not null,
  carga jsonb not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'hecho', 'muerto')),
  intentos integer not null default 0,
  disponible_desde timestamptz not null default now(),
  reclamado_hasta timestamptz,
  ultimo_error text,
  creado timestamptz not null default now(),
  terminado timestamptz
);
--;
-- Solo lo que todavía se puede reclamar: la cola no se hace más lenta con lo ya hecho.
create index if not exists trabajos_cola on trabajos (disponible_desde) where estado in ('pendiente', 'en_curso');
--;
-- Una respuesta por mensaje entrante, garantizada por el índice único de `en_respuesta_a` (el wamid que entró).
-- `enviando` es "reclamada": el envío está en curso o ya ocurrió sin confirmarse. Si el reclamo vence, pasa a
-- `incierta` y queda visible: no se reenvía a ciegas.
create table if not exists salientes (
  id uuid primary key default gen_random_uuid(),
  en_respuesta_a text not null unique,
  negocio_id uuid references negocios (id) on delete cascade,
  cliente_id uuid references clientes (id) on delete cascade,
  texto text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviada', 'incierta')),
  reclamado_hasta timestamptz,
  wamid text,
  creado timestamptz not null default now(),
  enviado timestamptz
);
--;
create index if not exists salientes_inciertas on salientes (reclamado_hasta) where estado in ('enviando', 'incierta');
