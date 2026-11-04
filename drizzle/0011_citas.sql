CREATE TABLE "citas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"asunto" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'agendada' NOT NULL,
	"movida_de" timestamp with time zone,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citas" ADD CONSTRAINT "citas_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citas" ADD CONSTRAINT "citas_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citas_negocio_inicio" ON "citas" USING btree ("negocio_id","inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "citas_una_por_hora" ON "citas" USING btree ("negocio_id","inicio") WHERE "citas"."estado" = 'agendada';--> statement-breakpoint
CREATE UNIQUE INDEX "citas_una_por_cliente" ON "citas" USING btree ("negocio_id","cliente_id") WHERE "citas"."estado" = 'agendada';