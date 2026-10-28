DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amanece_consultas') THEN
    CREATE ROLE amanece_consultas NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
END $$;
GRANT amanece_consultas TO neondb_owner WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public TO amanece_consultas;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM amanece_consultas;
GRANT SELECT (id, negocio_id, cliente_id, numero, items, total, ciudad, estado, creado) ON pedidos TO amanece_consultas;
GRANT SELECT (id, negocio_id, nombre, descripcion, precio, activo) ON productos TO amanece_consultas;
GRANT SELECT (id, negocio_id, nombre, creado) ON clientes TO amanece_consultas;
GRANT SELECT (id, negocio_id, cliente_id, pedido_id, titulo, estado, creado, resuelto) ON casos TO amanece_consultas;
GRANT SELECT (id, negocio_id, cliente_id, rol, creado) ON mensajes_cliente TO amanece_consultas;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE casos ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensajes_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consultas_negocio ON pedidos;
DROP POLICY IF EXISTS consultas_negocio ON productos;
DROP POLICY IF EXISTS consultas_negocio ON clientes;
DROP POLICY IF EXISTS consultas_negocio ON casos;
DROP POLICY IF EXISTS consultas_negocio ON mensajes_cliente;
CREATE POLICY consultas_negocio ON pedidos FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);
CREATE POLICY consultas_negocio ON productos FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);
CREATE POLICY consultas_negocio ON clientes FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);
CREATE POLICY consultas_negocio ON casos FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);
CREATE POLICY consultas_negocio ON mensajes_cliente FOR SELECT TO amanece_consultas USING (negocio_id = current_setting('app.negocio_id')::uuid);
