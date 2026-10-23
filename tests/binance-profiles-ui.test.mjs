import {test} from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import Hyrule from '../app/page.tsx';
import BinanceSecondAccount from '../app/binance-2/page.tsx';
test('secondary route reuses the same dashboard, starts without account data and identifies its separate connection',()=>{
 const html=renderToStaticMarkup(React.createElement(BinanceSecondAccount));
 assert.match(html,/Usuario 2 Binance/);assert.match(html,/Erre Binance/);assert.match(html,/Conecta aquí la cuenta de Usuario 2 Binance/);assert.match(html,/target="_blank"/);
 assert.doesNotMatch(html,/sessionCredentials/);assert.match(html,/Otras Simulaciones/);assert.doesNotMatch(html,/Kraken Futures|Abrir Binance|Binance V2 · Comparación/);
});
test('primary dashboard preserves its original default navigation',()=>{
 const html=renderToStaticMarkup(React.createElement(Hyrule));assert.doesNotMatch(html,/Conecta aquí la cuenta de Usuario 2 Binance/);
});
