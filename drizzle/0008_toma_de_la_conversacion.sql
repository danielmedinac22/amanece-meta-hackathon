-- Aditiva e idempotente: correrla dos veces deja lo mismo. No borra ni llena nada.
-- Va antes del código y después de la 0007: `atender.ts` escribe estas columnas en cada mensaje de un Cliente y `despachar` las lee en cada salida. El código viejo sobre una base migrada sigue igual, porque nombra sus columnas.
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "tomada_por" uuid REFERENCES "public"."duenos"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "tomada_hasta" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "veces_tomada" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clientes" ADD COLUMN IF NOT EXISTS "sin_contestar" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clientes_tomadas" ON "clientes" USING btree ("tomada_hasta") WHERE "clientes"."tomada_por" is not null;
