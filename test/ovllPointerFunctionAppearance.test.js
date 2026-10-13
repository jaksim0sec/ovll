import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {iconSvg} from '../backend/ovllPointer/nodeCatalog.js';

test('server catalog extends rounded work icons while retaining original SVG bytes',()=>{
 for(const key of ['document','spreadsheet','chart-line','checklist','calendar','clock','search','link','code','database','users','shield','mail','translate']){
  assert.ok(iconSvg[key],key);assert.match(iconSvg[key],/viewBox="0 0 20 20"/);assert.match(iconSvg[key],/stroke-width="1\.28"/);
  assert.doesNotMatch(iconSvg[key],/<(?:script|foreignObject)|\bon\w+=|(?:href|src)=/);
 }
 for(const [key,hash] of Object.entries(ORIGINAL_ICON_HASHES))assert.equal(createHash('sha256').update(iconSvg[key]).digest('hex'),hash,key);
});

const ORIGINAL_ICON_HASHES={
  "play": "c9c58d5e370ed1f5899a79d9e0d5452128740d0f1e94282b855c913564fca796",
  "globe": "729d288d4c7b0a20f241573d82e3a2d6060a4659878c248f558cd8a3e426ed7d",
  "notebook": "3c7a812447060378915623c62ef392ef1e05573154f5a66c9a28a71bc2c6a886",
  "scales": "7bce1e3b0b8edd39156246985d91c540e65d216da2de330549cb5f4e71f39c70",
  "pen": "0008fa6cd33f514fe5f61d5440154a959088674b6ec41a10a1902709f3b6e762",
  "folder": "d0c542c8662131119357f3959363b88b7cb7f75904c14a51d7e498bed9e26371",
  "sparkle": "ee997de103a4331ec34b5fbd808cfa363aed4eb38bedeabd006d010b846e4faa",
  "custom": "baa070704a658ad0dfcead4346ea543afd02bf549eaee0d3992e0799547550ce",
  "open-book": "77817caff8f5e06fa58f591961c3b44360f5c0d9cfd7229ccd3edda722dd0330",
  "flask": "035442051b866adeb0476cb900f0e8b7f39a47750ace08c8335c516b4ff44e2d",
  "potted-plant": "4a56972bfab4e37165a61a15339d129a81ec517a432d9c2a24c3c94784bfe262",
  "graduation-cap": "c9608a97485ab547caa2c678ca7912bdc094d54169d8419403e0a9c50424c311",
  "pencil": "88f2374ec535a12aee68fcba6f9b120b138a04e6ffab9862debb60948cd54e00",
  "lightbulb": "f13ff25de490251c9813349b484f447c7c89a637ea73314b150a58f2a60363c8",
  "hourglass": "cca8a23080c523ad755ae1848fb66b37fe86aabb0e64c8f51bead24594fa7f45",
  "planet": "d4a6debdd82fd99ddde51ac961853ffb48d72e7804cf31b739e180cdc76f39c5",
  "headphones": "53a6153fedf6e78bb23ad23e1ba3e2eb2f2132ad7e1f9ebe626ee2d3c2f9e934",
  "coffee-cup": "e29ff577feac87bf9468a088b120bb5779b8077a7693008c843bdfc89829750c",
  "compass": "d7386138591cbd4a2ca14e08d9f2b5de4c68e59b8a348312615e164457424192"
};
