/**
 * El validador del SQL acotado, sobre el AST real de Postgres (`libpg-query` 18.1.5). Único importador de
 * `libpg-query` (eslint). En Next necesita `serverExternalPackages`: empaquetado, el WASM no carga.
 *
 * Revisa lo que importa para la seguridad (la sentencia, cada nodo y cada campo de cada nodo, las funciones, las
 * fuentes, los esquemas, los nombres de columna, las zonas y los desplazamientos) con una fila por tipo de nodo en
 * `NODOS`: lo que no tiene fila se rechaza, y un campo que la fila no nombra también. No resuelve alcances: un nombre
 * que no es campo del catálogo ni columna definida en la propia consulta es `dato_inexistente` antes de correr; lo
 * demás lo resuelve Postgres, y su 42703 vuelve como `dato_inexistente` desde `ejecutar`.
 */
import { loadModule, parseSync, type Node } from 'libpg-query'
import { COLUMNAS, esFuente, FUENTES, NOMBRES_DE_FUENTE } from './catalogo'
import type { ConsultaValidada, ErrorDeConsulta, NombreDeFuente, TipoDeSalida, Usa } from './tipos'

export type TipoDeNodo =
  | 'SelectStmt' | 'WithClause' | 'CommonTableExpr' | 'ResTarget' | 'RangeVar' | 'RangeSubselect' | 'RangeFunction' | 'JoinExpr' | 'Alias'
  | 'ColumnRef' | 'A_Star' | 'A_Const' | 'String' | 'Integer' | 'Float' | 'Boolean' | 'A_Expr' | 'BoolExpr' | 'NullTest' | 'BooleanTest'
  | 'FuncCall' | 'TypeCast' | 'TypeName' | 'CaseExpr' | 'CaseWhen' | 'CoalesceExpr' | 'MinMaxExpr' | 'SubLink' | 'SortBy' | 'WindowDef' | 'List'

/** El cuerpo de un nodo `{ [T]: cuerpo }` de `@pgsql/types`. */
export type NodoDe<T extends TipoDeNodo> = Extract<Node, Record<T, unknown>>[T]

/** Cómo viene un campo: un nodo envuelto (`{ ColumnRef: … }`) o lista de ellos, un dato suelto, o el cuerpo sin envolver de un tipo. */
type Hijo = 'nodo' | 'valor' | TipoDeNodo

type Contexto = {
  /** Cada nombre en FROM, con su alias, a su fuente del catálogo; `null` si no es una fuente (una CTE propia) o es ambiguo. */
  readonly fuentes: Map<string, NombreDeFuente | null>
  /** Solo `RangeVar.relname`, lo que de verdad se lee: un alias no vuelve válida una relación. Cada una es una fuente o una CTE. */
  readonly relaciones: Set<string>
  readonly ctes: Set<string>
  /** Lo que, sin calificar, es una fila entera: relaciones, alias de tabla, de subconsulta y de JOIN, y CTE. */
  readonly filas: Set<string>
  /** Las columnas que la consulta define: alias de salida, `colnames`, `aliascolnames` y el alias de una función en FROM. */
  readonly nombres: Set<string>
  readonly columnas: { readonly calificador: string | null; readonly nombre: string }[]
}

/** La fila de un tipo de nodo: los únicos campos que puede traer (además de `location`) y lo propio del nodo. */
export type Revisor<T extends TipoDeNodo> = {
  readonly campos: { readonly [K in Exclude<keyof NodoDe<T>, 'location'>]?: Hijo }
  readonly revisar?: (n: NodoDe<T>, c: Contexto) => void
}

class Rechazo extends Error {
  constructor(readonly error: ErrorDeConsulta) {
    super(error.tipo)
  }
}
const rechazar = (error: ErrorDeConsulta): never => {
  throw new Rechazo(error)
}

export const FUNCIONES = {
  count: 'agregado', sum: 'agregado', avg: 'agregado', min: 'agregado', max: 'agregado', bool_and: 'agregado', bool_or: 'agregado',
  percentile_cont: 'agregado', percentile_disc: 'agregado', string_agg: 'agregado', stddev: 'agregado', variance: 'agregado',
  row_number: 'ventana', rank: 'ventana', dense_rank: 'ventana', ntile: 'ventana', lag: 'ventana', lead: 'ventana', first_value: 'ventana', last_value: 'ventana',
  cume_dist: 'ventana', percent_rank: 'ventana',
  round: 'escalar', floor: 'escalar', ceil: 'escalar', ceiling: 'escalar', abs: 'escalar', trunc: 'escalar', sign: 'escalar', mod: 'escalar', power: 'escalar', sqrt: 'escalar',
  date_trunc: 'escalar', date_part: 'escalar', extract: 'escalar', to_char: 'escalar', to_date: 'escalar', make_date: 'escalar',
  lower: 'escalar', upper: 'escalar', btrim: 'escalar', ltrim: 'escalar', rtrim: 'escalar', length: 'escalar', char_length: 'escalar', substr: 'escalar', substring: 'escalar',
  position: 'escalar', concat: 'escalar', replace: 'escalar', split_part: 'escalar', left: 'escalar', right: 'escalar', initcap: 'escalar',
  generate_series: 'genera_filas',
} as const satisfies Record<string, 'agregado' | 'ventana' | 'escalar' | 'genera_filas'>

const TIPOS_DE_CONVERSION = ['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'text', 'varchar', 'bpchar', 'bool', 'date', 'timestamp', 'timestamptz', 'interval']
const OPERADORES = ['=', '<>', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '||', '~~', '~~*', '!~~', '!~~*', 'BETWEEN', 'NOT BETWEEN']
const CLASES_DE_A_EXPR = ['AEXPR_OP', 'AEXPR_OP_ANY', 'AEXPR_OP_ALL', 'AEXPR_DISTINCT', 'AEXPR_NOT_DISTINCT', 'AEXPR_NULLIF', 'AEXPR_IN', 'AEXPR_LIKE', 'AEXPR_ILIKE', 'AEXPR_BETWEEN', 'AEXPR_NOT_BETWEEN']
const SUBCONSULTAS = ['EXISTS_SUBLINK', 'ANY_SUBLINK', 'ALL_SUBLINK', 'EXPR_SUBLINK']

/** Lo que sí se permite, en palabras, para el error de un nodo sin fila. */
export const QUE_SI_SE_PERMITE = ['un solo SELECT', 'WITH (sin RECURSIVE)', 'JOIN', 'subconsultas', 'CASE', 'COALESCE', 'GROUP BY', 'ventanas', 'ORDER BY', 'LIMIT'] as const

/** Nodos sin fila que el modelo sí intenta: se rechazan igual, con una pista que dice qué usar. */
const PISTAS: Partial<Record<string, string>> = {
  VariableSetStmt: 'SET y RESET: el Negocio, la zona y el rol ya vienen puestos',
  VariableShowStmt: 'SHOW',
  SQLValueFunction: 'CURRENT_DATE y sus parientes: para hoy usa hoy.hoy_local y para este momento hoy.ahora',
  InsertStmt: 'INSERT: solo se lee',
  UpdateStmt: 'UPDATE: solo se lee',
  DeleteStmt: 'DELETE: solo se lee',
  MergeStmt: 'MERGE: solo se lee',
  ParamRef: 'parámetros ($1): el Negocio ya viene puesto',
}
const PISTA_DE_FUNCION: Partial<Record<string, string>> = {
  now: 'usa hoy.ahora',
  current_date: 'usa hoy.hoy_local',
  clock_timestamp: 'usa hoy.ahora',
  statement_timestamp: 'usa hoy.ahora',
  transaction_timestamp: 'usa hoy.ahora',
  set_config: 'el Negocio ya viene puesto',
  current_setting: 'el Negocio ya viene puesto',
  age: 'resta fechas con hoy.hoy_local',
}

/** Los campos que son un instante: sumarles horas es definir otra zona. `ahora` sí se desplaza: "las últimas 24 horas". */
const INSTANTES = new Set(
  NOMBRES_DE_FUENTE.flatMap((f) =>
    Object.entries(FUENTES[f].campos as Record<string, { readonly tipo: string }>)
      .filter(([nombre, campo]) => campo.tipo === 'instante' && nombre !== 'ahora')
      .map(([nombre]) => nombre),
  ),
)

const DEL_CATALOGO_DE_POSTGRES = /^pg_/i

const CAMPOS_DEL_CATALOGO = new Set(NOMBRES_DE_FUENTE.flatMap((f) => COLUMNAS[f]))

const textos = (lista: readonly Node[] | undefined): string[] =>
  (lista ?? []).map((n) => ('String' in n ? (n.String.sval ?? '') : rechazar({ tipo: 'no_permitido', que: 'un nombre que no es texto', permitidas: [] })))

/** `pg_catalog.extract` lo escribe el parser para `EXTRACT(… FROM …)`: ese esquema sí, y solo para lo de la lista. */
function nombreSimple(partes: readonly Node[] | undefined, que: string): string {
  const nombres = textos(partes)
  if (nombres.length > 2 || (nombres.length === 2 && nombres[0] !== 'pg_catalog')) rechazar({ tipo: 'no_permitido', que: `${que} con esquema (${nombres.join('.')})`, permitidas: [] })
  return nombres.at(-1) ?? ''
}

/** `armarLote` repite estos nombres en su `ORDER BY`: con comillas adentro se saldrían de lo validado. */
const NOMBRE_DE_COLUMNA = /^[a-z_][a-z0-9_]*$/

function nombreDeColumna(nombre: string): string {
  if (!NOMBRE_DE_COLUMNA.test(nombre)) rechazar({ tipo: 'no_permitido', que: `la columna ${JSON.stringify(nombre.slice(0, 40))}`, permitidas: ['nombres en minúscula, con letras sin tilde, números y _'] })
  return nombre
}

const esIntervalo = (n: Node | undefined) => n !== undefined && 'TypeCast' in n && textos(n.TypeCast.typeName?.names).at(-1) === 'interval'

/** Las columnas de un subárbol, sin resolverlas. */
function columnasDe(n: unknown): string[] {
  if (Array.isArray(n)) return n.flatMap(columnasDe)
  if (!n || typeof n !== 'object') return []
  if ('ColumnRef' in n) return textos(((n as { ColumnRef: NodoDe<'ColumnRef'> }).ColumnRef.fields ?? []).filter((f) => 'String' in f)).slice(-1)
  return Object.values(n).flatMap(columnasDe)
}

/** Un `*` o un `p.*` en una columna de salida. Lo de adentro de una subconsulta tiene su propia salida. */
function traeEstrella(n: unknown): boolean {
  if (Array.isArray(n)) return n.some(traeEstrella)
  if (!n || typeof n !== 'object' || 'SelectStmt' in n) return false
  if ('ColumnRef' in n && ((n as { ColumnRef: NodoDe<'ColumnRef'> }).ColumnRef.fields ?? []).some((f) => 'A_Star' in f)) return true
  return Object.values(n).some(traeEstrella)
}

/** Una columna de salida depende de un dato: una columna o un `count(*)`, también dentro de una subconsulta. */
function dependeDeDatos(n: unknown): boolean {
  if (Array.isArray(n)) return n.some(dependeDeDatos)
  if (!n || typeof n !== 'object') return false
  if ('ColumnRef' in n) return true
  if ('FuncCall' in n && (n as { FuncCall: NodoDe<'FuncCall'> }).FuncCall.agg_star) return true
  return Object.values(n).some(dependeDeDatos)
}

export const NODOS: { readonly [T in TipoDeNodo]: Revisor<T> } = {
  SelectStmt: {
    campos: {
      distinctClause: 'nodo', targetList: 'nodo', fromClause: 'nodo', whereClause: 'nodo', groupClause: 'nodo', groupDistinct: 'valor', havingClause: 'nodo',
      windowClause: 'nodo', valuesLists: 'nodo', sortClause: 'nodo', limitOffset: 'nodo', limitCount: 'nodo', limitOption: 'valor', withClause: 'WithClause',
      op: 'valor', all: 'valor', larg: 'SelectStmt', rarg: 'SelectStmt',
    },
  },
  WithClause: {
    campos: { ctes: 'nodo', recursive: 'valor' },
    revisar: (n) => {
      if (n.recursive) rechazar({ tipo: 'no_permitido', que: 'WITH RECURSIVE', permitidas: ['WITH'] })
    },
  },
  CommonTableExpr: {
    campos: { ctename: 'valor', aliascolnames: 'nodo', ctematerialized: 'valor', ctequery: 'nodo' },
    revisar: (n, c) => {
      if (n.ctename && esFuente(n.ctename)) rechazar({ tipo: 'no_permitido', que: `una CTE llamada ${n.ctename}, como una fuente`, permitidas: [] })
      if (n.ctename && DEL_CATALOGO_DE_POSTGRES.test(n.ctename)) rechazar({ tipo: 'no_permitido', que: `una CTE llamada ${n.ctename}: pg_ es del catálogo de Postgres`, permitidas: [] })
      if (n.ctename) {
        c.ctes.add(n.ctename)
        c.filas.add(n.ctename)
      }
      for (const a of textos(n.aliascolnames)) c.nombres.add(nombreDeColumna(a))
    },
  },
  RangeVar: {
    campos: { catalogname: 'valor', schemaname: 'valor', relname: 'valor', inh: 'valor', relpersistence: 'valor', alias: 'Alias' },
    revisar: (n, c) => {
      if (n.schemaname || n.catalogname) rechazar({ tipo: 'no_permitido', que: `${[n.catalogname, n.schemaname, n.relname].filter(Boolean).join('.')}: las fuentes van sin esquema`, permitidas: [...NOMBRES_DE_FUENTE] })
      const nombre = n.relname ?? ''
      if (DEL_CATALOGO_DE_POSTGRES.test(nombre)) rechazar({ tipo: 'no_permitido', que: `${nombre}: el catálogo de Postgres no es una fuente`, permitidas: [...NOMBRES_DE_FUENTE] })
      c.relaciones.add(nombre)
      c.filas.add(nombre)
      if (n.alias?.aliasname) c.filas.add(n.alias.aliasname)
      const fuente = esFuente(nombre) ? nombre : null
      for (const visto of new Set([nombre, n.alias?.aliasname ?? nombre])) c.fuentes.set(visto, c.fuentes.has(visto) && c.fuentes.get(visto) !== fuente ? null : fuente)
    },
  },
  RangeSubselect: {
    campos: { lateral: 'valor', subquery: 'nodo', alias: 'Alias' },
    revisar: (n, c) => {
      if (n.alias?.aliasname) c.filas.add(n.alias.aliasname)
    },
  },
  RangeFunction: {
    campos: { lateral: 'valor', ordinality: 'valor', functions: 'nodo', alias: 'Alias' },
    revisar: (n, c) => {
      const [lista] = n.functions ?? []
      const [llamada] = lista && 'List' in lista ? (lista.List.items ?? []) : []
      const nombre = llamada && 'FuncCall' in llamada ? nombreSimple(llamada.FuncCall.funcname, 'una función en FROM') : ''
      const genera = Object.hasOwn(FUNCIONES, nombre) && FUNCIONES[nombre as keyof typeof FUNCIONES] === 'genera_filas'
      if ((n.functions?.length ?? 0) !== 1 || !genera) rechazar({ tipo: 'no_permitido', que: `${nombre || 'una función'} en FROM`, permitidas: ['generate_series'] })
      // `generate_series(0, 29) AS s`: `s` es la columna, no una fila.
      if (n.alias?.aliasname) c.nombres.add(nombreDeColumna(n.alias.aliasname))
    },
  },
  JoinExpr: {
    campos: { jointype: 'valor', isNatural: 'valor', larg: 'nodo', rarg: 'nodo', usingClause: 'nodo', quals: 'nodo', alias: 'Alias', join_using_alias: 'Alias', rtindex: 'valor' },
    revisar: (n, c) => {
      if (n.alias?.aliasname) c.filas.add(n.alias.aliasname)
    },
  },
  Alias: {
    campos: { aliasname: 'valor', colnames: 'nodo' },
    revisar: (n, c) => {
      for (const a of textos(n.colnames)) c.nombres.add(nombreDeColumna(a))
    },
  },
  ResTarget: {
    campos: { name: 'valor', val: 'nodo' },
    revisar: (n, c) => {
      if (n.name) c.nombres.add(nombreDeColumna(n.name))
    },
  },
  ColumnRef: {
    campos: { fields: 'nodo' },
    revisar: (n, c) => {
      const partes = (n.fields ?? []).map((f) => ('String' in f ? (f.String.sval ?? '') : 'A_Star' in f ? '*' : rechazar({ tipo: 'no_permitido', que: 'esa referencia a una columna', permitidas: [] })))
      if (partes.length > 2) rechazar({ tipo: 'no_permitido', que: `${partes.join('.')}: las columnas van sin esquema`, permitidas: [] })
      c.columnas.push({ calificador: partes.length === 2 ? partes[0] : null, nombre: partes.at(-1) ?? '' })
    },
  },
  A_Star: { campos: {} },
  A_Const: { campos: { ival: 'valor', fval: 'valor', boolval: 'valor', sval: 'valor', isnull: 'valor' } },
  String: { campos: { sval: 'valor' } },
  Integer: { campos: { ival: 'valor' } },
  Float: { campos: { fval: 'valor' } },
  Boolean: { campos: { boolval: 'valor' } },
  A_Expr: {
    campos: { kind: 'valor', name: 'nodo', lexpr: 'nodo', rexpr: 'nodo', rexpr_list_start: 'valor', rexpr_list_end: 'valor' },
    revisar: (n) => {
      const nombres = textos(n.name)
      const [op = ''] = nombres
      if (!CLASES_DE_A_EXPR.includes(n.kind ?? '') || nombres.length !== 1 || !OPERADORES.includes(op)) {
        rechazar({ tipo: 'no_permitido', que: `el operador ${nombres.join('.') || n.kind}`, permitidas: ['=', '<>', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '||', 'LIKE', 'ILIKE', 'IN', 'BETWEEN', 'IS DISTINCT FROM'] })
      }
      if ((op === '+' || op === '-') && (esIntervalo(n.lexpr) || esIntervalo(n.rexpr))) {
        const instante = columnasDe(esIntervalo(n.lexpr) ? n.rexpr : n.lexpr).find((col) => INSTANTES.has(col))
        if (instante) rechazar({ tipo: 'definicion_del_nucleo', que: 'desplazamiento', fragmento: `un intervalo sumado o restado a ${instante}` })
      }
    },
  },
  BoolExpr: { campos: { boolop: 'valor', args: 'nodo' } },
  NullTest: { campos: { arg: 'nodo', nulltesttype: 'valor', argisrow: 'valor' } },
  BooleanTest: { campos: { arg: 'nodo', booltesttype: 'valor' } },
  FuncCall: {
    campos: { funcname: 'nodo', args: 'nodo', agg_order: 'nodo', agg_filter: 'nodo', over: 'WindowDef', agg_within_group: 'valor', agg_star: 'valor', agg_distinct: 'valor', func_variadic: 'valor', funcformat: 'valor' },
    revisar: (n) => {
      const nombre = nombreSimple(n.funcname, 'una función')
      if (nombre === 'timezone') rechazar({ tipo: 'definicion_del_nucleo', que: 'zona_horaria', fragmento: 'AT TIME ZONE' })
      if (nombre === 'date_trunc' && (n.args?.length ?? 0) > 2) rechazar({ tipo: 'definicion_del_nucleo', que: 'zona_horaria', fragmento: 'date_trunc con zona' })
      if (!Object.hasOwn(FUNCIONES, nombre)) {
        const pista = PISTA_DE_FUNCION[nombre]
        rechazar({ tipo: 'no_permitido', que: `${nombre}()${pista ? `: ${pista}` : ''}`, permitidas: Object.keys(FUNCIONES) })
      }
    },
  },
  TypeCast: { campos: { arg: 'nodo', typeName: 'TypeName' } },
  TypeName: {
    campos: { names: 'nodo', typmods: 'nodo', typemod: 'valor' },
    revisar: (n) => {
      const nombres = textos(n.names)
      const tipo = nombres.at(-1) ?? ''
      if (nombres.length > 2 || (nombres.length === 2 && nombres[0] !== 'pg_catalog') || !TIPOS_DE_CONVERSION.includes(tipo)) {
        rechazar({ tipo: 'no_permitido', que: `convertir a ${nombres.join('.')}`, permitidas: TIPOS_DE_CONVERSION })
      }
    },
  },
  CaseExpr: { campos: { arg: 'nodo', args: 'nodo', defresult: 'nodo' } },
  CaseWhen: { campos: { expr: 'nodo', result: 'nodo' } },
  CoalesceExpr: { campos: { args: 'nodo' } },
  MinMaxExpr: { campos: { op: 'valor', args: 'nodo' } },
  SubLink: {
    campos: { subLinkType: 'valor', testexpr: 'nodo', operName: 'nodo', subselect: 'nodo' },
    revisar: (n) => {
      if (!SUBCONSULTAS.includes(n.subLinkType ?? '')) rechazar({ tipo: 'no_permitido', que: `la subconsulta ${n.subLinkType}`, permitidas: ['EXISTS', 'IN', 'ANY', 'ALL', '(SELECT …)'] })
      for (const op of textos(n.operName)) if (!OPERADORES.includes(op)) rechazar({ tipo: 'no_permitido', que: `el operador ${op}`, permitidas: OPERADORES })
    },
  },
  SortBy: { campos: { node: 'nodo', sortby_dir: 'valor', sortby_nulls: 'valor' } },
  WindowDef: { campos: { name: 'valor', refname: 'valor', partitionClause: 'nodo', orderClause: 'nodo', frameOptions: 'valor', startOffset: 'nodo', endOffset: 'nodo' } },
  List: { campos: { items: 'nodo' } },
}

const esTipoDeNodo = (t: string): t is TipoDeNodo => Object.hasOwn(NODOS, t)
const vacio = (v: unknown) => v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0)

function recorrer(valor: unknown, como: Hijo, c: Contexto): void {
  if (valor === undefined || valor === null || como === 'valor') return
  if (Array.isArray(valor)) return valor.forEach((v) => recorrer(v, como, c))
  if (typeof valor !== 'object') return rechazar({ tipo: 'no_permitido', que: `un ${typeof valor} donde va un nodo`, permitidas: [] })
  if (como !== 'nodo') return revisarNodo(como, valor, c)
  const claves = Object.keys(valor)
  // `SELECT DISTINCT` trae `distinctClause: [{}]`.
  if (claves.length === 0) return
  if (claves.length !== 1) return rechazar({ tipo: 'no_permitido', que: 'un nodo que no se reconoce', permitidas: [...QUE_SI_SE_PERMITE] })
  revisarNodo(claves[0], (valor as Record<string, unknown>)[claves[0]], c)
}

function revisarNodo(tipo: string, cuerpo: unknown, c: Contexto): void {
  if (!esTipoDeNodo(tipo)) return rechazar({ tipo: 'no_permitido', que: PISTAS[tipo] ?? `la construcción ${tipo}`, permitidas: [...QUE_SI_SE_PERMITE] })
  const fila = NODOS[tipo] as Revisor<TipoDeNodo>
  const campos = fila.campos as Record<string, Hijo | undefined>
  fila.revisar?.(cuerpo as never, c)
  for (const [campo, v] of Object.entries(cuerpo as Record<string, unknown>)) {
    if (campo === 'location') continue
    const hijo = campos[campo]
    if (hijo) recorrer(v, hijo, c)
    else if (!vacio(v)) rechazar({ tipo: 'no_permitido', que: `${campo} en ${tipo}`, permitidas: [...QUE_SI_SE_PERMITE] })
  }
}

const FORMAS = {
  numero: (cols: readonly string[]) => cols.length === 1 && cols[0] === 'valor',
  serie: (cols: readonly string[]) => cols.length === 2 && cols.includes('etiqueta') && cols.includes('valor'),
  filas: (cols: readonly string[]) => cols.length > 0 && new Set(cols).size === cols.length,
} as const satisfies Record<TipoDeSalida, (cols: readonly string[]) => boolean>

let cargado: Promise<void> | null = null

/**
 * Pura salvo la carga del WASM, una vez por proceso. Un solo `SelectStmt`; cada nodo con su fila en `NODOS`; cada
 * fuente del catálogo o una CTE propia; cada columna un campo del catálogo o un nombre de la consulta; cada columna
 * de salida depende de un dato; la salida tiene la forma pedida. El `ORDER BY` de arriba vuelve como `orden` cuando
 * nombra columnas de salida; si ordena por otra cosa, el orden de la consulta se conserva adentro.
 */
export async function validarConsulta(sqlDelRedactor: string, salida: TipoDeSalida): Promise<ConsultaValidada | ErrorDeConsulta> {
  await (cargado ??= loadModule())
  const sql = sqlDelRedactor.trim().replace(/;+\s*$/, '')
  let arbol
  try {
    arbol = parseSync(sql)
  } catch (e) {
    return { tipo: 'sintaxis', mensaje: (e instanceof Error ? e.message : String(e)).slice(0, 200) }
  }
  try {
    const sentencias = arbol.stmts ?? []
    if (sentencias.length !== 1) rechazar({ tipo: 'no_permitido', que: 'más de una sentencia', permitidas: ['un solo SELECT'] })
    const raiz = sentencias[0].stmt
    if (!raiz || !('SelectStmt' in raiz)) {
      const tipo = raiz ? Object.keys(raiz)[0] : 'nada'
      return rechazar({ tipo: 'no_permitido', que: PISTAS[tipo] ?? `la sentencia ${tipo}`, permitidas: ['un solo SELECT'] })
    }
    const arriba = raiz.SelectStmt
    if (arriba.valuesLists?.length) rechazar({ tipo: 'no_permitido', que: 'VALUES como consulta', permitidas: ['un solo SELECT'] })

    const c: Contexto = { fuentes: new Map(), relaciones: new Set(), ctes: new Set(), filas: new Set(), nombres: new Set(), columnas: [] }
    recorrer(raiz, 'nodo', c)

    for (const nombre of c.relaciones) if (!esFuente(nombre) && !c.ctes.has(nombre)) rechazar({ tipo: 'dato_inexistente', fuente: nombre, campo: null, hay: [...NOMBRES_DE_FUENTE] })
    const usadas = [...new Set([...c.fuentes.values()].filter((f) => f !== null))]
    const usa = new Set<Usa>()
    for (const { calificador, nombre } of c.columnas) {
      if (nombre === '*') continue
      if (calificador === null && c.filas.has(nombre) && !c.nombres.has(nombre)) rechazar({ tipo: 'no_permitido', que: `una fila entera (${nombre})`, permitidas: ['sus columnas, una por una'] })
      const deFuente = calificador === null ? undefined : c.fuentes.get(calificador)
      const hay = deFuente ? COLUMNAS[deFuente] : usadas.flatMap((f) => COLUMNAS[f])
      const fuente = deFuente ?? (usadas.join(', ') || 'ninguna')
      if (deFuente && !COLUMNAS[deFuente].includes(nombre) && !c.nombres.has(nombre)) rechazar({ tipo: 'dato_inexistente', fuente, campo: nombre, hay })
      if (!CAMPOS_DEL_CATALOGO.has(nombre) && !c.nombres.has(nombre)) rechazar({ tipo: 'dato_inexistente', fuente, campo: nombre, hay })
      for (const f of deFuente ? [deFuente] : usadas) if (COLUMNAS[f].includes(nombre)) usa.add(`${f}.${nombre}`)
    }

    let izquierda = arriba
    while (izquierda.op && izquierda.op !== 'SETOP_NONE' && izquierda.larg) izquierda = izquierda.larg
    const objetivos = (izquierda.targetList ?? []).map((t) => ('ResTarget' in t ? t.ResTarget : rechazar({ tipo: 'no_permitido', que: 'esa columna de salida', permitidas: [] })))
    if (objetivos.some((t) => traeEstrella(t.val))) rechazar({ tipo: 'forma', esperada: salida, hay: ['*'] })
    const columnas = objetivos.map((t) => {
      const nombre = t.name ?? (t.val && 'ColumnRef' in t.val ? columnasDe(t.val)[0] : null)
      return nombreDeColumna(nombre ?? rechazar({ tipo: 'no_permitido', que: 'una columna calculada sin AS', permitidas: ['expresión AS nombre'] }))
    })
    // `to_jsonb(q)` del envoltorio resolvería a esa columna y no a la fila.
    if (columnas.includes('q')) rechazar({ tipo: 'no_permitido', que: 'q como nombre de columna', permitidas: [] })
    if (!FORMAS[salida](columnas)) rechazar({ tipo: 'forma', esperada: salida, hay: columnas })
    if (izquierda === arriba) objetivos.forEach((t, i) => {
      if (!dependeDeDatos(t.val)) rechazar({ tipo: 'sin_datos', columna: columnas[i] })
    })

    const orden = (arriba.sortClause ?? []).map((s) => {
      const por = 'SortBy' in s ? s.SortBy : null
      const [columna] = por?.node && 'ColumnRef' in por.node && (por.node.ColumnRef.fields?.length ?? 0) === 1 ? columnasDe(por.node) : []
      return columna && columnas.includes(columna) ? { columna, descendente: por?.sortby_dir === 'SORTBY_DESC' } : null
    })
    return { sql, fuentes: usadas.sort(), usa: [...usa].sort(), columnas, orden: orden.every((o) => o !== null) ? orden : [] } as unknown as ConsultaValidada
  } catch (e) {
    if (e instanceof Rechazo) return e.error
    throw e
  }
}

export const esErrorDeConsulta = (r: ConsultaValidada | ErrorDeConsulta): r is ErrorDeConsulta => 'tipo' in r

const ESPERADAS = { numero: 'una sola fila con una sola columna llamada valor', serie: 'dos columnas llamadas etiqueta y valor', filas: 'una o más columnas con nombres distintos y sin *' } as const satisfies Record<TipoDeSalida, string>

/** El texto que vuelve al redactor en el intento siguiente. Siempre dice qué sí se puede usar. */
export function explicar(e: ErrorDeConsulta): string {
  switch (e.tipo) {
    case 'sintaxis':
      return `Error de sintaxis de Postgres: ${e.mensaje}`
    case 'dato_inexistente':
      return e.campo === null
        ? `La fuente ${e.fuente} no existe. Fuentes: ${e.hay.join(', ')}.`
        : `${e.campo} no existe en ${e.fuente}. Campos: ${e.hay.join(', ')}. Si el dato no está en el catálogo, responde no_se_puede.`
    case 'no_permitido':
      return `No se permite ${e.que}.${e.permitidas.length ? ` Sí se permite: ${e.permitidas.join(', ')}.` : ''}`
    case 'forma':
      return `La salida tiene que ser ${ESPERADAS[e.esperada]}; la tuya da: ${e.hay.join(', ') || 'nada'}.`
    case 'sin_datos':
      return `La columna ${e.columna} no depende de ningún dato del Negocio. Si el dato no está en el catálogo, responde no_se_puede.`
    case 'definicion_del_nucleo':
      return e.que === 'zona_horaria'
        ? `No definas zonas horarias (${e.fragmento}): las fechas ya vienen en la zona del Negocio. Usa dia_local, mes_local u hora_local, y hoy.hoy_local.`
        : `No sumes ni restes horas a una columna (${e.fragmento}). Usa dia_local u hora_local; para las últimas N horas: creado > hoy.ahora - interval 'N hours'.`
    case 'postgres':
      return `Postgres la rechazó al correrla: ${e.mensaje}`
  }
}
