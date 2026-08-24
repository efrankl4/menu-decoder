/* Menu Decoder — offline-first restaurant menu glossary + quick reference */
'use strict';

// Shipped defaults are deliberately empty: no personal dietary information lives in
// this source. Each diner's watched tags — and the severity order used for sorting —
// are set on-device via the 👥 panel and persist in that device's localStorage.
const DEFAULT_PROFILES = [
  { id: 'd1', name: 'Diner 1', tags: [] },
  { id: 'd2', name: 'Diner 2', tags: [] }
];

const CERT_MARK   = { always: '!', usually: '!', sometimes: '?', rarely: '·' };
const CERT_WORD   = { always: 'always', usually: 'usually', sometimes: 'sometimes — worth asking', rarely: 'rarely' };
const PROM_WORD   = {
  primary: 'a large part of the dish', significant: 'a real component, tasted throughout',
  minor: 'present but small', garnish: 'a garnish — removable by hand', trace: 'seasoning or cooking-fat amount'
};
const PROM_ORDER  = { primary: 5, significant: 4, minor: 3, garnish: 2, trace: 1 };
const CERT_ORDER  = { always: 4, usually: 3, sometimes: 2, rarely: 1 };

// Ascending "badness" for row sorting: rarely/sometimes should sit higher (closer to the
// top) than always, per how the user wants the profile columns to read.
const CERT_ROW_RANK = { rarely: 0, sometimes: 1, usually: 2, always: 3 };

// A profile's `tags` array is ordered most-severe-first, set by dragging in the 👥 panel.
// Rank derives from that position: the top tag scores highest and so sinks furthest down
// the table when sorting, leaving the safest dishes on top. A tag this diner doesn't
// watch scores 0 and stays at the very top.
function tagRankFor(profile, tag) {
  const tags = profile.tags || [];
  const i = tags.indexOf(tag);
  return i < 0 ? 0 : tags.length - i;
}
// Sort key for one term in one profile column: [worst tag-tier, that tier's worst certainty].
// Empty hits sort first (top); ties broken by the least-safe certainty within the worst tier.
function profileSortKey(term, profile) {
  const hits = hitsFor(term, profile);
  if (!hits.length) return [0, 0];
  let tier = -1, cert = -1;
  hits.forEach(h => {
    const t = tagRankFor(profile, h.tag);
    const c = CERT_ROW_RANK[h.certainty] ?? 0;
    if (t > tier || (t === tier && c > cert)) { tier = t; cert = c; }
  });
  return [tier, cert];
}
function cmpKeys(a, b) { return a[0] - b[0] || a[1] - b[1]; }

const state = {
  terms: [], tags: {}, tagList: [], cuisines: [], restaurants: [],
  profiles: load('profiles', DEFAULT_PROFILES),
  showLabels: load('showLabels', false),
  view: 'table',
  q: '',
  sort: { col: null, dir: 'asc' }, // col: profile.id or 'hot'; cycles asc -> desc -> off
  filters: load('filters', { cuisines: [], types: [], hideFor: [], restaurants: [], maxHeat: null })
};
// filters saved before the restaurants field existed won't have it — patch in place
if (!state.filters.restaurants) state.filters.restaurants = [];

function load(k, dflt) {
  try { const v = localStorage.getItem('md.' + k); return v ? JSON.parse(v) : dflt; }
  catch { return dflt; }
}
function save(k, v) {
  try { localStorage.setItem('md.' + k, JSON.stringify(v)); } catch { /* private mode */ }
}

/* ---------- text normalization ---------- */
const norm = s => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/['’`\-_.]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

/* ---------- data load ---------- */
async function boot() {
  const [tagsRes, cuisRes, restRes] = await Promise.all([
    fetch('data/tags.json').then(r => r.json()),
    fetch('data/cuisines.json').then(r => r.json()),
    fetch('data/restaurants.json').then(r => r.json()).catch(() => ({ restaurants: [] }))
  ]);
  state.tagList = tagsRes.tags;
  tagsRes.tags.forEach(t => state.tags[t.id] = t);
  state.tagGroups = tagsRes.groups;
  state.cuisines = cuisRes.cuisines;
  state.restaurants = restRes.restaurants;
  state.restaurantMap = {};
  restRes.restaurants.forEach(r => state.restaurantMap[r.id] = r);

  const built = cuisRes.cuisines.filter(c => c.status !== 'planned');
  const files = await Promise.all(built.map(c =>
    fetch('data/terms/' + c.file).then(r => r.json()).catch(() => ({ terms: [] }))
  ));

  // label every cuisine, including ones only referenced by cross-tagged terms
  const byCuisine = {};
  cuisRes.cuisines.forEach(c => byCuisine[c.id] = c);
  state.cuisineMap = byCuisine;

  files.forEach(f => f.terms.forEach(t => {
    t._search = norm([t.term, t.native, (t.romanizations || []).join(' '), t.short, t.long,
                      (t.type || []).join(' '), (t.restaurants || []).map(id => (state.restaurantMap[id] || {}).name || '').join(' ')
                     ].join(' '));
    t._cuisineLabels = (t.cuisines || []).map(id => (byCuisine[id] || {}).label || id);
    t._restaurantLabels = (t.restaurants || []).map(id => (state.restaurantMap[id] || {}).name || id);
    state.terms.push(t);
  }));

  state.termById = {};
  state.terms.forEach(t => state.termById[t.id] = t);
  state.terms.sort((a, b) => a.term.localeCompare(b.term));

  wire();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- filtering ---------- */
function visibleTerms() {
  const q = norm(state.q);
  const f = state.filters;
  const qNative = (state.q || '').trim();

  return state.terms.filter(t => {
    if (q && !t._search.includes(q) && !(qNative && (t.native || '').includes(qNative))) return false;
    if (f.cuisines.length && !t.cuisines.some(c => f.cuisines.includes(c))) return false;
    if (f.restaurants.length && !(t.restaurants || []).some(r => f.restaurants.includes(r))) return false;
    if (f.types.length && !(t.type || []).some(ty => f.types.includes(ty))) return false;
    if (f.maxHeat !== null && t.spicy && t.spicy.frequency !== 'never'
        && t.spicy.frequency !== 'rarely' && t.spicy.heat > f.maxHeat) return false;
    for (const pid of f.hideFor) {
      const p = state.profiles.find(x => x.id === pid);
      if (p && hitsFor(t, p).length) return false;
    }
    return true;
  });
}

/* which watched tags a term triggers for a profile */
function hitsFor(term, profile) {
  const watched = new Set(profile.tags);
  let hits = (term.contains || []).filter(c => watched.has(c.tag));
  // melon is more specific than raw_fruit / fruit: don't double-report the same food
  if (hits.some(h => h.tag === 'melon')) hits = hits.filter(h => h.tag !== 'raw_fruit' && h.tag !== 'fruit');
  if (hits.some(h => h.tag === 'raw_fruit')) hits = hits.filter(h => h.tag !== 'fruit');
  if (hits.some(h => h.tag === 'raw_fish')) hits = hits.filter(h => h.tag !== 'fish');
  return hits.sort((a, b) =>
    (PROM_ORDER[b.prominence] - PROM_ORDER[a.prominence]) ||
    (CERT_ORDER[b.certainty] - CERT_ORDER[a.certainty]));
}

/* ---------- rendering ---------- */
function chipHTML(hit) {
  const tag = state.tags[hit.tag] || { emoji: '', short: hit.tag, label: hit.tag };
  const face = tag.emoji || '';
  const lbl = (!tag.emoji || state.showLabels) ? `<span class="lbl">${tag.short}</span>` : '';
  const title = `${tag.label}${hit.specific ? ' — ' + hit.specific : ''}: ${CERT_WORD[hit.certainty]}, ${PROM_WORD[hit.prominence]}`;
  return `<span class="chip chip-${hit.prominence}" title="${esc(title)}">${face}${lbl}<span class="cert">${CERT_MARK[hit.certainty]}</span></span>`;
}

function profileCell(term, profile) {
  const hits = hitsFor(term, profile);
  if (!hits.length) return '<span class="clear-mark" title="Nothing on this diner\'s list">✓</span>';
  return hits.map(chipHTML).join('');
}

function spiceCell(sp) {
  if (!sp) return '';
  const h = sp.heat || 0;
  const peppers = h === 0 ? '—' : '🌶'.repeat(Math.min(h, 4));
  const freq = { always: 'always', usually: 'usually', sometimes: 'sometimes', rarely: 'rarely', never: '' }[sp.frequency] || '';
  return `<span class="heat heat-${h}" title="${esc('Heat ' + h + '/4, ' + (sp.frequency || '') + (sp.adjustable ? ', usually adjustable' : ''))}">${peppers}${sp.adjustable ? '<sup>±</sup>' : ''}</span><span class="freq">${freq}</span>`;
}

function sortArrow(colId) {
  if (state.sort.col !== colId) return '';
  return state.sort.dir === 'asc' ? ' ▲' : ' ▼';
}

function sortedList(list) {
  const { col, dir } = state.sort;
  if (!col) return list;
  const mult = dir === 'asc' ? 1 : -1;
  const keyed = list.map((t, i) => ({
    t, i,
    key: col === 'hot' ? [t.spicy ? (t.spicy.heat || 0) : 0, 0]
                        : profileSortKey(t, state.profiles.find(p => p.id === col))
  }));
  keyed.sort((a, b) => mult * cmpKeys(a.key, b.key) || (a.i - b.i));
  return keyed.map(k => k.t);
}

function renderTable(list) {
  list = sortedList(list);

  const head = document.getElementById('thead-row');
  head.innerHTML = state.profiles.map(p =>
      `<th class="th-sort" data-sort="${esc(p.id)}" title="${esc(p.tags.map(t => (state.tags[t] || {}).label || t).join(', '))}">${esc(p.name)}${sortArrow(p.id)}</th>`).join('')
    + `<th class="th-sort" data-sort="hot">Hot${sortArrow('hot')}</th>`
    + '<th>Term</th>';

  const body = document.getElementById('tbody');
  body.innerHTML = list.map(t => `
    <tr data-id="${t.id}">
      ${state.profiles.map(p => `<td class="td-prof">${profileCell(t, p)}</td>`).join('')}
      <td class="td-spice">${spiceCell(t.spicy)}</td>
      <td class="td-term">
        <span class="term-name">${esc(t.term)}</span>
        <span class="term-meta">${esc(t._cuisineLabels.join(', '))} · ${esc((t.type || []).join(' · '))}</span>
        <span class="term-short">${md(t.short)}</span>
        ${t._restaurantLabels.length ? `<span class="term-rest">🍽 ${esc(t._restaurantLabels.join(', '))}</span>` : ''}
      </td>
    </tr>`).join('');

  document.getElementById('table-empty').hidden = list.length > 0;
}

function renderGlossary(list) {
  document.getElementById('glossary-list').innerHTML = list.map(t => `
    <article class="gcard" data-id="${t.id}">
      <h3>${esc(t.term)} ${t.native ? `<span class="native">${esc(t.native)}</span>` : ''}</h3>
      <div class="gmeta">${esc(t._cuisineLabels.join(', '))} · ${esc((t.type || []).join(' · '))}${
        t._restaurantLabels.length ? ` · 🍽 ${esc(t._restaurantLabels.join(', '))}` : ''}</div>
      <p>${md(t.short)}</p>
      <div class="gchips">${state.profiles.map(p => {
        const hits = hitsFor(t, p);
        return hits.length ? `<span class="term-meta">${esc(p.name)}:</span> ${hits.map(chipHTML).join('')} ` : '';
      }).join('')}</div>
    </article>`).join('');
  document.getElementById('glossary-empty').hidden = list.length > 0;
}

function render() {
  const list = visibleTerms();
  document.getElementById('view-table').hidden = state.view !== 'table';
  document.getElementById('view-glossary').hidden = state.view !== 'glossary';
  if (state.view === 'table') renderTable(list); else renderGlossary(list);
  renderActiveFilters();
}

function renderActiveFilters() {
  const f = state.filters, bits = [];
  f.cuisines.forEach(c => bits.push([`cuisine:${c}`, (state.cuisineMap[c] || {}).label || c]));
  f.restaurants.forEach(r => bits.push([`restaurant:${r}`, (state.restaurantMap[r] || {}).name || r]));
  f.types.forEach(t => bits.push([`type:${t}`, t]));
  f.hideFor.forEach(p => {
    const pr = state.profiles.find(x => x.id === p);
    if (pr) bits.push([`hide:${p}`, `only ${pr.name}-safe`]);
  });
  if (f.maxHeat !== null) bits.push(['heat', `heat ≤ ${f.maxHeat}`]);
  const el = document.getElementById('active-filters');
  el.hidden = !bits.length;
  el.innerHTML = bits.map(([k, label]) =>
    `<span class="fchip">${esc(label)}<button data-drop="${esc(k)}" aria-label="Remove">✕</button></span>`).join('');
}

/* ---------- detail sheet ---------- */
function openSheet(id) {
  const t = state.termById[id];
  if (!t) return;
  const b = document.getElementById('sheet-body');

  const perProfile = state.profiles.map(p => {
    const hits = hitsFor(t, p);
    if (!hits.length) return `<div class="det"><span class="em">✓</span><div><span class="dl">${esc(p.name)}</span>
      <span class="dd">— nothing on this list</span></div></div>`;
    return hits.map(h => {
      const tag = state.tags[h.tag] || {};
      return `<div class="det"><span class="em">${tag.emoji || tag.short || ''}</span><div>
        <span class="dl">${esc(p.name)} · ${esc(tag.label || h.tag)}</span>
        <span class="pill pill-${h.certainty === 'sometimes' ? 'sometimes' : 'always'}">${CERT_WORD[h.certainty]}</span>
        <div class="dd">${h.specific ? esc(h.specific) + ' — ' : ''}${PROM_WORD[h.prominence]}${h.note ? '. ' + md(h.note) : ''}</div>
      </div></div>`;
    }).join('');
  }).join('');

  const others = (t.contains || []).filter(c =>
    !state.profiles.some(p => p.tags.includes(c.tag)));
  const othersHTML = others.length ? `<div class="sec-h">Also contains</div>` + others.map(h => {
    const tag = state.tags[h.tag] || {};
    return `<div class="det"><span class="em">${tag.emoji || tag.short || ''}</span><div>
      <span class="dl">${esc(tag.label || h.tag)}</span>
      <span class="pill">${CERT_WORD[h.certainty]}</span>
      <div class="dd">${h.specific ? esc(h.specific) + ' — ' : ''}${PROM_WORD[h.prominence]}${h.note ? '. ' + md(h.note) : ''}</div>
    </div></div>`;
  }).join('') : '';

  const sp = t.spicy || {};
  const spiceHTML = `<div class="sec-h">Heat</div><div class="det"><span class="em">${sp.heat ? '🌶' : '—'}</span><div>
    <span class="dl">${sp.heat || 0}/4${sp.adjustable ? ' · usually adjustable' : ''}</span>
    <span class="pill">${esc(sp.frequency || 'unknown')}</span>
    ${sp.note ? `<div class="dd">${md(sp.note)}</div>` : ''}</div></div>`;

  const comps = (t.components || []).map(id => state.termById[id]).filter(Boolean);
  const compHTML = comps.length
    ? `<div class="sec-h">See also</div><div class="linkrow">${comps.map(c =>
        `<button data-goto="${c.id}">${esc(c.term)}</button>`).join('')}</div>` : '';

  const rests = (t.restaurants || []).map(id => state.restaurantMap[id]).filter(Boolean);
  const restHTML = rests.length
    ? `<div class="sec-h">Checked against the menu at</div><div class="linkrow">${rests.map(r =>
        `<button data-restfilter="${r.id}">🍽 ${esc(r.name)} <span class="sub-inline">${esc(r.city)}</span></button>`).join('')}</div>`
    : `<p class="note">General ${esc(t._cuisineLabels[0] || 'cuisine')} vocabulary — not tied to one of your saved restaurant menus.</p>`;

  b.innerHTML = `
    <h3>${esc(t.term)} ${t.native ? `<span class="native">${esc(t.native)}</span>` : ''}</h3>
    <div class="smeta">${esc(t._cuisineLabels.join(', '))} · ${esc((t.type || []).join(' · '))}${
      (t.romanizations || []).length ? ' · also written ' + esc(t.romanizations.join(', ')) : ''}</div>
    <p class="slong">${md(t.long || t.short)}</p>
    ${t.ask ? `<p class="ask"><b>Worth asking:</b> “${md(t.ask)}”</p>` : ''}
    <div class="sec-h">For your table</div>
    ${perProfile}
    ${othersHTML}
    ${spiceHTML}
    ${compHTML}
    ${restHTML}
    <p class="confidence">Confidence: ${esc(t.confidence || 'unrated')}. Recipes vary by kitchen — confirm anything that matters.</p>`;

  document.getElementById('sheet').hidden = false;
  document.getElementById('scrim').hidden = false;
  document.getElementById('sheet').scrollTop = 0;
}
function closeSheet() {
  document.getElementById('sheet').hidden = true;
  document.getElementById('scrim').hidden = true;
}

/* ---------- panels ---------- */
function openPanel(which) {
  document.getElementById('scrim').hidden = false;
  if (which === 'filters') { buildFilters(); document.getElementById('panel-filters').hidden = false; }
  else { buildProfiles(); document.getElementById('panel-profiles').hidden = false; }
}
function closePanels() {
  document.getElementById('panel-filters').hidden = true;
  document.getElementById('panel-profiles').hidden = true;
  document.getElementById('scrim').hidden = true;
}

function buildFilters() {
  const f = state.filters;
  const types = [...new Set(state.terms.flatMap(t => t.type || []))].sort();
  const count = id => state.terms.filter(t => (t.cuisines || []).includes(id)).length;
  // a cuisine is listable once any term references it, even if its own file isn't written yet
  const built = state.cuisines.filter(c => count(c.id) > 0);
  const planned = state.cuisines.filter(c => count(c.id) === 0);

  const restCount = id => state.terms.filter(t => (t.restaurants || []).includes(id)).length;
  const restByCity = {};
  state.restaurants.forEach(r => {
    (restByCity[r.city] = restByCity[r.city] || []).push(r);
  });
  const cities = Object.keys(restByCity).sort();

  document.getElementById('filters-body').innerHTML = `
    <div class="sec-h">Cuisine</div>
    ${built.map(c => crow('cuisines', c.id, `${c.flag} ${c.label}`,
        count(c.id) + ' terms' + (c.status === 'planned' ? ' (cross-referenced only, not yet built out)' : ''),
        f.cuisines.includes(c.id))).join('')}
    ${planned.length ? `<p class="note">No terms yet: ${planned.map(c => c.label).join(', ')}</p>` : ''}

    <div class="sec-h">My restaurants</div>
    <p class="note">Filter down to terms checked against a specific menu — handy when you know where you're going. Leave all unchecked to browse the full glossary for anywhere else.</p>
    ${cities.map(city => `
      <div class="crow-group-label">${esc(city)}</div>
      ${restByCity[city].sort((a, b) => a.name.localeCompare(b.name)).map(r =>
        crow('restaurants', r.id, r.name, restCount(r.id) + ' terms checked', f.restaurants.includes(r.id))).join('')}
    `).join('')}

    <div class="sec-h">Type</div>
    ${types.map(t => crow('types', t, t, '', f.types.includes(t))).join('')}

    <div class="sec-h">Show only what's clear for</div>
    ${state.profiles.map(p => crow('hideFor', p.id, p.name,
        'hide anything flagged for this diner', f.hideFor.includes(p.id))).join('')}

    <div class="sec-h">Heat ceiling</div>
    ${[null, 0, 1, 2, 3].map(h => `<div class="crow">
      <input type="radio" name="maxHeat" id="mh${h}" ${f.maxHeat === h ? 'checked' : ''} data-heat="${h}">
      <label for="mh${h}">${h === null ? 'Any heat' : h === 0 ? 'No chili only' : `Heat ${h} or less`}</label></div>`).join('')}

    <button class="btn btn-quiet" id="btn-reset">Reset all filters</button>
    <button class="btn btn-quiet" id="btn-print">Print / save as PDF</button>
    <p class="note">Print uses whatever filters are active, so you can make a one-cuisine sheet to carry.</p>`;
}
function crow(group, val, label, sub, checked) {
  return `<div class="crow"><input type="checkbox" id="f-${group}-${val}" data-group="${group}" data-val="${val}" ${checked ? 'checked' : ''}>
    <label for="f-${group}-${val}">${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</label></div>`;
}

function buildProfiles() {
  document.getElementById('profiles-body').innerHTML =
    state.profiles.map((p, i) => {
      const tags = p.tags || [];
      const sevList = tags.length
        ? `<ul class="sevlist" data-pi="${i}">${tags.map((id, n) => {
            const t = state.tags[id] || { label: id, emoji: '' };
            return `<li data-tag="${esc(id)}" title="Drag to re-rank">
              <span class="sev-grip" aria-hidden="true">⠿</span>
              <span class="sev-num">${n + 1}</span>
              <span class="sev-face">${t.emoji || (t.short || '')}</span>
              <span class="sev-label">${esc(t.label)}</span>
            </li>`;
          }).join('')}</ul>
          <p class="note">Top = most severe. Sorting this column puts these at the
             bottom, so the safest dishes come first.</p>`
        : `<p class="note">Pick categories above, then drag them here to rank severity.</p>`;

      return `
      <div class="prof" data-pi="${i}">
        <div class="prof-head">
          <input value="${esc(p.name)}" data-pname="${i}" aria-label="Diner name" maxlength="12">
          ${state.profiles.length > 1 ? `<button class="icon-btn" data-pdel="${i}" aria-label="Remove diner">🗑</button>` : ''}
        </div>
        <div class="tagpick">${state.tagList.map(t =>
          `<button data-ptag="${i}:${t.id}" class="${tags.includes(t.id) ? 'on' : ''}">${t.emoji ? t.emoji + ' ' : ''}${esc(t.label)}</button>`).join('')}
        </div>
        <div class="sec-h">Severity order</div>
        ${sevList}
      </div>`;
    }).join('')
    + `<button class="btn" id="btn-addprof">+ Add a diner</button>
       <button class="btn btn-quiet" id="btn-resetprof">Reset diners</button>
       <p class="note">Diners are stored on this device only, so they work offline and
          never leave your phone.</p>`;
}

/* ---------- events ---------- */
function wire() {
  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    state.q = search.value;
    document.getElementById('btn-clear').hidden = !state.q;
    render();
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    search.value = ''; state.q = ''; document.getElementById('btn-clear').hidden = true; render(); search.focus();
  });

  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t === tab));
    state.view = tab.dataset.view; render();
  }));

  document.getElementById('btn-filters').addEventListener('click', () => openPanel('filters'));
  document.getElementById('btn-profiles').addEventListener('click', () => openPanel('profiles'));
  document.getElementById('scrim').addEventListener('click', () => { closeSheet(); closePanels(); });
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); closePanels(); } });

  document.getElementById('btn-labels').addEventListener('click', () => {
    state.showLabels = !state.showLabels; save('showLabels', state.showLabels);
    document.getElementById('btn-labels').textContent = state.showLabels ? 'labels off' : 'labels on';
    render();
  });
  document.getElementById('btn-labels').textContent = state.showLabels ? 'labels off' : 'labels on';

  document.body.addEventListener('click', e => {
    const close = e.target.closest('[data-close-panel]');
    if (close) return closePanels();

    const row = e.target.closest('tr[data-id], .gcard[data-id]');
    if (row) return openSheet(row.dataset.id);

    const goto = e.target.closest('[data-goto]');
    if (goto) return openSheet(goto.dataset.goto);

    const sortTh = e.target.closest('[data-sort]');
    if (sortTh) {
      const col = sortTh.dataset.sort;
      if (state.sort.col !== col) state.sort = { col, dir: 'asc' };
      else if (state.sort.dir === 'asc') state.sort = { col, dir: 'desc' };
      else state.sort = { col: null, dir: 'asc' };
      render();
      return;
    }

    const restfilter = e.target.closest('[data-restfilter]');
    if (restfilter) {
      state.filters.restaurants = [restfilter.dataset.restfilter];
      save('filters', state.filters);
      closeSheet(); render();
      return;
    }

    const drop = e.target.closest('[data-drop]');
    if (drop) {
      const [k, v] = drop.dataset.drop.split(':');
      const f = state.filters;
      if (k === 'heat') f.maxHeat = null;
      else if (k === 'cuisine') f.cuisines = f.cuisines.filter(x => x !== v);
      else if (k === 'restaurant') f.restaurants = f.restaurants.filter(x => x !== v);
      else if (k === 'type') f.types = f.types.filter(x => x !== v);
      else if (k === 'hide') f.hideFor = f.hideFor.filter(x => x !== v);
      save('filters', f); render(); return;
    }

    if (e.target.id === 'btn-reset') {
      state.filters = { cuisines: [], types: [], hideFor: [], restaurants: [], maxHeat: null };
      save('filters', state.filters); buildFilters(); render(); return;
    }
    if (e.target.id === 'btn-print') { closePanels(); setTimeout(() => window.print(), 60); return; }

    const ptag = e.target.closest('[data-ptag]');
    if (ptag) {
      const [i, tag] = ptag.dataset.ptag.split(':');
      const p = state.profiles[+i];
      p.tags = p.tags.includes(tag) ? p.tags.filter(t => t !== tag) : p.tags.concat(tag);
      save('profiles', state.profiles); ptag.classList.toggle('on'); render(); return;
    }
    const pdel = e.target.closest('[data-pdel]');
    if (pdel) {
      state.profiles.splice(+pdel.dataset.pdel, 1);
      save('profiles', state.profiles); buildProfiles(); render(); return;
    }
    if (e.target.id === 'btn-addprof') {
      state.profiles.push({ id: 'p' + Date.now(), name: 'Guest', tags: [] });
      save('profiles', state.profiles); buildProfiles(); render(); return;
    }
    if (e.target.id === 'btn-resetprof') {
      state.profiles = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
      save('profiles', state.profiles); buildProfiles(); render(); return;
    }
  });

  document.body.addEventListener('change', e => {
    const cb = e.target.closest('input[data-group]');
    if (cb) {
      const arr = state.filters[cb.dataset.group];
      const v = cb.dataset.val;
      const i = arr.indexOf(v);
      if (cb.checked && i < 0) arr.push(v);
      if (!cb.checked && i >= 0) arr.splice(i, 1);
      save('filters', state.filters); render(); return;
    }
    const heat = e.target.closest('input[data-heat]');
    if (heat && heat.checked) {
      state.filters.maxHeat = heat.dataset.heat === 'null' ? null : +heat.dataset.heat;
      save('filters', state.filters); render(); return;
    }
  });

  document.body.addEventListener('input', e => {
    const nm = e.target.closest('[data-pname]');
    if (nm) {
      state.profiles[+nm.dataset.pname].name = nm.value;
      save('profiles', state.profiles); render();
    }
  });

  /* Severity re-ranking: pointer events rather than HTML5 drag-and-drop, because
     HTML5 DnD doesn't fire on touch. The list is reordered live as you move, and
     the new order is committed to the profile on release. */
  let sevDrag = null;

  document.body.addEventListener('pointerdown', e => {
    const li = e.target.closest('.sevlist li[data-tag]');
    if (!li) return;
    sevDrag = li;
    li.classList.add('dragging');
    try { li.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });

  document.body.addEventListener('pointermove', e => {
    if (!sevDrag) return;
    e.preventDefault();
    const ul = sevDrag.parentElement;
    if (!ul) return;
    const others = [...ul.querySelectorAll('li[data-tag]')].filter(x => x !== sevDrag);
    // insert before the first item whose vertical midpoint we're above
    const after = others.find(s => {
      const r = s.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (after) ul.insertBefore(sevDrag, after);
    else ul.appendChild(sevDrag);
  });

  const endSevDrag = () => {
    if (!sevDrag) return;
    const ul = sevDrag.parentElement;
    sevDrag.classList.remove('dragging');
    sevDrag = null;
    if (!ul) return;
    const pi = +ul.dataset.pi;
    state.profiles[pi].tags = [...ul.querySelectorAll('li[data-tag]')].map(li => li.dataset.tag);
    save('profiles', state.profiles);
    buildProfiles(); // refresh the 1..n rank numbers
    render();        // re-sort the table under the new severity order
  };
  document.body.addEventListener('pointerup', endSevDrag);
  document.body.addEventListener('pointercancel', endSevDrag);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Minimal markdown: **bold** and *italic* only, applied after escaping so raw
   asterisks in the source data can never inject markup. Used for the free-text
   short/long/note/ask fields, which lean on **bold** to flag the one ingredient
   that matters in a sentence. */
function md(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

boot();
