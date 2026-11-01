const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
test('insight cadence persists valid settings and rejects unsafe or fractional thresholds',()=>{
 const values={turns:5,seconds:30};class Store {get(key,defaultValue){return values[key]??defaultValue;}set(value){Object.assign(values,value);}}
 const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/features/listen/summary/insightSettings.js'),'utf8'),{module,exports:module.exports,require:()=>Store});
 assert.equal(module.exports.get().turns,5);assert.equal(module.exports.get().seconds,30);
 module.exports.set({turns:3,seconds:15});assert.equal(module.exports.get().turns,3);assert.equal(module.exports.get().seconds,15);
 for(const value of [{turns:0,seconds:30},{turns:5,seconds:0},{turns:1.5,seconds:30},{turns:5,seconds:601},null])assert.throws(()=>module.exports.set(value));
});
