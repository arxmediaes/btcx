# Revisión real invertida — 10 octubre 2026

Fuente: exportación historial-real schema 2 entregada por el usuario, lastCheckedAt 1791647699371. Resultados netos de fichas con outcome.status verified; no inferir estrategias de filas de cierre sin vínculo. Los fills parciales no son posiciones independientes.

Balance histórico neto: -7.61081278 USDT. Realizado -2.25006066, comisiones -5.33510304, funding +0.00175205, ajustes -0.02740113. Frente a la exportación anterior: -1.83694874 neto adicional, compuesto por -1.388254 realizado y -0.44869474 comisiones.

## Fichas invertidas verificadas

| Estrategia original | Fichas | Ganadoras netas | Neto USDT |
|---|---:|---:|---:|
| ADX | 10 | 3 | -0.42313235 |
| EMA | 4 | 2 | -0.11493390 |
| Breakout | 3 | 2 | -0.12846622 |

Se mezclan distintas versiones invertidas; esta tabla es descriptiva, no valida la versión actual. En v8 solamente hay dos cierres vinculados, OP ADX: -0.09283295 y -0.09172201; total -0.18455496. NEAR RSI no tiene resultado cerrado verificable. No atribuir otros cierres a v8 por proximidad temporal.

Ejemplos del coste de salir demasiado pronto: AVAX ADX +0.045 bruto -> -0.0071225 neto; SOL ADX +0.02759999 -> -0.0480792; XRP EMA +0.07111999 -> -0.00013717. Un mayor tamaño multiplica tanto ganancias brutas como comisiones; no elimina el coste porcentual mínimo.

## Cambio implementado

Conservar la inversión y los filtros actuales. Calcular SL desde máximos/mínimos y EMA en el lado de ejecución, no reflejar la estructura del lado original. Suelo scalp 0.25%, colchón estructural máximo de 0.35 ATR o 0.06%; conservar máximo SL 2% y ajuste de apalancamiento.

TP moderado: preferir máximo de 1 ATR principal, 1.5 ATR de 1m y 0.5 veces SL. Limitar por el extremo reciente más próximo en el lado de ejecución, descontando 0.15 ATR de 1m o un tick; máximo 0.6% del precio, 2.5 ATR principal y 0.85 veces SL. Si el recorrido no cubre costes, buscar otra moneda sin superar el extremo para forzar la orden. Sin extremo favorable disponible, usar límites de volatilidad y porcentaje.

La selección real usa exclusivamente memoria de ejecuciones invertidas verificadas, normalizada por notional y con peso reducido para muestras pequeñas. Sin prohibiciones fijas de monedas ni declaración de estrategia ganadora. La memoria de seguimiento queda separada. Las posiciones existentes y el simulador no se modifican.
