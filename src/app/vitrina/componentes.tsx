'use client'

import { BellIcon, DotsThreeIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const COLORES = ['background', 'foreground', 'card', 'popover', 'primary', 'secondary', 'muted', 'accent', 'destructive', 'bien', 'bien-suave', 'ojo', 'ojo-suave', 'globo-cliente', 'border'] as const
const VARIANTES_DE_BOTON = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const
const VARIANTES_DE_INSIGNIA = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'] as const

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-semibold text-muted-foreground">{titulo}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  )
}

export function Componentes() {
  return (
    <TooltipProvider>
      <main className="mx-auto w-full max-w-5xl space-y-10 px-4 py-10">
        <h1 className="font-heading text-2xl font-semibold">Componentes</h1>

        <Grupo titulo="Colores">
          {COLORES.map((c) => (
            <div key={c} className="w-28 space-y-1 text-xs">
              <div className="h-10 rounded-md border border-border" style={{ background: `var(--${c})` }} />
              {c}
            </div>
          ))}
          <div className="w-28 space-y-1 text-xs">
            <div className="h-10 rounded-md border border-border" style={{ background: 'var(--sol)' }} />
            sol
          </div>
          <div className="w-28 space-y-1 text-xs">
            <div className="h-10 rounded-md border border-border" style={{ background: 'var(--alba)' }} />
            alba
          </div>
          <div className="w-44 rounded-md bg-globo-cliente px-3 py-2 text-sm text-globo-cliente-foreground">Globo del Cliente</div>
          <div className="w-44 rounded-md bg-bien-suave px-3 py-2 text-sm text-bien">Atendiendo</div>
          <div className="w-44 rounded-md bg-ojo-suave px-3 py-2 text-sm text-ojo">Vista previa</div>
        </Grupo>

        <Grupo titulo="Button">
          {VARIANTES_DE_BOTON.map((v) => (
            <Button key={v} variant={v}>
              {v}
            </Button>
          ))}
          <Button size="sm">sm</Button>
          <Button size="lg">lg</Button>
          <Button size="icon" aria-label="Notificaciones">
            <BellIcon />
          </Button>
          <Button disabled>disabled</Button>
        </Grupo>

        <Grupo titulo="Badge">
          {VARIANTES_DE_INSIGNIA.map((v) => (
            <Badge key={v} variant={v}>
              {v}
            </Badge>
          ))}
          <Badge className="bg-bien-suave text-bien">Atendiendo</Badge>
          <Badge className="bg-ojo-suave text-ojo">Vista previa</Badge>
        </Grupo>

        <Grupo titulo="Avatar">
          <Avatar>
            <AvatarFallback>CL</AvatarFallback>
          </Avatar>
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>MR</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>JP</AvatarFallback>
            </Avatar>
          </AvatarGroup>
        </Grupo>

        <Grupo titulo="Card">
          <Card className="w-72">
            <CardHeader>
              <CardTitle className="font-heading">Pedidos de hoy</CardTitle>
              <CardDescription>Cuenta los pedidos creados hoy.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-semibold tabular-nums">14</CardContent>
            <CardFooter className="text-xs text-muted-foreground">Actualizado hace un momento</CardFooter>
          </Card>
        </Grupo>

        <Grupo titulo="Input, Textarea e InputGroup">
          <Input className="w-64" placeholder="Correo" />
          <Textarea className="w-64" placeholder="Escríbele a tu agente…" />
          <InputGroup className="w-64">
            <InputGroupAddon>
              <MagnifyingGlassIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder="Buscar" />
          </InputGroup>
        </Grupo>

        <Grupo titulo="Tabs">
          <Tabs defaultValue="plantillas" className="w-80">
            <TabsList>
              <TabsTrigger value="plantillas">Plantillas</TabsTrigger>
              <TabsTrigger value="hacer">Lo que puede hacer</TabsTrigger>
            </TabsList>
            <TabsContent value="plantillas" className="text-sm">
              Tres plantillas por Rubro.
            </TabsContent>
            <TabsContent value="hacer" className="text-sm">
              Reglas, secciones e indicadores.
            </TabsContent>
          </Tabs>
        </Grupo>

        <Grupo titulo="Table">
          <Table className="max-w-96">
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Marcela Ríos</TableCell>
                <TableCell>Confirmado</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Julián Prada</TableCell>
                <TableCell>Con novedad</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Grupo>

        <Grupo titulo="Progress, Separator, Skeleton y ScrollArea">
          <Progress value={60} className="w-64" />
          <Separator className="w-64" />
          <Skeleton className="h-8 w-40" />
          <ScrollArea className="h-24 w-64 rounded-lg border border-border p-2">
            {Array.from({ length: 12 }, (_, i) => (
              <p key={i} className="text-sm">
                Fila {i + 1}
              </p>
            ))}
          </ScrollArea>
        </Grupo>

        <Grupo titulo="Dialog, Sheet, Popover, Tooltip y DropdownMenu">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Publicar</DialogTitle>
                <DialogDescription>Lo que aplicaste pasa a tu link.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Menú</SheetTitle>
                <SheetDescription>Cajón del teléfono.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
            <PopoverContent>
              <PopoverHeader>
                <PopoverTitle>Link del Negocio</PopoverTitle>
                <PopoverDescription>Cópialo y compártelo con tus clientes.</PopoverDescription>
              </PopoverHeader>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>Tooltip</TooltipTrigger>
            <TooltipContent>Una ayuda breve</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Más" />}>
              <DotsThreeIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Caso</DropdownMenuLabel>
              <DropdownMenuItem>Enviar</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Descartar</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Grupo>

        <Grupo titulo="Command">
          <Command className="w-80 rounded-lg border border-border">
            <CommandInput placeholder="Buscar una sección" />
            <CommandList>
              <CommandEmpty>Nada por ahora.</CommandEmpty>
              <CommandGroup heading="Secciones">
                <CommandItem>
                  Pedidos <CommandShortcut>P</CommandShortcut>
                </CommandItem>
                <CommandItem>Clientes</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </Grupo>

        <Grupo titulo="Sidebar">
          <div className="relative h-72 w-full overflow-hidden rounded-lg border border-border [transform:translateZ(0)]">
            <SidebarProvider className="min-h-0">
              <Sidebar collapsible="none" className="h-72">
                <SidebarContent>
                  <SidebarGroup>
                    <SidebarGroupLabel>Tus secciones</SidebarGroupLabel>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive>Inicio</SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton>Pedidos</SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroup>
                </SidebarContent>
              </Sidebar>
              <div className="p-3">
                <SidebarTrigger />
              </div>
            </SidebarProvider>
          </div>
        </Grupo>
      </main>
    </TooltipProvider>
  )
}
