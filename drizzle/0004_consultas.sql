-- Aditiva e idempotente: correrla dos veces deja lo mismo. No borra filas ni columnas.
-- Los GRANT por columna salen de FUENTES[*].lee en src/nucleo/consultas/catalogo.ts (scripts/grants-de-consultas.mts);
-- probar-consultas compara esa lista con information_schema.column_privileges en los dos sentidos.

-- 1. El rol de las consultas, sin BYPASSRLS. Nace sin login: scripts/rol-de-consultas.mts le da login y contraseña, fuera
--    de la migración. El ALTER no nombra LOGIN: si lo nombrara, volver a correrla apagaría el login en producción.
--    SUPERUSER y REPLICATION no se nombran: en Neon solo un superusuario puede tocarlos, y por defecto el rol nace sin ellos.
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amanece_consultas') THEN
		CREATE ROLE amanece_consultas NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
	END IF;
END $$;--> statement-breakpoint
ALTER ROLE amanece_consultas NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;--> statement-breakpoint
-- Lo que vale aunque alguien use su URL sin el lote. RESET ALL vuelve a estos valores, no a cero.
ALTER ROLE amanece_consultas SET default_transaction_read_only = on;--> statement-breakpoint
ALTER ROLE amanece_consultas SET statement_timeout = '2s';--> statement-breakpoint
ALTER ROLE amanece_consultas SET search_path = '';--> statement-breakpoint

-- 2. El dueño no se vuelve amanece_consultas: el lote entra con su propia URL. Queda la fila de ADMIN que Postgres 16+ le
--    da a quien crea un rol; lo que cuenta es que pg_has_role(dueño, rol, 'SET') y 'USAGE' den falso.
REVOKE amanece_consultas FROM CURRENT_USER;--> statement-breakpoint

-- Puente hasta el rol por Negocio de #12, que quita la llave, la firma y las dos funciones: la política no cree en el
-- app.negocio_id que el SQL puede cambiar con set_config, solo en el que trae la firma HMAC de la llave. La llave nunca sale
-- de la base: amanece_consultas no la lee y la aplicación solo recibe firmas.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.llave_de_consultas (clave bytea NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS llave_de_consultas_una_sola_fila ON public.llave_de_consultas ((true));--> statement-breakpoint
INSERT INTO public.llave_de_consultas (clave) SELECT public.gen_random_bytes(32) WHERE NOT EXISTS (SELECT 1 FROM public.llave_de_consultas);--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.consultas_negocio() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
	n text := current_setting('app.negocio_id', true);
	firma text := current_setting('app.firma', true);
	esperada text;
BEGIN
	SELECT encode(public.hmac(convert_to(n, 'UTF8'), clave, 'sha256'), 'hex') INTO esperada FROM public.llave_de_consultas;
	IF esperada IS NULL OR firma IS DISTINCT FROM esperada THEN
		RAISE EXCEPTION 'consulta sin firma valida' USING ERRCODE = '42501';
	END IF;
	RETURN n::uuid;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.consultas_negocio() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.consultas_negocio() TO amanece_consultas;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.firmar_consulta(negocio uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
	SELECT encode(public.hmac(convert_to(negocio::text, 'UTF8'), clave, 'sha256'), 'hex') FROM public.llave_de_consultas
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.firmar_consulta(uuid) FROM PUBLIC;--> statement-breakpoint

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

-- 4. RLS solo para amanece_consultas, sin FORCE: el dueño de las tablas no cambia. Sin una firma válida consultas_negocio
--    lanza 42501: la consulta da error, no filas de nadie.
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.casos ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.mensajes_cliente ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.pedidos;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.pedidos AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = (SELECT public.consultas_negocio()));--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.clientes;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.clientes AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = (SELECT public.consultas_negocio()));--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.casos;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.casos AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = (SELECT public.consultas_negocio()));--> statement-breakpoint
DROP POLICY IF EXISTS consultas_del_negocio ON public.mensajes_cliente;--> statement-breakpoint
CREATE POLICY consultas_del_negocio ON public.mensajes_cliente AS PERMISSIVE FOR SELECT TO amanece_consultas USING (negocio_id = (SELECT public.consultas_negocio()));--> statement-breakpoint

-- 5. Capacidad faltante con motivo tipado. `motivo` (texto) se queda: las filas viejas no se pierden y el código de
--    antes lo sigue escribiendo, con `tipo` y `clave_de_agrupacion` en 'anterior' por defecto.
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS tipo text DEFAULT 'anterior' NOT NULL;--> statement-breakpoint
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS clave_de_agrupacion text DEFAULT 'anterior' NOT NULL;--> statement-breakpoint
ALTER TABLE public.capacidades_faltantes ADD COLUMN IF NOT EXISTS detalle jsonb;--> statement-breakpoint
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
