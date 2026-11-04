-- El índice va primero y no es CONCURRENTLY porque una migración corre en una transacción: frena las escrituras a `mensajes_salientes` mientras se crea, y así `casos` no queda tomada durante esa espera.
CREATE INDEX IF NOT EXISTS "mensajes_salientes_caso" ON "mensajes_salientes" USING btree ("caso_id") WHERE "mensajes_salientes"."caso_id" is not null;--> statement-breakpoint
ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "por_tu_lado" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "casos" ADD COLUMN IF NOT EXISTS "reglas" text[] DEFAULT '{}'::text[] NOT NULL;
