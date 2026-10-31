import { DETECTORES, HECHOS_DE_PRUEBA, PROMESAS, diceAlguna, montosEn, revisar, revisarTextoDelDueno } from '../src/nucleo/salida/revisar'
import { afirmar, terminar } from './afirmar.mjs'

try {
  for (const [motivo, d] of Object.entries(DETECTORES)) {
    for (const t of d.pruebas.dispara) afirmar(`${motivo} dispara con «${t.slice(0, 60)}»`, d.detecta(t, HECHOS_DE_PRUEBA))
    for (const t of d.pruebas.noDispara) afirmar(`${motivo} no dispara con «${t.slice(0, 60)}»`, !d.detecta(t, HECHOS_DE_PRUEBA))
  }
  for (const [que, p] of Object.entries(PROMESAS)) {
    for (const t of p.pruebas.dispara) afirmar(`no_prometer ${que} ve «${t}»`, p.detecta(t))
    for (const t of p.pruebas.noDispara) afirmar(`no_prometer ${que} no ve «${t}»`, !p.detecta(t))
  }
  afirmar('montosEn lee $38.000, 45 mil y 120.000 pesos', JSON.stringify(montosEn('Son $38.000, o 45 mil, o 120.000 pesos').sort()) === JSON.stringify([120000, 38000, 45000].sort()), montosEn('Son $38.000, o 45 mil, o 120.000 pesos'))
  afirmar('revisar junta todos los motivos de una respuesta', JSON.stringify(revisar('No soy un bot ☕☕ y te queda en $50.000', HECHOS_DE_PRUEBA)) === JSON.stringify({ tipo: 'corregir', motivos: ['cifra_sin_respaldo', 'demasiados_emojis', 'dice_ser_persona'] }), revisar('No soy un bot ☕☕ y te queda en $50.000', HECHOS_DE_PRUEBA))
  afirmar('revisar deja pasar una respuesta limpia', revisar('La bolsa vale $38.000. ¿Te la envío?', HECHOS_DE_PRUEBA).tipo === 'pasa')
  afirmar('un texto del Dueño con datos de pago y salud no entra', JSON.stringify(revisarTextoDelDueno('Mándame la clave del Nequi; el café cura la gastritis', [])) === JSON.stringify(['pide_datos_de_pago', 'afirmacion_de_salud']))
  afirmar('al Dueño no se le revisan cifras ni emojis', revisarTextoDelDueno('Envío $12.000 ☕☕☕', []).length === 0)
  afirmar('el Dueño puede poner el Nequi y el fijo del Negocio', revisarTextoDelDueno('Pagas por Nequi al 3105551234; recoge en la Calle 63 # 9-20, tel 601 555 1234', []).length === 0)
  afirmar('no_decir compara sin tildes ni mayúsculas', diceAlguna('Es el MEJOR café de Colombia', ['mejor cafe']) === 'mejor cafe' && diceAlguna('Un café suave', ['mejor cafe']) === null)
} catch (e) {
  afirmar('probar-revisar terminó sin error inesperado', false, e)
} finally {
  terminar()
}
