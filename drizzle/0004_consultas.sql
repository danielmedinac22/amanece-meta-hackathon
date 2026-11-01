-- Aditiva e idempotente: correrla dos veces deja lo mismo. No borra filas ni columnas.
-- Los GRANT por columna salen de FUENTES[*].lee en src/nucleo/consultas/catalogo.ts (scripts/grants-de-consultas.mts);
-- probar-consultas compara esa lista con information_schema.column_privileges en los dos sentidos.

-- 1. El rol de las consultas: sin login y sin BYPASSRLS. Si ya existía, se le vuelven a fijar los atributos. SUPERUSER y
--    REPLICATION no se nombran: en Neon solo un superusuario puede tocarlos, y por defecto el rol nace sin ellos.
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amanece_consultas') THEN
		CREATE ROLE amanece_consultas NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
	END IF;
END $$;--> statement-breakpoint
ALTER ROLE amanece_consultas NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;--> statement-breakpoint

-- 2. Quien corre la migración es el dueño de las tablas y el usuario de la aplicación: puede hacer
--    SET ROLE amanece_consultas, pero no hereda sus privilegios (Postgres 18 en Neon).
DO $$ BEGIN
	EXECUTE format('GRANT amanece_consultas TO %I WITH INHERIT FALSE, SET TRUE', current_user);
END $$;--> statement-breakpoint

-- 3. Nada por defecto, y después solo las columnas que leen las CTE. REVOKE ALL en la tabla también quita los de
--    columna: una columna que salió del catálogo pierde su GRANT al volver a correr.
GRANT USAGE ON SCHEMA public TO amanece_consultas;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM amanece_consultas;--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM amanece_consultas;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM amanece_consultas;--> statement-breakpoint
GRANT SELECT (negocio_id, id, numero, cliente_id, ciudad, estado, total, creado, items) ON public.pedidos TO amanece_consultas;--> statement-breakpoint
GRANT SELECT (negocio_id, id, nombre, creado, ultimo_mensaje_entrante) ON public.clientes TO amanece_consultas;--> statement-breakpoint
GRANT SELECT (negocio_id, id, cliente_id, pedido_id, titulo, estado, creado, resuelto) ON public.casos TO amanece_consultas;--> statement-breakpoint
GRANT SELECT (negocio_id, cliente_id, rol, creado) ON public.mensajes_cliente TO amanece_consultas;--> statement-breakpoint

-- 4. RLS solo para amanece_consultas, sin FORCE: el dueño de las tablas no cambia. Sin app.negocio_id el cast falla:
--    la consulta da error, no filas de nadie.
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.casos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.mensajes_cliente ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.pedidos;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.pedidos AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.clientes;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.clientes AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.casos;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.casos AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.mensajes_cliente;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.mensajes_cliente AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);--> statement-breakpoint

-- 5. Capacidad faltante con motivo tipado. `motivo` (texto) se queda: las filas viejas no se pierden y el código de
--    antes lo sigue escribiendo, con `tipo` y `clave_de_agrupacion` en 'anterior' por defecto.
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'anterior' NOT NULL;--> statement-breakpoint
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS clave_de_agrupacion text DEFAULT 'anterior' NOT NULL;--> statement-breakpoint
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS detalle jsonb;--> statement-breakpoint
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS propuesta_id uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE public.capacidades_faltantes ADD CONSTRAINT capacidades_faltantes_propuesta_id_propuestas_id_fk FOREIGN KEY (propuesta_id) REFERENCES public.propuestas(id) ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS capacidades_faltantes_clave ON public.capacidades_faltantes USING btree (clave_de_agrupacion, creado);--> statement-breakpoint

-- El texto de antes era `claveDeAgrupacion(m)` o `claveDeAgrupacion(m): detalle`. Solo toca filas todavía 'anterior' cuyo
-- texto se reconoce; las demás quedan 'anterior' con su texto, y correrlo otra vez no cambia nada. Un sin_converger de
-- antes guardaba el error como texto: queda con su tipo y sin detalle.
UPDATE public.capacidades_faltantes f
SET tipo = s.tipo,
	clave_de_agrupacion = s.clave,
	detalle = CASE s.tipo
		WHEN 'no_hay' THEN jsonb_build_object('tipo', 'no_hay', 'que', split_part(s.clave, ':', 2))
		WHEN 'sin_cumplidor' THEN jsonb_build_object('tipo', 'sin_cumplidor', 'que', to_jsonb(string_to_array(split_part(s.clave, ':', 2), ',')))
		WHEN 'regla_vieja' THEN jsonb_build_object('tipo', 'regla_vieja')
		WHEN 'fuera_de_la_lista' THEN jsonb_build_object('tipo', 'fuera_de_la_lista', 'descripcion', substr(f.motivo, length(s.clave) + 3))
		ELSE NULL
	END
FROM (
	SELECT id, split_part(motivo, ': ', 1) AS clave, split_part(split_part(motivo, ': ', 1), ':', 1) AS tipo
	FROM public.capacidades_faltantes
	WHERE tipo = 'anterior' AND detalle IS NULL
) s
WHERE f.id = s.id AND s.tipo IN ('no_hay', 'sin_cumplidor', 'sin_converger', 'fuera_de_la_lista', 'regla_vieja');--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE public.capacidades_faltantes ADD CONSTRAINT capacidades_faltantes_tipo CHECK (tipo IN ('no_hay', 'sin_cumplidor', 'no_se_puede', 'sin_converger', 'fuera_de_la_lista', 'regla_vieja', 'anterior'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE public.capacidades_faltantes ADD CONSTRAINT capacidades_faltantes_detalle CHECK (detalle IS NULL OR detalle->>'tipo' = tipo);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
