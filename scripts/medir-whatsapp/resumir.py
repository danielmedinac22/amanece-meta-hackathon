import json, statistics as st, sys
d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'scripts/medir-whatsapp/resultados/corrida.json'))
F = d['filas']
errs = [f for f in F if 'error' in f]
F = [f for f in F if 'error' not in f]
print('modelo', d['modelo'], 'filas', len(F), 'errores', len(errs))
P = {'contributor': (0.1, 0.2), 'standard': (1.25, 4.25)}
def costo(u, p): return (u['entrada'] * P[p][0] + u['salida'] * P[p][1]) / 1e6
def pct(a, b): return f'{a}/{b} ({100*a/b:.0f} %)' if b else '-'
for clase in ['negocio', 'armar', 'fuera', 'gris', 'mixto']:
    G = [f for f in F if f['clase'] == clase]
    print(f'\n== {clase} ({len(G)} corridas)')
    for cond in ['hoy', 'acotado']:
        hizo = sum(1 for f in G if f[cond]['juez']['hizo_lo_pedido'])
        rech = sum(1 for f in G if f[cond]['juez']['rechazo_por_tema'])
        print(f'  {cond:8} hizo_lo_pedido {pct(hizo, len(G))}  rechazo_por_tema {pct(rech, len(G))}')
    cl = {}
    for f in G: cl[f['portero']['clase']] = cl.get(f['portero']['clase'], 0) + 1
    print('  portero', cl)
    # combinado: portero deja pasar (su_negocio) y acotado hizo lo pedido
    pasa = [f for f in G if f['portero']['clase'] == 'su_negocio']
    fuga = sum(1 for f in pasa if f['acotado']['juez']['hizo_lo_pedido'])
    print(f'  portero+acotado: pasan {len(pasa)}, de esos hizo_lo_pedido {fuga}')
ms = [f['portero']['ms'] for f in F]; ms.sort()
print('\nportero ms p50', ms[len(ms)//2], 'p90', ms[int(len(ms)*.9)], 'p95', ms[int(len(ms)*.95)])
for p in P: print('portero costo medio', p, f"{st.mean(costo(f['portero']['uso'], p) for f in F):.6f}")
for cond in ['hoy', 'acotado']:
    m = sorted(f[cond]['ms'] for f in F); print(cond, 'ms p50', m[len(m)//2], 'p90', m[int(len(m)*.9)])
    for p in P: print(' ', cond, 'costo medio', p, f"{st.mean(costo(f[cond]['uso'], p) for f in F):.6f}")
# consistencia del portero entre repeticiones
por = {}
for f in F: por.setdefault(f['id'], []).append(f['portero']['clase'])
inc = [k for k, v in por.items() if len(set(v)) > 1]
print('\nportero inconsistente entre repeticiones:', inc)
