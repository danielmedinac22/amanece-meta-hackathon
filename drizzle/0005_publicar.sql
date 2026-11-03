-- Aditiva e idempotente: correrla dos veces deja lo mismo. No borra filas ni columnas.
-- Va antes del código. El DEFAULT deja lo de hoy publicado sin copiar nada, y lo que el código viejo escriba durante el
-- corte se ve. El código nuevo siempre dice el bit.
ALTER TABLE "elementos" ADD COLUMN IF NOT EXISTS "sin_publicar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "elementos_sin_publicar" ON "elementos" USING btree ("negocio_id") WHERE "sin_publicar";
