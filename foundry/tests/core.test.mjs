import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { checkEnvironment, listActors, readActor, filterRows, escapeHTML } from "../koronil-progression/scripts/core.mjs";

const player = { id: "player", isGM: false, isTrusted: true };
const gm = { id: "gm", isGM: true };
function actor({ id = "a", permission = "OWNER", type = "character", items = [] } = {}) {
  return { id, name: id, type, system: { editMode: false }, items,
    testUserPermission: (_user, level) => permission === "OWNER" || permission === level,
    update: () => { throw new Error("Une écriture est interdite dans l’étape 1."); } };
}

test("a trusted player cannot open the MJ interface; only observable characters are listed", () => {
  const actors = [actor({id:"owner"}), actor({id:"observer",permission:"OBSERVER"}), actor({id:"limited",permission:"LIMITED"}), actor({id:"hidden",permission:"NONE"}), actor({id:"npc",type:"spirit"})];
  assert.deepEqual(listActors(actors, player, "player").map(a=>a.id), ["observer", "owner"]);
  assert.throws(()=>listActors(actors, player, "gm"), /réservée/);
  assert.equal(listActors(actors, gm, "gm").length, 4);
  assert.throws(()=>readActor(actors[3], player, "player"), /accessible/);
});

test("raw uses base+gained, not effective minus bonus; absent prepared values remain unavailable", () => {
  const a = actor({items:[{id:"s",name:"Dodge",type:"skill",system:{baseChance:20,gainedChance:30,categoryMod:5,chance:42,hasExperience:true,canGetExperience:true}}, {id:"r",name:"Air",type:"rune",system:{chance:74,runeType:{type:"element"}}}]});
  const before = JSON.stringify(a);
  const data = readActor(a, player, "player");
  assert.equal(data.rows.find(r=>r.id==="s").raw,50);
  assert.equal(data.rows.find(r=>r.id==="s").effective,42);
  assert.equal(data.rows.find(r=>r.id==="r").raw,74);
  assert.equal(JSON.stringify(a),before);
  const incomplete=readActor(actor({items:[{id:"x",name:"Missing",type:"skill",system:{baseChance:0,gainedChance:0}}]}), player,"player");
  assert.equal(incomplete.rows[0].raw,0);
  assert.equal(incomplete.rows[0].effective,null);
});

test("filters combine type, accent-insensitive query, category and experience", () => {
  const rows=[{name:"Déplacement",type:"skill",category:"agility",categoryLabel:"Agilité",tick:true},{name:"Air",type:"rune",category:"element",categoryLabel:"Élément",tick:true}];
  assert.equal(filterRows(rows,{search:"deplacement",category:"agility",ticksOnly:true}).length,1);
  assert.equal(filterRows(rows,{type:"rune",search:"element"}).length,1);
  assert.equal(filterRows(rows,{type:"passion"}).length,0);
  assert.equal(escapeHTML('<img src="x">'),"&lt;img src=&quot;x&quot;&gt;");
});

test("unsupported versions are rejected", () => {
  assert.doesNotThrow(()=>checkEnvironment({version:"14.367",system:{id:"rqg",version:"6.1.1"}}));
  assert.throws(()=>checkEnvironment({version:"13.351",system:{id:"rqg",version:"6.1.1"}}));
  assert.throws(()=>checkEnvironment({version:"14.367",system:{id:"rqg",version:"6.0.0"}}));
});

test("the supplied Koronil export is read without changes", {skip:!process.env.KORONIL_TEST_EXPORT}, () => {
  const source=fs.readFileSync(process.env.KORONIL_TEST_EXPORT,"utf8");
  const a=JSON.parse(source);
  a.id=a._stats.exportSource.uuid.split(".")[1]; a.testUserPermission=()=>true;
  const before=JSON.stringify(a);
  const data=readActor(a,gm,"gm");
  assert.deepEqual(data.counts,{skill:85,passion:9,rune:18});
  const spirit=data.rows.find(r=>r.name==="Spirit Combat");
  assert.equal(spirit.raw,94); assert.equal(spirit.tick,true); assert.equal(spirit.effective,null);
  assert.equal(data.rows.find(r=>r.name==="Scan").raw,73);
  assert.equal(JSON.stringify(a),before);
  assert.equal(fs.readFileSync(process.env.KORONIL_TEST_EXPORT,"utf8"),source);
});
