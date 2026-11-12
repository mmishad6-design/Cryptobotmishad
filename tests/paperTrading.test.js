import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestConservativeLeverage, calculatePaperQuantity } from '../src/paperTrading.js';

test('leverage suggestion falls as ATR stop distance rises and remains capped',()=>{
  assert.equal(suggestConservativeLeverage({entry:100,atr:1}),1);
  assert.equal(suggestConservativeLeverage({entry:100,atr:0.2}),5);
  assert.equal(suggestConservativeLeverage({entry:100,atr:0.5}),2);
  assert.equal(suggestConservativeLeverage({entry:100,atr:0}),null);
});

test('manual paper quantity respects requested margin, fees and risk quantity',()=>{
  const qty=calculatePaperQuantity({entry:100,margin:100,leverage:5,feeRate:0.001,riskQuantity:10,availableBalance:500});
  assert.ok(qty>0);
  assert.ok(qty<=10);
  assert.ok(qty*(100/5+100*0.001)<=100+1e-9);
});

test('manual paper quantity rejects invalid or unaffordable margin',()=>{
  assert.equal(calculatePaperQuantity({entry:100,margin:200,leverage:3,feeRate:0.001,riskQuantity:10,availableBalance:100}),0);
  assert.equal(calculatePaperQuantity({entry:100,margin:100,leverage:0,feeRate:0.001,riskQuantity:10,availableBalance:100}),0);
});
