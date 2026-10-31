CREATE TABLE IF NOT EXISTS "elementos" (
	"negocio_id" uuid NOT NULL,
	"clave" text NOT NULL,
	"version" integer NOT NULL,
	"tipo" text NOT NULL,
	"contrato" integer DEFAULT 1 NOT NULL,
	"contenido" jsonb,
	"origen" text NOT NULL,
	"propuesta_id" uuid,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elementos_negocio_id_clave_version_pk" PRIMARY KEY("negocio_id","clave","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "filas_de_tabla" (
	"negocio_id" uuid NOT NULL,
	"tabla" text NOT NULL,
	"fila" text NOT NULL,
	"version" integer NOT NULL,
	"valores" jsonb,
	"origen" text NOT NULL,
	"propuesta_id" uuid,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filas_de_tabla_negocio_id_tabla_fila_version_pk" PRIMARY KEY("negocio_id","tabla","fila","version")
);
--> statement-breakpoint
ALTER TABLE "negocios" ADD COLUMN IF NOT EXISTS "modo" text GENERATED ALWAYS AS (case when estado = 'listo' then 'atendiendo' else 'armando' end) STORED;--> statement-breakpoint
ALTER TABLE "negocios" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "negocios" ADD COLUMN IF NOT EXISTS "pais" text DEFAULT 'CO' NOT NULL;--> statement-breakpoint
ALTER TABLE "negocios" ADD COLUMN IF NOT EXISTS "moneda" text DEFAULT 'COP' NOT NULL;--> statement-breakpoint
ALTER TABLE "negocios" ADD COLUMN IF NOT EXISTS "zona_horaria" text DEFAULT 'America/Bogota' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "elementos" ADD CONSTRAINT "elementos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "elementos" ADD CONSTRAINT "elementos_propuesta_id_propuestas_id_fk" FOREIGN KEY ("propuesta_id") REFERENCES "public"."propuestas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "filas_de_tabla" ADD CONSTRAINT "filas_de_tabla_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "filas_de_tabla" ADD CONSTRAINT "filas_de_tabla_propuesta_id_propuestas_id_fk" FOREIGN KEY ("propuesta_id") REFERENCES "public"."propuestas"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "elementos_propuesta" ON "elementos" USING btree ("propuesta_id");