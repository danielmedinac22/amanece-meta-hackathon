CREATE TABLE "propuestas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"palabras_del_dueno" text NOT NULL,
	"pedido_por" uuid,
	"origen" text DEFAULT 'hilo' NOT NULL,
	"escritura" jsonb DEFAULT '{"elementos":[],"filas":[]}'::jsonb NOT NULL,
	"actos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"huella" text NOT NULL,
	"estado" text DEFAULT 'espera_al_dueno' NOT NULL,
	"vence" timestamp with time zone NOT NULL,
	"vista_previa" jsonb NOT NULL,
	"aprobado_por" uuid,
	"version" integer,
	"revierte" uuid,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "propuestas_aprobada" CHECK ("propuestas"."aprobado_por" is null or "propuestas"."estado" = 'aplicada')
);
--> statement-breakpoint
ALTER TABLE "cambios" ADD COLUMN "propuesta_id" uuid;--> statement-breakpoint
ALTER TABLE "propuestas" ADD CONSTRAINT "propuestas_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas" ADD CONSTRAINT "propuestas_pedido_por_duenos_id_fk" FOREIGN KEY ("pedido_por") REFERENCES "public"."duenos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas" ADD CONSTRAINT "propuestas_aprobado_por_duenos_id_fk" FOREIGN KEY ("aprobado_por") REFERENCES "public"."duenos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propuestas" ADD CONSTRAINT "propuestas_revierte_propuestas_id_fk" FOREIGN KEY ("revierte") REFERENCES "public"."propuestas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "propuestas_negocio" ON "propuestas" USING btree ("negocio_id","creado");--> statement-breakpoint
CREATE INDEX "propuestas_pendientes" ON "propuestas" USING btree ("negocio_id","vence") WHERE "propuestas"."estado" = 'espera_al_dueno';--> statement-breakpoint
CREATE UNIQUE INDEX "propuestas_una_reversion" ON "propuestas" USING btree ("revierte") WHERE "propuestas"."estado" = 'aplicada';--> statement-breakpoint
ALTER TABLE "cambios" ADD CONSTRAINT "cambios_propuesta_id_propuestas_id_fk" FOREIGN KEY ("propuesta_id") REFERENCES "public"."propuestas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cambios_propuesta" ON "cambios" USING btree ("propuesta_id") WHERE "cambios"."propuesta_id" is not null;