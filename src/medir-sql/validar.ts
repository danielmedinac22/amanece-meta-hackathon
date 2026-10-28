/**
 * Validador de SQL acotado sobre el AST real de Postgres (libpg_query en WASM). Throwaway.
 * Lista cerrada de nodos, de operadores, de funciones y de tipos. Cada columna se resuelve contra el catálogo
 * (alias, subconsultas, CTE propias, correlación). Todo lo que no está en la lista se rechaza.
 */
import { loadModule, parseSync } from 'libpg-query'
import { COLUMNAS_POR_FUENTE } from './catalogo'

export type ErrorDeConsulta =
  | { tipo: 'sintaxis'; mensaje: string }
  | { tipo: 'dato_inexistente'; fuente: string; campo: string | null; columnasDeLaFuente?: string[] }
  | { tipo: 'no_permitido'; que: string }
  | { tipo: 'forma'; mensaje: string }
  | { tipo: 'sin_datos'; columna: string }

export type Forma = { tipo: 'numero' } | { tipo: 'serie' } | { tipo: 'filas' }
export type Validada = { ok: true; sql: string; usa: string[]; columnas: string[] } | { ok: false; error: ErrorDeConsulta }

const FUNCIONES = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'bool_and', 'bool_or', 'string_agg', 'array_agg', 'stddev', 'variance',
  'percentile_cont', 'percentile_disc', 'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'cume_dist', 'percent_rank',
  'round', 'floor', 'ceil', 'ceiling', 'abs', 'trunc', 'sign', 'mod', 'power', 'sqrt', 'ln', 'log',
  'date_trunc', 'date_part', 'extract', 'to_char', 'to_date', 'make_date', 'age',
  'lower', 'upper', 'btrim', 'ltrim', 'rtrim', 'length', 'char_length', 'substr', 'substring', 'position', 'concat', 'replace', 'split_part', 'left', 'right', 'initcap', 'lpad', 'rpad',
  'generate_series',
])
const GENERA_FILAS = new Set(['generate_series'])
const OPERADORES = new Set(['=', '<>', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%', '||', '~~', '!~~', '~~*', '!~~*', '~', '~*', '!~', '!~*', 'BETWEEN', 'NOT BETWEEN', 'BETWEEN SYM', 'NOT BETWEEN SYM'])
const TIPOS = new Set(['int2', 'int4', 'int8', 'numeric', 'float4', 'float8', 'text', 'varchar', 'bpchar', 'bool', 'date', 'timestamp', 'timestamptz', 'interval', 'time'])
const SUBLINKS = new Set(['EXISTS_SUBLINK', 'ANY_SUBLINK', 'ALL_SUBLINK', 'EXPR_SUBLINK'])
const AEXPR = new Set(['AEXPR_OP', 'AEXPR_OP_ANY', 'AEXPR_OP_ALL', 'AEXPR_DISTINCT', 'AEXPR_NOT_DISTINCT', 'AEXPR_NULLIF', 'AEXPR_IN', 'AEXPR_LIKE', 'AEXPR_ILIKE', 'AEXPR_BETWEEN', 'AEXPR_NOT_BETWEEN', 'AEXPR_BETWEEN_SYM', 'AEXPR_NOT_BETWEEN_SYM'])

const PISTA_TIEMPO = 'No uses funciones de hora actual ni zonas horarias. Usa hoy.hoy_local para "hoy" y dia_local, mes_local y hora_local para las fechas.'

class Rechazo extends Error {
  constructor(public error: ErrorDeConsulta) {
    super(JSON.stringify(error))
  }
}
const no = (que: string): never => {
  throw new Rechazo({ tipo: 'no_permitido', que })
}

type Item = { alias: string; fuente: string; cols: string[] }
type Scope = { items: Item[]; padre: Scope | null }
type Entorno = { ctes: Map<string, string[]> }
type Nodo = Record<string, any>

const tipoDe = (n: Nodo): [string, any] => {
  const k = Object.keys(n)
  return [k[0], n[k[0]]]
}
const sval = (n: Nodo): string => (n?.String ? n.String.sval : no('nombre no soportado'))

export async function cargarParser() {
  await loadModule()
}

class Contexto {
  usa = new Set<string>()
}

function nombreDeSalida(val: Nodo): string {
  const [t, b] = tipoDe(val)
  if (t === 'ColumnRef') {
    const f = b.fields[b.fields.length - 1]
    return f.String ? f.String.sval : '?column?'
  }
  if (t === 'FuncCall') return sval(b.funcname[b.funcname.length - 1])
  if (t === 'TypeCast') return nombreDeSalida(b.arg)
  if (t === 'CaseExpr') return 'case'
  if (t === 'CoalesceExpr') return 'coalesce'
  if (t === 'SubLink' && b.subLinkType === 'EXPR_SUBLINK') {
    const sel = b.subselect?.SelectStmt
    const t0 = sel?.targetList?.[0]?.ResTarget
    return t0 ? (t0.name ?? nombreDeSalida(t0.val)) : '?column?'
  }
  return '?column?'
}

function dependeDeDatos(n: unknown): boolean {
  if (Array.isArray(n)) return n.some(dependeDeDatos)
  if (n && typeof n === 'object') {
    for (const [k, v] of Object.entries(n as Nodo)) {
      if (k === 'ColumnRef' || k === 'A_Star' || k === 'SubLink') return true
      if (k === 'agg_star' && v === true) return true
      if (dependeDeDatos(v)) return true
    }
  }
  return false
}

function buscar(scope: Scope | null, alias: string): Item | null {
  for (let s = scope; s; s = s.padre) {
    const it = s.items.find((i) => i.alias === alias)
    if (it) return it
  }
  return null
}

function resolver(ref: Nodo, scope: Scope, salidas: string[] | null, ctx: Contexto) {
  const campos = (ref.fields as Nodo[]).map((f) => (f.String ? (f.String.sval as string) : f.A_Star ? '*' : no('referencia de columna no soportada')))
  if (campos.length > 2) no('nombres con esquema o base (esquema.tabla.columna)')
  if (campos.length === 2) {
    const [q, c] = campos
    const it = buscar(scope, q)
    if (!it) throw new Rechazo({ tipo: 'dato_inexistente', fuente: q, campo: null })
    if (c !== '*' && !it.cols.includes(c)) throw new Rechazo({ tipo: 'dato_inexistente', fuente: it.fuente, campo: c, columnasDeLaFuente: it.cols })
    if (c !== '*') ctx.usa.add(`${it.fuente}.${c}`)
    return
  }
  const c = campos[0]
  if (c === '*') return
  for (let s: Scope | null = scope; s; s = s.padre) {
    const hay = s.items.filter((i) => i.cols.includes(c))
    if (hay.length) {
      ctx.usa.add(`${hay[0].fuente}.${c}`)
      return
    }
  }
  if (salidas?.includes(c)) return
  if (buscar(scope, c)) return
  const fuentes = scope.items.map((i) => i.fuente)
  throw new Rechazo({ tipo: 'dato_inexistente', fuente: fuentes.join(', ') || '(ninguna)', campo: c, columnasDeLaFuente: scope.items.length === 1 ? scope.items[0].cols : undefined })
}

function nombreDeFuncion(fc: Nodo): string {
  const nombres = (fc.funcname as Nodo[]).map(sval)
  if (nombres.length > 2 || (nombres.length === 2 && nombres[0] !== 'pg_catalog')) no(`función con esquema (${nombres.join('.')})`)
  return nombres[nombres.length - 1]
}

function expr(n: Nodo | null | undefined, scope: Scope, env: Entorno, ctx: Contexto, salidas: string[] | null = null): void {
  if (!n) return
  const [t, b] = tipoDe(n)
  const e = (x: Nodo | null | undefined) => expr(x, scope, env, ctx, salidas)
  switch (t) {
    case 'ColumnRef':
      return resolver(b, scope, salidas, ctx)
    case 'A_Const':
      return
    case 'A_Expr': {
      if (!AEXPR.has(b.kind)) no(`operador ${b.kind}`)
      const nombres = (b.name as Nodo[]).map(sval)
      if (nombres.length > 1 && !(nombres.length === 2 && nombres[0] === 'pg_catalog')) no(`operador con esquema (${nombres.join('.')})`)
      const op = nombres[nombres.length - 1]
      if (!OPERADORES.has(op)) no(`operador ${op}`)
      e(b.lexpr)
      e(b.rexpr)
      return
    }
    case 'List':
      for (const x of b.items ?? []) e(x)
      return
    case 'BoolExpr':
      for (const x of b.args) e(x)
      return
    case 'NullTest':
    case 'BooleanTest':
      return e(b.arg)
    case 'FuncCall': {
      const nombre = nombreDeFuncion(b)
      if (!FUNCIONES.has(nombre)) {
        const tiempo = /^(now|clock_timestamp|statement_timestamp|transaction_timestamp|timezone|timeofday|current_(date|time|timestamp)|localtime.*)$/.test(nombre)
        no(tiempo ? `la función ${nombre}(). ${PISTA_TIEMPO}` : `la función ${nombre}() no está en la lista permitida. Funciones permitidas: ${[...FUNCIONES].join(', ')}`)
      }
      for (const x of b.args ?? []) e(x)
      if (b.agg_filter) e(b.agg_filter)
      for (const x of b.agg_order ?? []) expr(x, scope, env, ctx, salidas)
      if (b.over) ventana(b.over.WindowDef ?? b.over, scope, env, ctx)
      return
    }
    case 'SortBy':
      return e(b.node)
    case 'CaseExpr':
      e(b.arg)
      for (const w of b.args) {
        const cw = w.CaseWhen
        e(cw.expr)
        e(cw.result)
      }
      return e(b.defresult)
    case 'CoalesceExpr':
      for (const x of b.args) e(x)
      return
    case 'MinMaxExpr':
      for (const x of b.args) e(x)
      return
    case 'TypeCast': {
      const nombres = (b.typeName.names as Nodo[]).map(sval)
      if (b.typeName.arrayBounds || b.typeName.setof) no('tipos de arreglo')
      if (nombres.length > 2 || (nombres.length === 2 && nombres[0] !== 'pg_catalog')) no(`tipo con esquema (${nombres.join('.')})`)
      if (!TIPOS.has(nombres[nombres.length - 1])) no(`conversión a ${nombres.join('.')}`)
      return e(b.arg)
    }
    case 'A_ArrayExpr':
      for (const x of b.elements ?? []) e(x)
      return
    case 'RowExpr':
      for (const x of b.args ?? []) e(x)
      return
    case 'SubLink': {
      if (!SUBLINKS.has(b.subLinkType)) no(`subconsulta ${b.subLinkType}`)
      e(b.testexpr)
      if (b.operName) for (const o of b.operName) if (!OPERADORES.has(sval(o))) no(`operador ${sval(o)}`)
      analizarSelect(b.subselect, scope, env, ctx)
      return
    }
    case 'ParamRef':
      return no('parámetros ($n)')
    case 'SQLValueFunction':
      return no(`${String(b.op).replace('SVFOP_', '').toLowerCase()}. ${PISTA_TIEMPO}`)
    default:
      return no(`la construcción ${t}`)
  }
}

function ventana(w: Nodo, scope: Scope, env: Entorno, ctx: Contexto) {
  for (const p of w.partitionClause ?? []) expr(p, scope, env, ctx)
  for (const o of w.orderClause ?? []) expr(o, scope, env, ctx)
  if (w.startOffset || w.endOffset) {
    expr(w.startOffset, scope, env, ctx)
    expr(w.endOffset, scope, env, ctx)
  }
}

type Analisis = { cols: string[]; targets: { name: string; val: Nodo | null }[] }

function analizarSelect(nodo: Nodo, padre: Scope | null, env: Entorno, ctx: Contexto): Analisis {
  const [t, s] = tipoDe(nodo)
  if (t !== 'SelectStmt') return no(t === 'InsertStmt' || t === 'UpdateStmt' || t === 'DeleteStmt' || t === 'MergeStmt' ? 'escritura de datos (INSERT, UPDATE, DELETE)' : `la sentencia ${t}`)
  if (s.intoClause) no('SELECT INTO')
  if (s.lockingClause) no('FOR UPDATE / FOR SHARE')
  if (s.valuesLists) {
    const filas = s.valuesLists as Nodo[]
    for (const f of filas) for (const x of f.List.items) expr(x, { items: [], padre }, env, ctx)
    return { cols: filas[0].List.items.map((_: unknown, i: number) => `column${i + 1}`), targets: [] }
  }
  let entorno = env
  if (s.withClause) {
    if (s.withClause.recursive) no('WITH RECURSIVE')
    entorno = { ctes: new Map(env.ctes) }
    for (const c of s.withClause.ctes) {
      const cte = c.CommonTableExpr
      if (cte.ctename in COLUMNAS_POR_FUENTE) no(`una CTE no puede llamarse ${cte.ctename}, como una fuente del catálogo`)
      const a = analizarSelect(cte.ctequery, null, entorno, ctx)
      const cols = cte.aliascolnames ? (cte.aliascolnames as Nodo[]).map(sval) : a.cols
      entorno.ctes.set(cte.ctename, cols)
    }
  }
  if (s.op && s.op !== 'SETOP_NONE') {
    const l = analizarSelect({ SelectStmt: s.larg }, padre, entorno, ctx)
    analizarSelect({ SelectStmt: s.rarg }, padre, entorno, ctx)
    const scope: Scope = { items: [{ alias: '', fuente: '(unión)', cols: l.cols }], padre }
    for (const o of s.sortClause ?? []) expr(o, scope, entorno, ctx, l.cols)
    expr(s.limitCount, { items: [], padre }, entorno, ctx)
    expr(s.limitOffset, { items: [], padre }, entorno, ctx)
    return l
  }

  const scope: Scope = { items: [], padre }
  const desde = (f: Nodo) => {
    const [tf, b] = tipoDe(f)
    if (tf === 'RangeVar') {
      if (b.schemaname || b.catalogname) no(`nombres con esquema (${b.schemaname}.${b.relname})`)
      const cols = entorno.ctes.get(b.relname) ?? COLUMNAS_POR_FUENTE[b.relname]
      if (!cols) throw new Rechazo({ tipo: 'dato_inexistente', fuente: b.relname, campo: null })
      const alias = b.alias?.aliasname ?? b.relname
      const renombradas = b.alias?.colnames ? (b.alias.colnames as Nodo[]).map(sval) : cols
      scope.items.push({ alias, fuente: b.relname, cols: renombradas.concat(cols.slice(renombradas.length)) })
    } else if (tf === 'RangeSubselect') {
      const a = analizarSelect(b.subquery, b.lateral ? scope : padre, entorno, ctx)
      const alias = b.alias?.aliasname
      if (!alias) no('una subconsulta en FROM sin alias')
      const renombradas = b.alias?.colnames ? (b.alias.colnames as Nodo[]).map(sval) : []
      scope.items.push({ alias, fuente: `(subconsulta ${alias})`, cols: renombradas.concat(a.cols.slice(renombradas.length)) })
    } else if (tf === 'RangeFunction') {
      const fns = b.functions as Nodo[]
      if (fns.length !== 1) no('varias funciones en FROM')
      const fc = fns[0].List.items[0].FuncCall
      const nombre = nombreDeFuncion(fc)
      if (!GENERA_FILAS.has(nombre)) no(`la función ${nombre}() en FROM`)
      for (const x of fc.args ?? []) expr(x, scope, entorno, ctx)
      const alias = b.alias?.aliasname ?? nombre
      const col = b.alias?.colnames ? sval(b.alias.colnames[0]) : (b.alias?.aliasname ?? nombre)
      scope.items.push({ alias, fuente: nombre, cols: b.ordinality ? [col, 'ordinality'] : [col] })
    } else if (tf === 'JoinExpr') {
      if (b.alias) no('alias sobre un JOIN')
      desde(b.larg)
      desde(b.rarg)
      for (const u of b.usingClause ?? []) {
        const c = sval(u)
        if (!scope.items.some((i) => i.cols.includes(c))) throw new Rechazo({ tipo: 'dato_inexistente', fuente: scope.items.map((i) => i.fuente).join(', '), campo: c })
      }
      expr(b.quals, scope, entorno, ctx)
    } else no(`la construcción ${tf} en FROM`)
  }
  for (const f of s.fromClause ?? []) desde(f)

  const targets: Analisis['targets'] = []
  for (const tg of s.targetList ?? []) {
    const rt = tg.ResTarget
    const [tv, bv] = tipoDe(rt.val)
    if (tv === 'ColumnRef' && (bv.fields as Nodo[]).some((f) => f.A_Star)) {
      resolver(bv, scope, null, ctx)
      const q = bv.fields.length === 2 ? sval(bv.fields[0]) : null
      const items = q ? scope.items.filter((i) => i.alias === q) : scope.items
      for (const it of items) for (const c of it.cols) targets.push({ name: c, val: null })
      continue
    }
    expr(rt.val, scope, entorno, ctx)
    targets.push({ name: rt.name ?? nombreDeSalida(rt.val), val: rt.val })
  }
  const salidas = targets.map((x) => x.name)
  for (const d of s.distinctClause ?? []) if (d && Object.keys(d).length) expr(d, scope, entorno, ctx, salidas)
  expr(s.whereClause, scope, entorno, ctx)
  for (const g of s.groupClause ?? []) expr(g, scope, entorno, ctx, salidas)
  expr(s.havingClause, scope, entorno, ctx)
  for (const w of s.windowClause ?? []) ventana(w.WindowDef, scope, entorno, ctx)
  for (const o of s.sortClause ?? []) expr(o, scope, entorno, ctx, salidas)
  expr(s.limitCount, { items: [], padre }, entorno, ctx)
  expr(s.limitOffset, { items: [], padre }, entorno, ctx)
  return { cols: salidas, targets }
}

export function validarConsulta(sqlOriginal: string, forma: Forma): Validada {
  const sql = sqlOriginal.trim().replace(/;+\s*$/, '')
  let ast
  try {
    ast = parseSync(sql)
  } catch (e) {
    return { ok: false, error: { tipo: 'sintaxis', mensaje: e instanceof Error ? e.message : String(e) } }
  }
  try {
    const stmts = ast.stmts ?? []
    if (stmts.length !== 1) no('más de una sentencia')
    const stmt = stmts[0].stmt as Nodo
    const ctx = new Contexto()
    const a = analizarSelect(stmt, null, { ctes: new Map() }, ctx)
    const top = stmt.SelectStmt
    if (top.valuesLists) no('VALUES como consulta')
    if (a.targets.length) {
      const base = top.op && top.op !== 'SETOP_NONE' ? null : a.targets
      if (base) for (const tg of base) if (tg.val && !dependeDeDatos(tg.val)) return { ok: false, error: { tipo: 'sin_datos', columna: tg.name } }
    }
    const cols = a.cols
    if (forma.tipo === 'numero' && !(cols.length === 1 && cols[0] === 'valor')) return { ok: false, error: { tipo: 'forma', mensaje: `La forma "numero" pide exactamente una columna llamada valor; tu consulta devuelve: ${cols.join(', ')}.` } }
    if (forma.tipo === 'serie' && !(cols.length === 2 && cols.includes('etiqueta') && cols.includes('valor'))) return { ok: false, error: { tipo: 'forma', mensaje: `La forma "serie" pide exactamente dos columnas llamadas etiqueta y valor; tu consulta devuelve: ${cols.join(', ')}.` } }
    if (forma.tipo === 'filas' && cols.length === 0) return { ok: false, error: { tipo: 'forma', mensaje: 'La consulta no devuelve columnas.' } }
    return { ok: true, sql, usa: [...ctx.usa].sort(), columnas: cols }
  } catch (e) {
    if (e instanceof Rechazo) return { ok: false, error: e.error }
    throw e
  }
}

/** El mensaje que se le devuelve al generador, con lo que necesita para corregir. */
export function explicar(e: ErrorDeConsulta): string {
  switch (e.tipo) {
    case 'sintaxis':
      return `Error de sintaxis de Postgres: ${e.mensaje}`
    case 'dato_inexistente':
      return e.campo === null
        ? `La fuente "${e.fuente}" no existe en el catálogo.`
        : `La columna "${e.campo}" no existe en ${e.fuente}.${e.columnasDeLaFuente ? ` Columnas disponibles: ${e.columnasDeLaFuente.join(', ')}.` : ''} Si el dato no está en el catálogo, responde no_se_puede con motivo dato_inexistente.`
    case 'no_permitido':
      return `No permitido: ${e.que}.`
    case 'forma':
      return e.mensaje
    case 'sin_datos':
      return `La columna "${e.columna}" no depende de ningún dato del Negocio (es una constante). Si el dato no existe en el catálogo, responde no_se_puede con motivo dato_inexistente.`
  }
}
