CREATE TABLE "archivos_dueno" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"dueno_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nombre" text NOT NULL,
	"paginas" integer,
	"paginas_del_original" integer,
	"tamano" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"enviado" timestamp with time zone,
	"lecturas" integer DEFAULT 0 NOT NULL,
	"ultima_lectura" timestamp with time zone,
	"extraido" jsonb,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "archivos_dueno_peso" CHECK (octet_length("archivos_dueno"."bytes") <= 4000000),
	CONSTRAINT "archivos_dueno_paginas" CHECK ("archivos_dueno"."paginas" is null or "archivos_dueno"."paginas" <= 20)
);
--> statement-breakpoint
ALTER TABLE "archivos_dueno" ADD CONSTRAINT "archivos_dueno_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archivos_dueno" ADD CONSTRAINT "archivos_dueno_dueno_id_duenos_id_fk" FOREIGN KEY ("dueno_id") REFERENCES "public"."duenos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archivos_dueno_negocio" ON "archivos_dueno" USING btree ("negocio_id","creado");