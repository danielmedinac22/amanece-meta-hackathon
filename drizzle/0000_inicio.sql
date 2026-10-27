CREATE TABLE "cambios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"dueno_id" uuid,
	"tipo" text NOT NULL,
	"pedido" text NOT NULL,
	"resumen" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'propuesto' NOT NULL,
	"propuesta" jsonb NOT NULL,
	"anterior" jsonb,
	"vista_previa" jsonb,
	"tokens_entrada" integer DEFAULT 0 NOT NULL,
	"tokens_salida" integer DEFAULT 0 NOT NULL,
	"costo_usd" real DEFAULT 0 NOT NULL,
	"ms_hasta_propuesta" integer,
	"ms_hasta_aplicado" integer,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"aplicado" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "capacidades_faltantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"pedido" text NOT NULL,
	"motivo" text DEFAULT '' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "casos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"cliente_id" uuid,
	"pedido_id" uuid,
	"titulo" text NOT NULL,
	"detalle" text DEFAULT '' NOT NULL,
	"propuesta" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'abierto' NOT NULL,
	"resolucion" text DEFAULT '' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"telefono" text NOT NULL,
	"nombre" text DEFAULT '' NOT NULL,
	"ultimo_mensaje_entrante" timestamp with time zone,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duenos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"usuario_id" text NOT NULL,
	"nombre" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensajes_cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"rol" text NOT NULL,
	"texto" text NOT NULL,
	"wamid" text,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensajes_dueno" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"dueno_id" uuid NOT NULL,
	"rol" text NOT NULL,
	"mensaje" jsonb NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "negocios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"rubro" text DEFAULT '' NOT NULL,
	"codigo" text NOT NULL,
	"conocimiento" jsonb DEFAULT '{"descripcion":"","ciudad":"","horario":"","envios":"","pagos":"","tono":"","preguntas":[]}'::jsonb NOT NULL,
	"estado" text DEFAULT 'armando' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pedidos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"items" jsonb NOT NULL,
	"total" integer NOT NULL,
	"ciudad" text DEFAULT '' NOT NULL,
	"direccion" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "piezas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"clave" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"codigo" text NOT NULL,
	"vista" jsonb,
	"activa" boolean DEFAULT true NOT NULL,
	"cambio_id" uuid,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "productos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"precio" integer NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reglas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid NOT NULL,
	"clave" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"texto" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"cambio_id" uuid,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesiones_whatsapp" (
	"telefono" text PRIMARY KEY NOT NULL,
	"negocio_id" uuid NOT NULL,
	"actualizado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turnos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"negocio_id" uuid,
	"agente" text NOT NULL,
	"modelo" text NOT NULL,
	"tokens_entrada" integer NOT NULL,
	"tokens_salida" integer NOT NULL,
	"costo_usd" real NOT NULL,
	"ms" integer NOT NULL,
	"creado" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cambios" ADD CONSTRAINT "cambios_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cambios" ADD CONSTRAINT "cambios_dueno_id_duenos_id_fk" FOREIGN KEY ("dueno_id") REFERENCES "public"."duenos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacidades_faltantes" ADD CONSTRAINT "capacidades_faltantes_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casos" ADD CONSTRAINT "casos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casos" ADD CONSTRAINT "casos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casos" ADD CONSTRAINT "casos_pedido_id_pedidos_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedidos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duenos" ADD CONSTRAINT "duenos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_cliente" ADD CONSTRAINT "mensajes_cliente_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_cliente" ADD CONSTRAINT "mensajes_cliente_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_dueno" ADD CONSTRAINT "mensajes_dueno_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes_dueno" ADD CONSTRAINT "mensajes_dueno_dueno_id_duenos_id_fk" FOREIGN KEY ("dueno_id") REFERENCES "public"."duenos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piezas" ADD CONSTRAINT "piezas_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piezas" ADD CONSTRAINT "piezas_cambio_id_cambios_id_fk" FOREIGN KEY ("cambio_id") REFERENCES "public"."cambios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "productos" ADD CONSTRAINT "productos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglas" ADD CONSTRAINT "reglas_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reglas" ADD CONSTRAINT "reglas_cambio_id_cambios_id_fk" FOREIGN KEY ("cambio_id") REFERENCES "public"."cambios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones_whatsapp" ADD CONSTRAINT "sesiones_whatsapp_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_negocio_id_negocios_id_fk" FOREIGN KEY ("negocio_id") REFERENCES "public"."negocios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cambios_negocio" ON "cambios" USING btree ("negocio_id","creado");--> statement-breakpoint
CREATE INDEX "casos_negocio" ON "casos" USING btree ("negocio_id","creado");--> statement-breakpoint
CREATE UNIQUE INDEX "clientes_negocio_telefono" ON "clientes" USING btree ("negocio_id","telefono");--> statement-breakpoint
CREATE UNIQUE INDEX "duenos_usuario" ON "duenos" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "mensajes_cliente_cliente" ON "mensajes_cliente" USING btree ("cliente_id","creado");--> statement-breakpoint
CREATE UNIQUE INDEX "mensajes_cliente_wamid" ON "mensajes_cliente" USING btree ("wamid");--> statement-breakpoint
CREATE INDEX "mensajes_dueno_dueno" ON "mensajes_dueno" USING btree ("dueno_id","creado");--> statement-breakpoint
CREATE UNIQUE INDEX "negocios_codigo" ON "negocios" USING btree ("codigo");--> statement-breakpoint
CREATE INDEX "pedidos_negocio" ON "pedidos" USING btree ("negocio_id","creado");--> statement-breakpoint
CREATE UNIQUE INDEX "pedidos_negocio_numero" ON "pedidos" USING btree ("negocio_id","numero");--> statement-breakpoint
CREATE INDEX "piezas_negocio" ON "piezas" USING btree ("negocio_id","activa");--> statement-breakpoint
CREATE INDEX "productos_negocio" ON "productos" USING btree ("negocio_id");--> statement-breakpoint
CREATE INDEX "reglas_negocio" ON "reglas" USING btree ("negocio_id","activa");--> statement-breakpoint
CREATE INDEX "turnos_creado" ON "turnos" USING btree ("creado");