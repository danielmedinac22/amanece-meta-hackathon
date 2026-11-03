-- Aditiva e idempotente: correrla dos veces deja lo mismo. No borra ni llena nada.
-- Va antes del código: `atender.ts` lee la fila entera de `pedidos`, y el código nuevo sobre una base sin esta columna
-- falla en cada turno de un Cliente. El código viejo sobre una base migrada sigue igual, porque nombra sus columnas.
-- Sin backfill: un pedido ya confirmado queda en null y `Lo último` no lo cuenta.
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "confirmado" timestamp with time zone;
