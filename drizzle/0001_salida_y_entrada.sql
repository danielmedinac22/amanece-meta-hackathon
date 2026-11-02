CREATE TABLE "mensajes_entrantes" (
	"wamid" text PRIMARY KEY NOT NULL,
	"telefono" text NOT NULL,
	"enviado_en" timestamp with time zone NOT NULL,
	"boton" text,
	"recibido" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensajes_salientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clave" text NOT NULL,
	"negocio_id" uuid,
	"cliente_id" uuid,
	"caso_id" uuid,
	"telefono" text,
	"clase" text NOT NULL,
	"en_respuesta_a" text,
	"veredicto" text NOT NULL,
	"motivo" text,
	"estado" text NOT NULL,
	"wamid" text,
	"error" text,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado" timestamp with time zone,
	CONSTRAINT "mensajes_salientes_motivo" CHECK (("mensajes_salientes"."veredicto" = 'sale') = ("mensajes_salientes"."motivo" is null))
);
--> statement-breakpoint
ALTER TABLE "duenos" ADD COLUMN "telefono" text;--> statement-breakpoint
ALTER TABLE "mensajes_salientes" ADD CONSTRAINT "mensajes_salientes_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_salientes" ADD CONSTRAINT "mensajes_salientes_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_salientes" ADD CONSTRAINT "mensajes_salientes_caso_id_casos_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."casos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mensajes_entrantes_telefono" ON "mensajes_entrantes" USING btree ("telefono","enviado_en");--> statement-breakpoint
CREATE UNIQUE INDEX "mensajes_salientes_clave" ON "mensajes_salientes" USING btree ("clave");--> statement-breakpoint
CREATE UNIQUE INDEX "mensajes_salientes_una_respuesta" ON "mensajes_salientes" USING btree ("en_respuesta_a") WHERE "mensajes_salientes"."veredicto" = 'sale';--> statement-breakpoint
CREATE INDEX "mensajes_salientes_negocio" ON "mensajes_salientes" USING btree ("negocio_id","creado");--> statement-breakpoint
CREATE INDEX "mensajes_salientes_telefono" ON "mensajes_salientes" USING btree ("telefono","creado");--> statement-breakpoint
CREATE UNIQUE INDEX "duenos_telefono" ON "duenos" USING btree ("telefono") WHERE "duenos"."telefono" is not null;