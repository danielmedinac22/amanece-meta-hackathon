-- Prototipo desechable de la medición del aislamiento entre Negocios (ticket #12). Se aplica solo en una rama de
-- Neon que se borra al terminar; no es una migración de Drizzle ni toca `src/db/esquema.ts`. Parte del esquema
-- real de la app (rama con `--schema-only`: `negocios`, `clientes`, `pedidos`, `mensajes_cliente`).
-- `scripts/medir-aislamiento.mts` corta este archivo por las líneas `--;` y corre cada trozo por separado,
-- porque el driver HTTP de Neon manda una sentencia por petición.

-- ===== M1. La cola, con `negocio_id` (forma de `scripts/medir-turno-durable.sql` del ticket #13) =====
create table if not exists trabajos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios (id) on delete cascade,
  clave text not null unique,
  tipo text not null default 'turno',
  carga jsonb not null default '{}',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'en_curso', 'hecho', 'muerto')),
  intentos integer not null default 0,
  disponible_desde timestamptz not null default clock_timestamp(),
  reclamado_hasta timestamptz,
  ultimo_error text,
  creado timestamptz not null default clock_timestamp(),
  -- Relojes del servidor al reclamar y al terminar: de ahí salen las esperas y el máximo de trabajos en curso.
  reclamado_ts timestamptz,
  terminado timestamptz
);
--;
-- El índice de #13: solo lo que todavía se puede reclamar, en orden de llegada global.
create index if not exists trabajos_cola on trabajos (disponible_desde) where estado in ('pendiente', 'en_curso');
--;
-- Los dos índices que necesita el reclamo justo por Negocio (la medición los quita para mostrar qué pasa sin ellos).
create index if not exists trabajos_negocio_pendiente on trabajos (negocio_id, disponible_desde) where estado = 'pendiente';
--;
create index if not exists trabajos_negocio_en_curso on trabajos (negocio_id) where estado = 'en_curso';
--;
-- Una fila por Negocio con trabajo: marca cuándo se le atendió por última vez (el turno del round-robin).
create table if not exists cola_negocios (
  negocio_id uuid primary key references negocios (id) on delete cascade,
  ultimo_servido timestamptz
);
--;

-- ===== M2. Cupos atómicos por (Negocio, recurso, ventana) =====
create table if not exists cupos (
  negocio_id uuid not null references negocios (id) on delete cascade,
  recurso text not null,
  ventana text not null,
  tope bigint not null check (tope >= 0),
  usado bigint not null default 0 check (usado >= 0),
  primary key (negocio_id, recurso, ventana)
);
--;
-- Libro de reservas: es lo que hace idempotente la devolución de lo no usado.
create table if not exists reservas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios (id) on delete cascade,
  recurso text not null,
  ventana text not null,
  cantidad bigint not null check (cantidad > 0),
  estado text not null default 'reservada' check (estado in ('reservada', 'liquidada')),
  consumido bigint,
  creado timestamptz not null default clock_timestamp()
);
--;

-- ===== M3. Roles con RLS por `current_setting('app.negocio_id')` (el ligado de #8) =====
-- `amanece_consultas`: el rol de Secciones e Indicadores (SQL acotado). Sin el texto de los mensajes.
-- `amanece_nucleo`: el rol hipotético de una app con RLS en todas partes (lecturas del núcleo, con texto).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'amanece_consultas') then
    create role amanece_consultas nologin nobypassrls nosuperuser nocreaterole nocreatedb;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'amanece_nucleo') then
    create role amanece_nucleo nologin nobypassrls nosuperuser nocreaterole nocreatedb;
  end if;
end $$;
--;
-- Sin `WITH INHERIT FALSE, SET TRUE`, `SET LOCAL ROLE` falla desde `neondb_owner`.
grant amanece_consultas to neondb_owner with inherit false, set true;
--;
grant amanece_nucleo to neondb_owner with inherit false, set true;
--;
grant usage on schema public to amanece_consultas, amanece_nucleo;
--;
revoke all on all tables in schema public from amanece_consultas, amanece_nucleo;
--;
grant select (id, negocio_id, cliente_id, numero, items, total, ciudad, estado, creado) on pedidos to amanece_consultas;
--;
grant select (id, negocio_id, nombre, creado) on clientes to amanece_consultas;
--;
grant select (id, negocio_id, cliente_id, rol, creado) on mensajes_cliente to amanece_consultas;
--;
grant select on pedidos, clientes, mensajes_cliente to amanece_nucleo;
--;
alter table pedidos enable row level security;
--;
alter table clientes enable row level security;
--;
alter table mensajes_cliente enable row level security;
--;
drop policy if exists consultas_negocio on pedidos;
--;
drop policy if exists consultas_negocio on clientes;
--;
drop policy if exists consultas_negocio on mensajes_cliente;
--;
drop policy if exists nucleo_negocio on pedidos;
--;
drop policy if exists nucleo_negocio on clientes;
--;
drop policy if exists nucleo_negocio on mensajes_cliente;
--;
create policy consultas_negocio on pedidos for select to amanece_consultas using (negocio_id = current_setting('app.negocio_id')::uuid);
--;
create policy consultas_negocio on clientes for select to amanece_consultas using (negocio_id = current_setting('app.negocio_id')::uuid);
--;
create policy consultas_negocio on mensajes_cliente for select to amanece_consultas using (negocio_id = current_setting('app.negocio_id')::uuid);
--;
create policy nucleo_negocio on pedidos for select to amanece_nucleo using (negocio_id = current_setting('app.negocio_id')::uuid);
--;
create policy nucleo_negocio on clientes for select to amanece_nucleo using (negocio_id = current_setting('app.negocio_id')::uuid);
--;
create policy nucleo_negocio on mensajes_cliente for select to amanece_nucleo using (negocio_id = current_setting('app.negocio_id')::uuid);
