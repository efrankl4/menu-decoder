#!/usr/bin/env node
/* Schema + reference checks for the term data. Run: node validate.js */
'use strict';
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, 'data');
const tags = new Set(JSON.parse(fs.readFileSync(path.join(D, 'tags.json'), 'utf8')).tags.map(t => t.id));
const cuisines = JSON.parse(fs.readFileSync(path.join(D, 'cuisines.json'), 'utf8')).cuisines;
const cuisineIds = new Set(cuisines.map(c => c.id));
const restaurants = JSON.parse(fs.readFileSync(path.join(D, 'restaurants.json'), 'utf8')).restaurants;
const restaurantIds = new Set(restaurants.map(r => r.id));

const CERT = ['always', 'usually', 'sometimes', 'rarely'];
const PROM = ['primary', 'significant', 'minor', 'garnish', 'trace'];
const FREQ = ['never', 'rarely', 'sometimes', 'usually', 'always'];
const TYPES = ['dish', 'ingredient', 'technique', 'sauce', 'spice-blend', 'bread',
               'beverage', 'dessert', 'course', 'utensil-or-service'];

const problems = [];
const all = [];
const ids = new Set();

for (const c of cuisines.filter(c => c.status !== 'planned')) {
  const p = path.join(D, 'terms', c.file);
  if (!fs.existsSync(p)) { problems.push(`missing file: ${c.file}`); continue; }
  const terms = JSON.parse(fs.readFileSync(p, 'utf8')).terms;
  terms.forEach(t => {
    t._file = c.file;
    all.push(t);
    if (ids.has(t.id)) problems.push(`${c.file}: duplicate id ${t.id}`);
    ids.add(t.id);
  });
}

for (const t of all) {
  const at = m => problems.push(`${t._file} ${t.id}: ${m}`);
  for (const f of ['id', 'term', 'language', 'short', 'long', 'confidence']) {
    if (!t[f]) at(`missing "${f}"`);
  }
  (t.cuisines || []).forEach(c => { if (!cuisineIds.has(c)) at(`unknown cuisine "${c}"`); });
  if (!(t.type || []).length) at('no type');
  (t.type || []).forEach(ty => { if (!TYPES.includes(ty)) at(`unknown type "${ty}"`); });

  (t.contains || []).forEach(h => {
    if (!tags.has(h.tag)) at(`unknown tag "${h.tag}"`);
    if (!CERT.includes(h.certainty)) at(`bad certainty "${h.certainty}" on ${h.tag}`);
    if (!PROM.includes(h.prominence)) at(`bad prominence "${h.prominence}" on ${h.tag}`);
  });

  const sp = t.spicy;
  if (!sp) at('missing spicy');
  else {
    if (!FREQ.includes(sp.frequency)) at(`bad spicy.frequency "${sp.frequency}"`);
    if (!(Number.isInteger(sp.heat) && sp.heat >= 0 && sp.heat <= 4)) at(`bad spicy.heat "${sp.heat}"`);
    if (sp.frequency === 'never' && sp.heat > 1) at(`heat ${sp.heat} but frequency "never"`);
    if (sp.frequency === 'always' && sp.heat === 0) at('frequency "always" but heat 0');
  }

  (t.components || []).forEach(c => { if (!ids.has(c)) at(`dangling component -> ${c}`); });
  (t.restaurants || []).forEach(r => { if (!restaurantIds.has(r)) at(`unknown restaurant "${r}"`); });
}

// coverage summary
const byCuisine = {};
all.forEach(t => (t.cuisines || []).forEach(c => byCuisine[c] = (byCuisine[c] || 0) + 1));
console.log('Terms per cuisine:', byCuisine);
console.log('Total unique terms:', all.length);

const tagUse = {};
all.forEach(t => (t.contains || []).forEach(h => tagUse[h.tag] = (tagUse[h.tag] || 0) + 1));
const unused = [...tags].filter(t => !tagUse[t]);
if (unused.length) console.log('Tags not yet used:', unused.join(', '));

const byRestaurant = {};
all.forEach(t => (t.restaurants || []).forEach(r => byRestaurant[r] = (byRestaurant[r] || 0) + 1));
console.log('Terms per restaurant:', byRestaurant);
const noMenuTerms = all.filter(t => !(t.restaurants || []).length).length;
console.log('General (non-menu-specific) terms:', noMenuTerms);

if (problems.length) {
  console.error('\n' + problems.length + ' problem(s):');
  problems.forEach(p => console.error('  ' + p));
  process.exit(1);
}
console.log('\nAll checks passed.');
