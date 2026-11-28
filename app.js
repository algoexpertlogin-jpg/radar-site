'use strict';
/* Opportunity Radar - static dashboard. No frameworks. All data text is untrusted: DOM built with createElement/textContent only. */

const GH = 'https://api.github.com';
const OVERRIDES_PATH = 'config/site_overrides.json';
const WORKFLOW = 'daily.yml';
const CONTRACT_TYPES = ['FREELANCE', 'CONTRACT', 'PART_TIME', 'PROJECT', 'RETAINER', 'FULL_TIME', 'INTERNSHIP'];
const COUNTRIES = ['US', 'CA', 'GB', 'IE', 'DE', 'NL', 'FR', 'SE', 'DK', 'NO', 'CH', 'AU', 'NZ', 'AE', 'SG', 'IN'];
const ELIGIBILITIES = ['CONFIRMED_INDIA', 'CONFIRMED_WORLDWIDE', 'POSSIBLE_UNVERIFIED', 'UNKNOWN'];
const PARTITIONS = ['Qualified', 'Needs verification', 'Adjacent/Stretch', 'Excluded'];
const LEGACY_DEFAULT_PARTS = ['Qualified', 'Needs verification', 'Adjacent/Stretch'];
const PRIMARY_FAMILIES = ['salesforce_commerce', 'salesforce_oms', 'wordpress'];
const ADJACENT_FAMILIES = ['other', 'other_lang', 'other_ecommerce', 'salesforce_other'];
const NAV = [['today', 'Today', '☀'], ['leads', 'Leads', '▤'], ['staffing', 'Staffing', '☷'], ['followups', 'Follow-ups', '↻'], ['prospects', 'Prospects', '✉'], ['more', 'More', '⋯']];
const MORE_KEYS = ['more', 'profile', 'run', 'filters', 'settings', 'outreach', 'review'];
const MAIL_BODY_MAX = 1800;
const FOLLOWUP_WINDOW_DAYS = 2;
const DAY_MS = 86400000;
const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const LEAD_DATES = {
  posted: { field: 'date_posted', label: 'Posted' },
  found: { field: 'date_discovered', label: 'First found' },
  changed: { field: 'date_last_changed', label: 'Last changed' },
};
const DATE_WINDOWS = [
  ['', 'Any time'], ['today', 'Today'], ['1', 'Last 24 hours'],
  ...[3, 7, 14, 30, 60].map(n => [String(n), 'Last ' + n + ' days']),
  ['custom', 'Custom dates'], ['unknown', 'Unknown date'],
];
const LEAD_COMMUNITIES = [
  ['Reddit', /^(?:(?:www|old|new)\.)?reddit\.com$/, /^\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/]+(?:\/[a-z0-9]+)?)?\/?$/i],
  ['Blind', /^(?:www\.)?teamblind\.com$/, /^\/post\/[^/]+\/?$/i],
  ['Fishbowl', /^(?:www\.)?fishbowlapp\.com$/, /^\/post\/[^/]+\/?$/i],
  ['LeetCode Discuss', /^(?:www\.)?leetcode\.com$/, /^\/discuss\/(?:post\/\d+(?:\/[^/]+)?|[^/]+\/\d+(?:\/[^/]+)?)\/?$/i],
  ['DEV Community', /^dev\.to$/, /^\/(?!t\/|search\/|settings\/|tags\/|api\/)[^/]+\/[^/]+\/?$/i],
  ['Discourse', /^meta\.discourse\.org$/, /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/i],
];
const LEAD_PLATFORMS = ['LinkedIn posts', 'LinkedIn jobs', ...LEAD_COMMUNITIES.map(([name]) => name), 'Hacker News'];

const S = {
  data: null, site: null, pass: null, overrides: null, overridesSha: null,
  watch: null, pollTimer: null, view: null, pending: {}, pendingProspects: {}, pendingEvents: [], pendingVerifications: {}, pendingStaffing: {}, staffView: null, staffOpen: null,
  syncTimer: null, syncing: false, syncAgain: false, syncLine: null, justMarked: {},
};
const NOT_A_FIT = 'Not a fit';

/* ---------- helpers ---------- */
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else if (k === 'disabled') n.disabled = !!v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
const $app = () => document.getElementById('app');
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function safeUrl(u) {
  try { const x = new URL(String(u)); return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : null; } catch (e) { return null; }
}
function link(url, text, cls) {
  const href = safeUrl(url);
  if (!href) return el('span', { text: text || String(url || '') });
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: cls, text: text || href });
}
function msgBox() {
  const n = el('div', { class: 'msg', role: 'status', 'aria-live': 'polite' });
  n.set = (t, kind) => {
    const text = deviceText(t);
    n.textContent = text || ''; n.className = 'msg' + (text !== t ? ' err' : kind ? ' ' + kind : '');
  };
  return n;
}
// When the browser refuses storage, a change lives only in this open page: say so instead of "saved on this device".
function deviceText(t) {
  if (S.storageOk !== false || !/on this device/i.test(t || '')) return t;
  return String(t).replace(/(saved|kept) on this device/gi, (m, w) => (w[0] === 'S' ? 'Held' : 'held') +
    ' only in this open page (this browser blocks storage, so closing the page loses it)');
}
function parseDate(s) {
  if (!s) return null;
  let str = String(s);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(str)) str += 'Z';
  const t = Date.parse(str);
  return isNaN(t) ? null : t;
}
function ago(ms) {
  if (ms == null) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
function fmtDate(s) { const t = parseDate(s); return t == null ? (s || '') : DATE_TIME_FORMAT.format(t); }
function partClass(p) { return p === 'Needs verification' ? 'Needs' : p === 'Adjacent/Stretch' ? 'Adjacent' : (p || ''); }
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'profile'; }
function csv(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }
function upperCsv(s) { return csv(s).map(x => x.toUpperCase()); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function labelOf(k) { const t = S.data && S.data.taxonomy && S.data.taxonomy[k]; return (t && t.label) || k; }
function skillLabel(k) { return labelOf(k); }

/* ---------- storage ---------- */
const store = {
  get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v, remember) {
    try {
      localStorage.removeItem(k); sessionStorage.removeItem(k);
      (remember ? localStorage : sessionStorage).setItem(k, v);
    } catch (e) { /* ignore */ }
  },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) { /* ignore */ } },
  isLocal(k) { try { return localStorage.getItem(k) != null; } catch (e) { return false; } },
  json(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  setJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
const getToken = () => store.get('or.token') || '';
const getRepo = () => store.get('or.repo') || (S.site && S.site.repo) || (S.data && S.data.repo) || '';
S.pending = store.json('or.pending', {});
S.pendingProspects = store.json('or.pendingProspects', {});
S.pendingEvents = store.json('or.interactionEvents', []);
S.pendingVerifications = store.json('or.leadVerifications', {});
S.pendingStaffing = store.json('or.pendingStaffing', {});
// Queue identities GitHub has acknowledged in this tab, so a copy still in storage (or another tab) is not re-queued.
S.acked = new Set();
const PENDING_MAPS = [['or.pending', 'pending'], ['or.pendingProspects', 'pendingProspects'],
  ['or.leadVerifications', 'pendingVerifications'], ['or.pendingStaffing', 'pendingStaffing']];
const pendingKey = (name, id, rec) => name + ':' + id + ':' + ((rec && (rec.event_id || rec.at || rec.occurred_at)) || '');
// Another tab may have queued changes since this page loaded: take them in (newest record per id) before writing.
function adoptStoredPending() {
  for (const [key, name] of PENDING_MAPS) {
    const stored = store.json(key, {});
    if (!stored || typeof stored !== 'object') continue;
    for (const [id, rec] of Object.entries(stored)) {
      if (!rec || typeof rec !== 'object' || S.acked.has(pendingKey(name, id, rec))) continue;
      S[name][id] = name === 'pendingStaffing' ? mergeStaffRecord(S[name][id], rec) : latestRecord(S[name][id], rec);
    }
  }
  const have = new Set(S.pendingEvents.map(e => e.event_id));
  for (const e of store.json('or.interactionEvents', []) || []) {
    if (e && e.event_id && !have.has(e.event_id) && !S.acked.has('event:' + e.event_id)) { S.pendingEvents.push(e); have.add(e.event_id); }
  }
}
function savePending() {
  adoptStoredPending();
  const ok = [store.setJson('or.pending', S.pending), store.setJson('or.pendingProspects', S.pendingProspects),
    store.setJson('or.interactionEvents', S.pendingEvents), store.setJson('or.leadVerifications', S.pendingVerifications),
    store.setJson('or.pendingStaffing', S.pendingStaffing)].every(Boolean);
  S.storageOk = ok;
  return ok;
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', e => {
    if (e && (e.key === 'or.interactionEvents' || PENDING_MAPS.some(([k]) => k === e.key))) adoptStoredPending();
  });
  // Changes queued offline go up as soon as the connection returns, not only on the next tap.
  window.addEventListener('online', () => { if (S.data && getToken() && pendingChangeCount()) flushSync('pending changes'); });
}
function ownerKey() { return (S.data && S.data.acquisition && S.data.acquisition.owner_key) || 'karthik'; }
function pendingChangeCount() {
  return Object.keys(S.pendingVerifications).length + Object.keys(S.pendingStaffing).length + S.pendingEvents.length +
    Object.values(S.pending).concat(Object.values(S.pendingProspects)).filter(r => !r.event_id).length;
}
function newInteraction(subjectType, obj, status, note, days, kind, channel, reason, previousStatus) {
  const at = new Date().toISOString();
  const event = { event_id: crypto.randomUUID(), subject_type: subjectType, subject_id: obj.id,
    status, note: note || '', follow_up_days: days ?? null, occurred_at: at, at, kind: kind || 'status',
    channel: channel || null, owner_key: ownerKey(), profile_key: obj.track_profile || 'sfcc' };
  if (reason) event.reason = String(reason);
  if (previousStatus) event.previous_status = String(previousStatus);
  S.pendingEvents.push(event);
  (subjectType === 'prospect' ? S.pendingProspects : S.pending)[obj.id] = event;
  savePending();
  return event;
}
function latestRecord(...records) {
  return records.filter(Boolean).sort((a, b) => (parseDate(b.occurred_at || b.at) || 0) - (parseDate(a.occurred_at || a.at) || 0))[0];
}
function mergeStatusMaps(remote, local, merge = latestRecord) {
  const merged = Object.assign({}, remote || {});
  for (const [id, rec] of Object.entries(local || {})) merged[id] = merge(rec, merged[id]);
  return merged;
}
// Newest staffing record wins, but a phone with an old copy must not move the first contact later or drop the
// follow-up time: keep the earliest first contact, and followed_up_at while the status is unchanged.
function mergeStaffRecord(...records) {
  const all = records.filter(r => r && typeof r === 'object');
  const win = latestRecord(...all);
  if (!win) return win;
  const out = Object.assign({}, win);
  if (STAFF_CONTACTED.includes(out.status)) {
    const firsts = all.filter(r => STAFF_CONTACTED.includes(r.status)).map(r => r.first_contact_at).filter(x => parseDate(x) != null);
    if (firsts.length) out.first_contact_at = firsts.sort((a, b) => parseDate(a) - parseDate(b))[0];
  }
  if (!out.followed_up_at) {
    const fu = all.find(r => r !== win && r.status === out.status && r.followed_up_at);
    if (fu) out.followed_up_at = fu.followed_up_at;
  }
  return out;
}

/* ---------- crypto ---------- */
function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function bytesToB64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
function utf8ToB64(str) { return bytesToB64(new TextEncoder().encode(str)); }
function b64ToUtf8(b64) { return new TextDecoder().decode(b64ToBytes(String(b64).replace(/\s/g, ''))); }
async function decryptBytes(env, pass) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64ToBytes(env.salt), iterations: env.iter }, base,
    { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.ct)));
}
async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('NOGZIP');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function decryptPayload(env, pass) {
  const pt = await decryptBytes(env, pass);
  return JSON.parse(new TextDecoder().decode(env.zip === 'gzip' ? await gunzip(pt) : pt));
}

/* ---------- GitHub API ---------- */
class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function ghMessage(status, ctx) {
  if (status === 401) return 'GitHub rejected the token (401). It may be wrong or expired.';
  if (status === 403) return 'Access denied (403): the token lacks permission' + (ctx ? ' (' + ctx + ')' : '') + ', or GitHub rate-limited the request.';
  if (status === 404) return 'Not found (404): check the repository name, and that the token is limited to this repository with the right permissions.';
  if (status === 409) return 'Conflict (409): the file changed while saving. Try again.';
  if (status === 422) return /^Contents/.test(ctx || '') ? 'GitHub rejected the save (422): the file changed while saving. Try again.'
    : 'GitHub rejected the request (422). Check the workflow file name and inputs.';
  return 'GitHub error ' + status + '.';
}
async function gh(method, path, body, ctx) {
  const token = getToken(); const repo = getRepo();
  if (!token) throw new GhError(0, 'No GitHub token set. Add one in Settings.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GhError(0, 'Repository must look like owner/name (see Settings).');
  const url = GH + '/repos/' + repo + path;
  let res;
  try {
    res = await fetch(url, {
      method, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch (e) { throw new GhError(0, 'Network error talking to GitHub.'); }
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch (e) { /* none */ } }
  if (!res.ok) {
    const need = res.headers.get('x-accepted-github-permissions');
    const ghMsg = json && json.message ? ' GitHub says: "' + String(json.message).slice(0, 160) + '".' : '';
    const e = new GhError(res.status, ghMessage(res.status, ctx) + ghMsg + (need ? ' Required permission: ' + need + '.' : ''));
    e.json = json; throw e;
  }
  return json;
}
async function getOverrides() {
  try {
    const j = await gh('GET', '/contents/' + OVERRIDES_PATH + '?ref=main', null, 'Contents: read');
    let content = j.content;
    // Above 1 MB the Contents API omits the content (encoding "none"); the blob API serves files up to 100 MB.
    if (!content && j.sha && (j.encoding === 'none' || j.size > 0)) content = (await gh('GET', '/git/blobs/' + j.sha, null, 'Contents: read')).content;
    const o = JSON.parse(b64ToUtf8(content)); return { obj: (o && typeof o === 'object') ? o : {}, sha: j.sha };
  } catch (e) { if (e.status === 404) return { obj: {}, sha: null }; throw e; }
}
/* GET - merge - PUT; retries once on 409. mutate(obj) edits in place. Pending CRM changes are flushed too. */
async function saveOverrides(mutate, message) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { obj, sha } = await getOverrides();
    mutate(obj);
    adoptStoredPending();
    const flushed = Object.assign({}, S.pending);
    const flushedProspects = Object.assign({}, S.pendingProspects);
    const flushedEvents = S.pendingEvents.slice();
    const flushedVerifications = Object.assign({}, S.pendingVerifications);
    const flushedStaffing = Object.assign({}, S.pendingStaffing);
    if (Object.keys(flushed).length) obj.lead_status = mergeStatusMaps(obj.lead_status, flushed);
    if (Object.keys(flushedProspects).length) obj.prospect_status = mergeStatusMaps(obj.prospect_status, flushedProspects);
    if (Object.keys(flushedVerifications).length) obj.lead_verifications = mergeStatusMaps(obj.lead_verifications, flushedVerifications);
    if (Object.keys(flushedStaffing).length) obj.staffing_status = mergeStatusMaps(obj.staffing_status, flushedStaffing, mergeStaffRecord);
    const events = new Map((obj.interaction_events || []).map(e => [e.event_id, e]));
    for (const e of flushedEvents) events.set(e.event_id, e);
    obj.interaction_events = Array.from(events.values());
    const body = { message: message || 'Update site overrides', content: utf8ToB64(JSON.stringify(obj, null, 2) + '\n'), branch: 'main' };
    if (sha) body.sha = sha;
    try {
      const r = await gh('PUT', '/contents/' + OVERRIDES_PATH, body, 'Contents: write');
      for (const [name, map] of [['pending', flushed], ['pendingProspects', flushedProspects],
        ['pendingVerifications', flushedVerifications], ['pendingStaffing', flushedStaffing]]) {
        for (const [id, rec] of Object.entries(map)) S.acked.add(pendingKey(name, id, rec));
      }
      for (const e of flushedEvents) S.acked.add('event:' + e.event_id);
      for (const [id, rec] of Object.entries(flushed)) if (S.pending[id] && S.pending[id].at === rec.at) delete S.pending[id];
      for (const [id, rec] of Object.entries(flushedProspects)) if (S.pendingProspects[id] && S.pendingProspects[id].event_id === rec.event_id) delete S.pendingProspects[id];
      for (const [id, rec] of Object.entries(flushedVerifications)) {
        if (S.pendingVerifications[id]?.event_id === rec.event_id) delete S.pendingVerifications[id];
      }
      for (const [id, rec] of Object.entries(flushedStaffing)) if (S.pendingStaffing[id] && S.pendingStaffing[id].at === rec.at) delete S.pendingStaffing[id];
      const acked = new Set(flushedEvents.map(e => e.event_id));
      S.pendingEvents = S.pendingEvents.filter(e => !acked.has(e.event_id));
      savePending();
      S.overrides = obj; S.overridesSha = r && r.content && r.content.sha;
      return obj;
    } catch (e) { lastErr = e; if (e.status !== 409 && e.status !== 422) throw e; }
  }
  throw lastErr;
}
async function ensureOverrides() {
  if (S.overrides || !getToken()) return S.overrides;
  try { const r = await getOverrides(); S.overrides = r.obj; S.overridesSha = r.sha; } catch (e) { /* non-fatal */ }
  return S.overrides;
}

/* ---------- boot / unlock ---------- */
async function loadSite() {
  try { const r = await fetch('site.json', { cache: 'no-store' }); if (r.ok) S.site = await r.json(); } catch (e) { /* optional */ }
  updateAge();
}
function updateAge() {
  const g = (S.data && S.data.generated_at) || (S.site && S.site.generated_at);
  const t = parseDate(g);
  document.getElementById('age').textContent = t ? 'updated ' + ago(t) : '';
}
async function fetchAndDecrypt(pass) {
  const r = await fetch('data.enc.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('NODATA');
  const env = await r.json();
  if (![1, 2].includes(env.v) || env.alg !== 'AES-256-GCM' || (env.zip && env.zip !== 'gzip')) throw new Error('Unsupported data format. Reload the page to get the latest app.');
  let pt;
  try { pt = await decryptBytes(env, pass); } catch (e) { throw new Error('BADPASS'); }
  try { return JSON.parse(new TextDecoder().decode(env.zip === 'gzip' ? await gunzip(pt) : pt)); }
  catch (e) { throw new Error(e.message === 'NOGZIP' ? 'This browser cannot open the compressed data. Update the browser (Safari 16.4+, Chrome 80+ or Firefox 113+).' : 'The data file could not be read. Reload the page.'); }
}
function showUnlock(note) {
  buildNav(false);
  const app = $app(); clear(app);
  const m = msgBox();
  const pw = el('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true });
  const rem = el('input', { type: 'checkbox', id: 'rem' });
  const btn = el('button', { class: 'primary', type: 'submit', text: 'Unlock' });
  const form = el('form', { class: 'card unlock', on: { submit: async (ev) => {
    ev.preventDefault(); if (!pw.value) return;
    btn.disabled = true; m.set('Unlocking…');
    try {
      S.data = await fetchAndDecrypt(pw.value); S.pass = pw.value;
      store.set('or.pass', pw.value, rem.checked);
      onUnlocked();
    } catch (e) {
      m.set(e.message === 'BADPASS' ? 'That passphrase did not work. Please check it and try again.'
        : e.message === 'NODATA' ? 'No data file found yet. The first daily run may not have finished.' : (e.message || 'Could not load data.'), 'err');
      btn.disabled = false; pw.focus();
    }
  } } },
  el('h1', { text: 'Unlock' }),
  el('p', { class: 'muted', text: 'Your leads are encrypted. Enter your passphrase to read them. Decryption happens in this browser.' }),
  el('label', { class: 'field' }, el('span', { text: 'Passphrase' }), pw),
  el('label', { class: 'check' }, rem, el('span', { text: 'Remember on this device' })),
  m, btn);
  app.append(form);
  if (note) m.set(note, 'err');
  pw.focus();
}
function onUnlocked() {
  S.view = savedLeadView();
  updateAge(); buildNav(true); route();
  if (getToken() && pendingChangeCount()) scheduleSync('pending changes');
}
function savedLeadView() {
  const saved = store.json('or.view', {}) || {};
  const { days, ...view } = saved;
  const restored = Object.assign(defaultLeadView(), { dateWindow: String(days || '') }, view);
  if (!Object.hasOwn(LEAD_DATES, restored.dateBasis)) restored.dateBasis = 'posted';
  if (!Object.hasOwn(view, 'roleScope') && view.parts?.length === LEGACY_DEFAULT_PARTS.length &&
      LEGACY_DEFAULT_PARTS.every(part => view.parts.includes(part))) restored.parts = PARTITIONS.slice();
  return restored;
}
async function boot() {
  // A batched feedback sync should not wait for the timer if the page is being hidden or closed.
  if (document.addEventListener) document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && S.syncTimer) flushSync('lead triage');
  });
  await loadSite();
  const saved = store.get('or.pass');
  if (saved) {
    try { S.data = await fetchAndDecrypt(saved); S.pass = saved; onUnlocked(); return; }
    catch (e) { showUnlock(e.message === 'BADPASS' ? 'The saved passphrase no longer works. Please enter it again.' : null); return; }
  }
  showUnlock();
}
function lock() { S.data = null; S.pass = null; S.overrides = null; stopPoll(); location.hash = ''; showUnlock(); }

/* ---------- nav / routing ---------- */
function buildNav(show) {
  const nav = document.getElementById('nav'); clear(nav); nav.hidden = !show;
  if (!show) return;
  for (const [k, label, ico] of NAV) nav.append(el('a', { href: '#' + k, 'data-k': k }, el('span', { class: 'ico', 'aria-hidden': 'true', text: ico }), el('span', { text: label })));
}
function route() {
  if (!S.data) return;
  stopPollIfLeaving();
  const hash = (location.hash || '#today').slice(1);
  const [name, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  for (const a of document.querySelectorAll('#nav a')) {
    if (a.dataset.k === (name === 'lead' ? 'leads' : MORE_KEYS.includes(name) ? 'more' : name)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const app = $app(); clear(app); app.className = 'container';
  S.justMarked = {}; S.syncLine = null;
  updateAge();
  const views = { today: viewToday, leads: viewLeads, lead: () => viewLead(arg), run: viewRun, profile: viewProfile, filters: viewFilters, settings: viewSettings, followups: viewFollowups, staffing: viewStaffing, prospects: viewProspects, outreach: viewOutreach, more: viewMore, review: viewReview };
  (views[name] || viewToday)(app);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
setInterval(updateAge, 60000);

/* ---------- leads ---------- */
function effRec(l) {
  return latestRecord(S.pending[l.id], S.overrides && S.overrides.lead_status && S.overrides.lead_status[l.id],
    { status: l.user_status || 'New', note: '', at: l.last_interaction_at, reason: l.status_reason || '' }) || { status: 'New' };
}
function effProspectRec(p) {
  return latestRecord(S.pendingProspects[p.id], S.overrides && S.overrides.prospect_status && S.overrides.prospect_status[p.id],
    { status: p.user_status || 'New', note: '', at: p.last_interaction_at }) || { status: 'New' };
}
const DRAFT_STOP_STATES = ['Won', 'Lost', 'Rejected', NOT_A_FIT, 'Opted out', 'Snoozed'];
function locallySuppressed(obj) {
  if (obj.suppressed) return true;
  const key = obj.company_key || String(obj.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const events = S.pendingEvents.concat((S.overrides && S.overrides.interaction_events) || []);
  return events.some(e => {
    if (e.owner_key !== ownerKey() || e.status !== 'Opted out') return false;
    const rows = e.subject_type === 'prospect' ? S.data.prospects : S.data.leads;
    const other = (rows || []).find(x => x.id === e.subject_id);
    if (!other) return false;
    const otherKey = other.company_key || String(other.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return (key && key === otherKey) || other === obj;
  });
}
function canDraftNow(obj, kit, prospect = false) {
  const rec = prospect ? effProspectRec(obj) : effRec(obj);
  return !!kit && kit.ready === true && !DRAFT_STOP_STATES.includes(rec.status) &&
    String(obj.status || 'OPEN').toUpperCase() === 'OPEN' && !locallySuppressed(obj) &&
    (prospect || !verificationNeedsRebuild(obj));
}
const RECHECK_TEXT = { open: 'still online', closed: 'gone, marked closed', blocked: 'the site refused the check',
  unclear: 'could not confirm', error: 'the site did not answer' };
function recheckText(r) {
  if (!r || !Object.prototype.hasOwnProperty.call(RECHECK_TEXT, r.result)) return null;
  const what = RECHECK_TEXT[r.result] + (Number.isInteger(r.http) ? ' (HTTP ' + r.http + ')' : '');
  return r.at ? fmtDate(r.at) + ': ' + what : what;
}
function leadVerification(lead) {
  return latestRecord(S.pendingVerifications[lead.id], S.overrides?.lead_verifications?.[lead.id], lead.verification);
}
function verificationNeedsRebuild(lead) {
  const verification = leadVerification(lead);
  const changed = verification && verification.revision === lead.verification_revision &&
    verification.event_id !== lead.verification?.event_id;
  const expired = lead.verification_current && parseDate(lead.verification?.occurred_at) < Date.now() - 30 * DAY_MS;
  return changed || expired;
}
function todayItems(items = (S.data.acquisition && S.data.acquisition.today) || []) {
  return items.filter(row => {
    const prospect = row.subject_type === 'prospect';
    const obj = (prospect ? S.data.prospects : S.data.leads).find(x => x.id === row.subject_id);
    if (!obj) return false;
    const rec = prospect ? effProspectRec(obj) : effRec(obj);
    if (locallySuppressed(obj) || ['Replied', 'Interview', 'Negotiation', 'Won', 'Lost', 'Rejected', NOT_A_FIT, 'Opted out', 'Snoozed'].includes(rec.status)) return false;
    if (!prospect && verificationNeedsRebuild(obj) &&
        (leadVerification(obj)?.eligibility === 'restricted' || row.action === 'review_application' || row.action === 'follow_up')) return false;
    if (row.action === 'follow_up') {
      if (obj.reply_seen_at) return false;  // your email shows a reply: Inbox updates covers it (A4/A5)
      const kit = prospect ? obj.draft : selKit(obj);
      return canFollowUp(obj, kit, rec) && dueDate(obj, rec) != null && dueDate(obj, rec) <= Date.now();
    }
    return !['Applied', 'Contacted'].includes(rec.status);
  });
}
function sourceStatus(status) {
  return status === 'partial' ? 'partial results' : String(status || 'unknown').replace(/_/g, ' ');
}
function searchSummary(search) {
  return `${search.completed} of ${search.requests} searches completed, ${search.empty} empty. ` +
    `${search.returned} results returned, ${search.accepted} accepted, ${search.off_target} off-target.`;
}
/* ---------- Today → Ask before applying (one Needs-verification lead at a time) ---------- */
function askQueueCfg() { const q = S.data && S.data.acquisition && S.data.acquisition.ask_queue; return q && q.enabled === true ? q : null; }
function askCandidates() {
  const skipped = S.askSkipped || [];
  return (S.data.leads || []).filter(l => l.eligibility_question && String(l.status || 'OPEN').toUpperCase() === 'OPEN' &&
    TRIAGE_OPEN.includes(effRec(l).status || 'New') && !locallySuppressed(l) && !skipped.includes(l.id) && !leadVerification(l))
    .sort((a, b) => (a.possible_ghost ? 1 : 0) - (b.possible_ghost ? 1 : 0) || (b.score || 0) - (a.score || 0)
      || (parseDate(b.date_discovered) || 0) - (parseDate(a.date_discovered) || 0));
}
function askQueueSection(rerender) {
  const q = askQueueCfg(); if (!q) return null;
  const items = askCandidates(); const msg = S.askMsg;
  if (!items.length && !msg) return null;
  const days = q.follow_up_days || 4;
  const box = el('section', { class: 'card ask-queue', 'data-role': 'ask-queue' }, el('h2', { text: 'Ask before applying' }),
    el('p', { class: 'small muted', text: items.length ? items.length + (items.length === 1 ? ' lead needs' : ' leads need') +
      ' one question before you apply: are India-based contractors OK? Nothing is sent for you.' : 'No leads are waiting for an eligibility question.' }));
  if (msg) {
    const undo = msg.undo ? el('button', { type: 'button', class: 'small-btn', text: 'Undo', on: { click: () => {
      const l = (S.data.leads || []).find(x => x.id === msg.undo.id);
      if (l) {
        newInteraction('opportunity', l, msg.undo.prev, 'Undo: eligibility question not sent', null, 'status', '', null, 'Contacted');
        scheduleSync('undo eligibility question');
      }
      S.askMsg = null; rerender();
    } } }) : null;
    box.append(el('p', { class: 'msg ok' }, el('span', { text: msg.text + ' ' }), undo));
  }
  const l = items[0];
  if (!l) return box;
  const asked = channel => () => {
    const prev = effRec(l).status || 'New';
    newInteraction('opportunity', l, 'Contacted', 'Eligibility question sent (' + (channel === 'email' ? 'email' : 'site or LinkedIn') + ')',
      days, 'status', channel, null, prev);
    S.justMarked[l.id] = true;
    S.askMsg = { text: 'Marked as asked: ' + (l.title || 'lead') + '. Follow-up reminder in ' + days + ' days.', undo: { id: l.id, prev } };
    scheduleSync('eligibility question');
    rerender();
  };
  const m = msgBox();
  const where = [l.company, l.work_location && l.work_location !== 'Not stated' ? l.work_location : null].filter(Boolean).join(' · ');
  box.append(el('article', { class: 'ask', 'data-lead': l.id },
    el('p', { class: 'small muted', text: '1 of ' + items.length + (l.track_name ? ' · ' + l.track_name : '') }),
    el('h3', null, el('a', { href: '#lead/' + encodeURIComponent(l.id), text: l.title || '(untitled)' })),
    where ? el('p', { class: 'small', text: where }) : null,
    el('p', { class: 'ask-text', text: l.eligibility_question }),
    el('div', { class: 'btn-row' }, copyBtn('Copy question', () => l.eligibility_question, m, 'primary'),
      l.apply_url && safeUrl(l.apply_url) ? link(l.apply_url, l.lead_type === 'SIGNAL' ? 'Open post' : 'Open listing', 'btn') : null),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', text: 'Asked by email', on: { click: asked('email') } }),
      el('button', { type: 'button', text: 'Asked on the site', on: { click: asked('platform') } }),
      el('button', { type: 'button', class: 'small-btn', text: 'Skip for now', on: { click: () => {
        S.askSkipped = (S.askSkipped || []).concat(l.id); S.askMsg = null; rerender();
      } } })), m));
  return box;
}
/* ---------- inbox updates (A4): status changes proposed from your own email; each needs a tap ---------- */
const INBOX_KIND = { received: 'Application received', reply: 'Reply', interview: 'Interview invitation', rejection: 'Rejection' };
function inboxHandled() { const h = store.json('or.inboxHandled', {}); return h && typeof h === 'object' ? h : {}; }
function inboxMark(id, on = true) {
  const h = inboxHandled(); const cutoff = Date.now() - 90 * DAY_MS;
  for (const [k, at] of Object.entries(h)) if (!(at > cutoff)) delete h[k];
  if (on) h[id] = Date.now(); else delete h[id];
  store.setJson('or.inboxHandled', h);
}
function inboxRecord(it) {
  if (it.subject_type === 'staffing') {
    const c = staffAll().find(x => x.id === it.subject_id) || { id: it.subject_id, company: it.company, status: it.current };
    return { obj: c, status: staffRec(c).status };
  }
  const l = (S.data.leads || []).find(x => x.id === it.subject_id) || { id: it.subject_id, title: it.title, company: it.company, user_status: it.current };
  return { obj: l, status: effRec(l).status || 'New' };
}
// A proposal shows while the record still has the status it was made for (a tap here or anywhere else retires it).
function inboxItems() {
  const handled = inboxHandled();
  return ((S.data.acquisition || {}).inbox || []).filter(it => it && typeof it.id === 'string' && !handled[it.id] &&
    INBOX_KIND[it.kind] && typeof it.proposed === 'string' && inboxRecord(it).status === it.current);
}
function inboxSection(rerender) {
  if (!Array.isArray((S.data.acquisition || {}).inbox)) return null;  // settings.reply_detection is off
  const items = inboxItems(); const msg = S.inboxMsg;
  if (!items.length && !msg) return null;
  const box = el('section', { class: 'card inbox', 'data-role': 'inbox' }, el('h2', { text: 'Inbox updates' }),
    el('p', { class: 'small muted', text: items.length ? 'Your email suggests ' + (items.length === 1 ? 'a status change' : items.length + ' status changes') +
      '. Check the email, then tap to apply (Dismiss hides one on this device). Only the date, sender domain and type of each email are kept.' : 'No email updates are waiting.' }));
  if (msg) {
    const undo = msg.undo ? el('button', { type: 'button', class: 'small-btn', text: 'Undo', on: { click: async () => {
      const u = msg.undo; S.inboxMsg = null;
      inboxMark(u.id, false);
      if (u.staffing) await setStaffStatus(u.obj, u.prev, 'Undo: inbox update', msgBox());
      else { newInteraction('opportunity', u.obj, u.prev, 'Undo: inbox update', null, 'status', null, null, u.to); scheduleSync('undo inbox update'); }
      rerender();
    } } }) : null;
    box.append(el('p', { class: 'msg ok' }, el('span', { text: msg.text + ' ' }), undo));
  }
  for (const it of items) {
    const { obj } = inboxRecord(it);
    const staffing = it.subject_type === 'staffing';
    const name = staffing ? (obj.company || it.company || 'Staffing firm') : (obj.title || it.title || '(untitled)');
    const company = staffing ? '' : (obj.company || it.company || '');
    const t = parseDate(it.at); const when = t == null ? '' : fmtDay(t);
    const source = it.sender_domain ? 'Email from ' + it.sender_domain + (when ? ', ' + when : '') : 'Email' + (when ? ' of ' + when : '');
    const kind = INBOX_KIND[it.kind];
    const m = msgBox();
    const dismiss = el('button', { type: 'button', class: 'small-btn', text: 'Dismiss', 'aria-label': 'Dismiss this update for ' + name,
      on: { click: () => { inboxMark(it.id); S.inboxMsg = null; rerender(); } } });
    const apply = el('button', { type: 'button', class: 'primary', text: 'Set to ' + it.proposed, on: { click: async () => {
      apply.disabled = true; dismiss.disabled = true;
      const note = kind + ' email' + (it.sender_domain ? ' from ' + it.sender_domain : '') + (t == null ? '' : ', ' + fmtDay(t));
      inboxMark(it.id);
      if (staffing) await setStaffStatus(obj, it.proposed, note, m);
      else { newInteraction('opportunity', obj, it.proposed, note, null, 'status', null, null, it.current); S.justMarked[obj.id] = true; scheduleSync('inbox: ' + it.proposed.toLowerCase()); }
      S.inboxMsg = { text: name + ': set to ' + it.proposed + '.', undo: { id: it.id, obj, prev: it.current, to: it.proposed, staffing } };
      rerender();
    } } });
    const buttons = el('div', { class: 'btn-row' }, apply, dismiss);
    box.append(el('article', { class: 'inbox-item', 'data-signal': it.id },
      el('span', { class: 'pill ' + ({ rejection: 'bad', interview: 'ok', reply: 'ok' }[it.kind] || 'track'), text: kind }),
      el('h3', null, el('a', { href: staffing ? '#staffing' : '#lead/' + encodeURIComponent(it.subject_id), text: name })),
      company ? el('p', { class: 'small', text: company }) : null,
      el('p', { class: 'small muted', text: source + '. ' + it.current + ' → ' + it.proposed + '?' }), buttons, m));
  }
  return box;
}
function viewToday(app) {
  const acquisition = S.data.acquisition || {};
  const pending = pendingChangeCount();
  app.append(el('h1', { text: 'Today' }), el('p', { class: 'muted', text: acquisition.focus || 'International SFCC/OMS freelance contracts' }));
  if (pending) app.append(el('p', { class: 'msg warn', text: deviceText(pending + ' action(s) saved on this device, awaiting sync.') }));
  const reviewCard = reviewTodayCard();
  if (reviewCard) app.append(reviewCard);
  const inboxHolder = el('div');
  const renderInbox = () => { clear(inboxHolder); const section = inboxSection(renderInbox); if (section) inboxHolder.append(section); };
  renderInbox();
  app.append(inboxHolder);
  const askHolder = el('div');
  const renderAsk = () => { clear(askHolder); const section = askQueueSection(renderAsk); if (section) askHolder.append(section); };
  renderAsk();
  app.append(askHolder);
  const gaps = gapItems();
  if (gaps && gaps.length) app.append(el('p', { class: 'small', 'data-role': 'gap-link' },
    el('a', { href: '#profile', text: gaps.length === 1 ? '1 skill question' : gaps.length + ' skill questions' }),
    ": your leads keep naming skills your profiles don't list."));
  app.append(el('p', { class: 'small muted', text: 'Review each opportunity before acting. This list and the weekly totals refresh when the site rebuilds.' }));
  const labels = { follow_up: 'Review follow-up', review_application: 'Review application', verify_eligibility: 'Check eligibility',
    prepare_evidence: 'Complete evidence', review_outreach: 'Review outreach', review_hiring_post: 'Check hiring post',
    review_specialist_scope: 'Check specialist scope' };
  // The ask queue above covers "Check eligibility" for leads that have a ready question.
  const asking = askQueueCfg() ? new Set((S.data.leads || []).filter(l => l.eligibility_question).map(l => l.id)) : new Set();
  const rows = todayItems().filter(row => !(row.action === 'verify_eligibility' && asking.has(row.subject_id)));
  const renderCard = row => el('article', { class: 'card', 'data-action': row.action },
    el('span', { class: 'pill', text: labels[row.action] || row.action }),
    el('h2', null, el('a', { href: row.subject_type === 'prospect' ? '#prospects/' + encodeURIComponent(row.subject_id) : '#lead/' + encodeURIComponent(row.subject_id), text: row.title || row.company })),
    el('p', { class: 'small muted', text: row.company || '' }), el('p', { text: row.reason || '' }),
    row.due_at ? el('p', { class: 'small', text: 'Due: ' + fmtDate(row.due_at) }) : null);
  const cards = el('div', { class: 'cards one' }, rows.map(renderCard));
  if (!rows.length) cards.append(el('p', { class: 'card muted', text: 'No SFCC/OMS contract actions meet the current checks.' }));
  app.append(cards);
  const review = todayItems(acquisition.review || []);
  if (review.length) app.append(el('section', null, el('h2', { text: 'Hiring posts and scope to verify' }),
    el('div', { class: 'cards one' }, review.map(renderCard))));
  const checks = acquisition.checks;
  if (checks) {
    const detail = el('details', { class: 'card', open: !rows.length }, el('summary', { text: 'Today screening results' }),
      el('p', { class: 'small', text: `${checks.leads} leads and ${checks.prospects} agency prospects screened at the last rebuild. ${checks.actionable} matched an action, and ${checks.needs_scope_review} need an original post or scope check.` }));
    if ((checks.reasons || []).length) detail.append(el('ul', { class: 'plain' }, checks.reasons.map(row =>
      el('li', { text: row.label + ' · ' + [row.leads ? row.leads + ' leads' : '', row.prospects ? row.prospects + ' prospects' : ''].filter(Boolean).join(', ') }))));
    app.append(detail);
  }
  const weekly = acquisition.weekly || {}; const totals = weekly.totals || {};
  const metrics = [['contacted', 'Applied / contacted'], ['replied', 'Replied'], ['interview', 'Calls / interviews'], ['won', 'Paid engagements'], ['lost', 'Lost']];
  const summary = el('section', { class: 'card' }, el('h2', { text: 'Last 7 days' }),
    el('p', { class: 'small muted', text: 'Recorded actions for your identity only. Counts show subjects reaching each stage during this window; they are not conversion rates.' }),
    el('div', { class: 'grid-fields' }, metrics.map(([key, label]) => el('div', null, el('strong', { text: String(totals[key] || 0) }), el('div', { class: 'small', text: label })))));
  for (const row of weekly.by_source || []) summary.append(el('p', { class: 'small', text: row.source + ' · ' + (row.subject_type === 'prospect' ? 'Agency prospects' : 'Applications') + ' · ' + metrics.map(([key, label]) => label + ': ' + (row[key] || 0)).join(' · ') }));
  app.append(summary);
  if (acquisition.funnel) app.append(funnelCard(acquisition.funnel));
  const sources = el('details', { class: 'card' }, el('summary', { text: 'Source readiness' }));
  for (const source of acquisition.sources || []) sources.append(el('p', { class: 'small' },
    [source.key + ' · ' + sourceStatus(source.status), source.action,
      source.checked_at && source.status !== 'success' && 'Status checked ' + fmtDate(source.checked_at),
      source.last_success_at && 'Last successful fetch ' + fmtDate(source.last_success_at),
      source.eligible_after && 'Eligible to fetch again ' + fmtDate(source.eligible_after)].filter(Boolean).join(' · '),
    source.search ? el('span', { class: 'search-summary muted', text: [
      source.search_checked_at && 'Last search ' + fmtDate(source.search_checked_at), searchSummary(source.search),
    ].filter(Boolean).join(' · ') }) : null));
  app.append(sources);
  if ((acquisition.public_searches || []).length) app.append(el('details', { class: 'card' },
    el('summary', { text: 'Search public posts and jobs' }),
    el('ul', { class: 'plain' }, acquisition.public_searches.map(search => el('li', null, link(search.url, search.label))))));
  if (getToken() && !S.overrides) ensureOverrides().then(ov => { if (ov && (location.hash === '#today' || !location.hash)) route(); });
}
const FUNNEL_LABELS = { new: 'New', relevant: 'Relevant', reviewed: 'Reviewed', applied: 'Applied', replied: 'Replied', interview: 'Interview' };
const CHANNEL_LABELS = { email: 'Email', application_form: 'Application form', platform: 'Platform', hn_reply: 'HN reply',
  contact_form: 'Contact form', manual: 'Manual', unknown: 'Channel not recorded', 'staffing firm': 'Staffing firms' };
function funnelCard(f) {
  const stages = (f.stages && f.stages.length ? f.stages : Object.keys(FUNNEL_LABELS)).filter(k => FUNNEL_LABELS[k]);
  const totals = f.totals || {};
  const line = (row, keys) => keys.map(k => (row[k] || 0) + ' ' + FUNNEL_LABELS[k].toLowerCase()).join(' → ');
  const sources = (f.by_source || []).filter(r => stages.some(k => r[k]));
  const channels = (f.by_channel || []).filter(r => r.applied || r.replied || r.interview);
  return el('section', { class: 'card', 'data-role': 'funnel' },
    el('h2', { text: 'Weekly funnel' }),
    el('p', { class: 'small muted', text: 'Last ' + (f.days || 7) + ' days of recorded activity, not a cohort. New: first found. Relevant: not excluded. Reviewed: any status you set.' }),
    el('div', { class: 'funnel' }, stages.map(k => el('div', { class: 'funnel-step' }, el('strong', { text: String(totals[k] || 0) }), el('span', { class: 'small', text: FUNNEL_LABELS[k] })))),
    sources.length ? el('details', null, el('summary', { text: 'By source (' + sources.length + ')' }),
      el('ul', { class: 'plain small' }, sources.map(r => el('li', null, el('strong', { text: String(r.source).replace(/^prospects:/, 'agency prospects · ') }), ': ' + line(r, stages))))) : null,
    channels.length ? el('details', null, el('summary', { text: 'By channel (' + channels.length + ')' }),
      el('ul', { class: 'plain small' }, channels.map(r => el('li', null, el('strong', { text: CHANNEL_LABELS[r.channel] || r.channel }), ': ' + line(r, ['applied', 'replied', 'interview'])))))
      : el('p', { class: 'small muted', text: 'No applications or contacts recorded in this window yet. Use Applied / Not a fit on lead cards.' }));
}
function effStatus(l) { return effRec(l).status || 'New'; }
function sourcesOf(l) { return (l.source_links || []).map(s => s.source).filter(Boolean); }
function leadPlatform(value) {
  if (!/^https?:\/\//i.test(value || '') || /[\s\\]/.test(value)) return '';
  let url;
  try { url = new URL(value); } catch (e) { return ''; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return '';
  const { hostname, pathname } = url;
  if (/^(?:(?:www|[a-z]{2})\.)?linkedin\.com$/.test(hostname)) {
    if (/^\/(?:comm\/)?jobs\/view\/(?:[^/]+-)?\d+\/?$/i.test(pathname)) return 'LinkedIn jobs';
    if (/^\/(?:posts\/[^/]+|feed\/update\/urn:li:activity:\d+)\/?$/i.test(pathname.replace(/%3a/ig, ':'))) return 'LinkedIn posts';
    return '';
  }
  if (hostname === 'news.ycombinator.com' && pathname === '/item' && /^\d+$/.test(url.searchParams.get('id') || '')) return 'Hacker News';
  return LEAD_COMMUNITIES.find(([, host, path]) => host.test(hostname) && path.test(pathname))?.[0] || '';
}
function uniq(arr) { return Array.from(new Set(arr.filter(x => x != null && x !== ''))).sort(); }
function defaultLeadView() {
  return { roleScope: 'exact', q: '', parts: PARTITIONS.slice(), elig: '', ctype: '', country: '', currency: '', source: '', platform: '',
    minScore: '', ltype: '', status: '', crm: '', sort: 'best', dateBasis: 'posted', dateWindow: '', dateFrom: '', dateTo: '' };
}
function hasExactRoleData(leads) {
  return !leads.length || leads.some(l => typeof l.exact_role_match === 'boolean');
}
function leadDateRange(v, now) {
  if (v.dateWindow === 'custom') {
    const start = v.dateFrom ? new Date(v.dateFrom + 'T00:00:00') : null;
    const end = v.dateTo ? new Date(v.dateTo + 'T00:00:00') : null;
    if (end) end.setDate(end.getDate() + 1);
    return { start: start?.getTime(), end: end?.getTime(), invalid: !!(start && end && start >= end) };
  }
  if (v.dateWindow === 'today') {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return { start: today.getTime(), end: today.setDate(today.getDate() + 1) };
  }
  const days = Number(v.dateWindow);
  return days > 0 ? { start: now - days * DAY_MS, end: now + 1 } : {};
}
function compareLeadDates(a, b, oldest) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return oldest ? a - b : b - a;
}
function filterLeads(now = Date.now()) {
  const v = S.view; const q = v.q.trim().toLowerCase();
  const exact = v.roleScope !== 'all' && hasExactRoleData(S.data.leads);
  const date = LEAD_DATES[v.dateBasis] || LEAD_DATES.posted;
  const { start, end, invalid } = leadDateRange(v, now);
  if (invalid) return [];
  const dates = new Map();
  const fb = feedbackCfg();
  const hideNotAFit = !!(fb && fb.hide_not_a_fit) && !v.crm;
  let hiddenNotAFit = 0;
  const out = S.data.leads.filter(l => {
    if (exact && l.exact_role_match !== true) return false;
    if (hideNotAFit && !S.justMarked[l.id] && effStatus(l) === NOT_A_FIT) { hiddenNotAFit++; return false; }
    if (!v.parts.includes(l.partition)) return false;
    if (q && !((l.title || '') + ' ' + (l.company || '') + ' ' + (l.description || '')).toLowerCase().includes(q)) return false;
    if (v.elig && l.eligibility !== v.elig) return false;
    if (v.ctype && l.contract_type !== v.ctype) return false;
    if (v.country && l.company_country !== v.country) return false;
    if (v.currency && l.pay_currency !== v.currency) return false;
    if (v.source && !sourcesOf(l).includes(v.source)) return false;
    if (v.platform && ![l.apply_url, ...(l.source_links || []).map(s => s.url)].some(url => leadPlatform(url) === v.platform)) return false;
    if (v.minScore !== '' && !(l.score >= Number(v.minScore))) return false;
    if (v.ltype && l.lead_type !== v.ltype) return false;
    if (v.status && l.status !== v.status) return false;
    if (v.crm && effStatus(l) !== v.crm) return false;
    const t = parseDate(l[date.field]);
    if (v.dateWindow === 'unknown' && date === LEAD_DATES.posted && t != null) return false;
    if ((start != null || end != null) && (t == null || t < (start ?? -Infinity) || t >= (end ?? Infinity))) return false;
    dates.set(l, t);
    return true;
  });
  const PR = { 'Qualified': 3, 'Needs verification': 2, 'Adjacent/Stretch': 1, 'Excluded': 0 };
  const rank = {
    best: (a, b) => (PR[b.partition] ?? 0) - (PR[a.partition] ?? 0)
      || (a.possible_ghost ? 1 : 0) - (b.possible_ghost ? 1 : 0)  // possible ghosts (M8) last in their partition
      || Math.floor((b.score ?? 0) / 5) - Math.floor((a.score ?? 0) / 5),
    score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    pay: (a, b) => (b.usd_hourly ?? -1) - (a.usd_hourly ?? -1),
  }[v.sort];
  out.sort((a, b) => (rank ? rank(a, b) : 0)
    || compareLeadDates(dates.get(a), dates.get(b), v.sort === 'oldest')
    || String(a.id).localeCompare(String(b.id)));
  out.hiddenNotAFit = hiddenNotAFit;
  return out;
}
function leadDateValue(l, basis) {
  const date = LEAD_DATES[basis] || LEAD_DATES.posted;
  const t = parseDate(l[date.field]);
  if (t == null) return '';
  if (date === LEAD_DATES.posted && l.posting_date_estimated) {
    return DATE_FORMAT.format(t) + ' (estimated)';
  }
  return DATE_TIME_FORMAT.format(t);
}
function leadDateLabel(l, basis) {
  const when = leadDateValue(l, basis);
  if (when) return LEAD_DATES[basis].label + ' ' + when;
  return { posted: 'Posting date unknown', found: 'First-found date unknown', changed: 'No recorded change' }[basis];
}
function leadCard(l, basis = 'posted') {
  const href = '#lead/' + encodeURIComponent(l.id);
  if (!feedbackCfg()) return el('a', { class: 'lead-card', href }, ...leadCardContent(l, basis));
  const card = el('article', { class: 'lead-card has-actions', 'data-id': l.id });
  const render = () => { clear(card); card.append(el('a', { class: 'lead-link', href }, ...leadCardContent(l, basis)), leadActions(l, render)); };
  render();
  return card;
}
function leadCardContent(l, basis) {
  const pc = partClass(l.partition);
  const st = effStatus(l);
  const meta1 = [l.company, l.company_country && l.company_country !== 'UNKNOWN' ? l.company_country : null, l.contract_type && l.contract_type !== 'UNKNOWN' ? l.contract_type.replace('_', ' ') : null].filter(Boolean).join(' · ');
  const eligCls = /^CONFIRMED/.test(l.eligibility || '') ? 'ok' : /^RESTRICTED/.test(l.eligibility || '') ? 'bad' : 'warn';
  return [
    el('div', { class: 'score ' + pc, 'aria-label': 'Score ' + Math.round(l.score || 0), text: String(Math.round(l.score || 0)) }),
    el('div', { class: 'lead-body' },
      el('div', { class: 'lead-title', text: l.title || '(untitled)' }),
      el('div', { class: 'meta', text: meta1 }),
      el('div', { class: 'meta' }, el('span', { class: 'pill ' + pc, text: l.partition }), l.track_name ? el('span', { class: 'pill track', text: l.track_name }) : null, el('span', { class: 'pill ' + eligCls, text: (l.eligibility || '').replace(/_/g, ' ').toLowerCase() }),
        l.possible_ghost ? el('span', { class: 'pill warn', 'data-role': 'ghost', text: 'possible ghost' }) : null,
        warmCfg() && leadPeople(l).length ? el('span', { class: 'pill ok', 'data-role': 'warm', text: 'you know ' + leadPeople(l).length }) : null),
      el('div', { class: 'meta' }, l.pay_text ? el('span', { text: l.pay_text }) : null, l.hours_per_week ? el('span', { text: l.hours_per_week + ' h/wk' }) : null,
        el('span', { text: 'CRM: ' + st })),
      el('div', { class: 'meta' }, el('span', { text: leadDateLabel(l, basis) }),
        basis === 'posted' && parseDate(l.date_posted) == null && parseDate(l.date_discovered) != null
          ? el('span', { text: leadDateLabel(l, 'found') }) : null))];
}

/* ---------- one-tap feedback (Applied / Not a fit + reason) ---------- */
const TRIAGE_OPEN = ['New', 'Saved', 'Researching'];
function feedbackCfg() { const f = S.data && S.data.feedback; return f && f.enabled === true ? f : null; }
function feedbackReasons() { return ((feedbackCfg() || {}).reasons || []).filter(r => r && r.key); }
function reasonLabel(code) {
  const hit = feedbackReasons().find(r => r.key === code) ||
    Object.entries((S.data && S.data.learning && S.data.learning.reason_labels) || {}).map(([key, label]) => ({ key, label })).find(r => r.key === code);
  return hit ? hit.label : String(code || '').replace(/_/g, ' ');
}
function syncNote(text, kind) { if (S.syncLine && S.syncLine.set) S.syncLine.set(text, kind); }
function scheduleSync(label) {
  if (!getToken()) { syncNote(pendingChangeCount() + ' change(s) saved on this device. Add a GitHub token in Settings to sync.', 'ok'); return; }
  const delay = Math.max(0, Number((feedbackCfg() || {}).sync_delay_seconds ?? 6)) * 1000;
  clearTimeout(S.syncTimer);
  syncNote('Saved on this device. Syncing to GitHub in a few seconds…');
  S.syncTimer = setTimeout(() => flushSync(label), delay);
}
async function flushSync(label) {
  clearTimeout(S.syncTimer); S.syncTimer = null;
  if (!getToken() || !pendingChangeCount()) return false;
  if (S.syncing) { S.syncAgain = true; return false; }
  S.syncing = true;
  syncNote('Syncing…');
  try {
    await saveOverrides(() => {}, 'Feedback: ' + (label || 'lead triage'));
    syncNote('Synced to GitHub. The next rebuild applies it.', 'ok');
    return true;
  } catch (e) {
    syncNote((e.message || 'Sync failed') + ' Your changes are kept on this device and will sync on the next save.', 'err');
    return false;
  } finally {
    S.syncing = false;
    if (S.syncAgain) { S.syncAgain = false; scheduleSync(label); }
  }
}
function quickStatus(l, status, reason, rerender) {
  const prev = effRec(l);
  let days = null; let channel = ''; let note = '';
  if (status === 'Applied') {
    const k = selKit(l);
    days = k && k.follow_up_allowed && k.channel === 'email' ? 4 : 0;
    channel = (k && k.channel) || '';
    note = 'applied (one-tap' + (k ? ', ' + (k.track_name || k.track) : '') + ')';
  }
  newInteraction('opportunity', l, status, note, days, 'status', channel, status === NOT_A_FIT ? (reason || 'other') : null, prev.status || 'New');
  S.justMarked[l.id] = true;
  if (rerender) rerender();
  scheduleSync(status === NOT_A_FIT ? 'not a fit (' + (reason || 'other') + ')' : String(status).toLowerCase());
}
function leadActions(l, rerender) {
  const rec = effRec(l); const st = rec.status || 'New';
  const box = el('div', { class: 'lead-actions' });
  if (!TRIAGE_OPEN.includes(st)) {
    const undo = S.justMarked[l.id] && rec.previous_status
      ? el('button', { type: 'button', class: 'small-btn', text: 'Undo', 'aria-label': 'Undo ' + st + ' for ' + (l.title || 'this lead'),
        on: { click: () => quickStatus(l, rec.previous_status, null, rerender) } }) : null;
    box.append(el('div', { class: 'lead-actions-row' },
      el('span', { class: 'pill ' + (st === NOT_A_FIT ? 'bad' : st === 'Applied' || st === 'Contacted' ? 'ok' : 'track'),
        text: st === NOT_A_FIT ? 'Not a fit' + (rec.reason ? ' · ' + reasonLabel(rec.reason) : '') : st }), undo));
    return box;
  }
  const reasons = el('div', { class: 'reason-chips', role: 'group', 'aria-label': 'Why is this not a fit?', hidden: true },
    feedbackReasons().map(r => el('button', { type: 'button', class: 'chip small', text: r.label,
      on: { click: () => quickStatus(l, NOT_A_FIT, r.key, rerender) } })));
  const notFit = el('button', { type: 'button', class: 'small-btn', 'aria-expanded': 'false', text: 'Not a fit' });
  notFit.addEventListener('click', () => { reasons.hidden = !reasons.hidden; notFit.setAttribute('aria-expanded', String(!reasons.hidden)); });
  const m = msgBox();
  box.append(el('div', { class: 'lead-actions-row' },
    el('button', { type: 'button', class: 'small-btn', text: 'Applied', 'aria-label': 'Mark applied: ' + (l.title || 'this lead'),
      on: { click: () => quickStatus(l, 'Applied', null, rerender) } }), notFit,
    l.eligibility_question ? copyBtn('Copy eligibility question', () => l.eligibility_question, m, 'small-btn') : null), reasons, m);
  return box;
}
function viewLeads(app) {
  const d = S.data; const v = S.view;
  const sources = uniq(d.leads.flatMap(sourcesOf));
  const scopeAvailable = hasExactRoleData(d.leads);
  const exact = () => scopeAvailable && v.roleScope !== 'all';
  const persist = () => { if (!v.temp) store.setJson('or.view', v); };
  const listBox = el('div', { class: 'cards' });
  const countLine = el('div', { class: 'count-line', role: 'status', 'aria-live': 'polite' });
  const chipsBox = el('div', { class: 'chips', role: 'group', 'aria-label': 'Partitions' });
  const update = () => {
    persist();
    const res = filterLeads();
    clear(listBox);
    const frag = document.createDocumentFragment();
    for (const l of res) frag.append(leadCard(l, v.dateBasis));
    listBox.append(frag);
    countLine.textContent = `${res.length} of ${d.leads.length} leads · ${sources.length} collection ${sources.length === 1 ? 'source' : 'sources'}` +
      (res.hiddenNotAFit ? ` · ${res.hiddenNotAFit} marked Not a fit hidden (CRM status filter shows them)` : '');
    exactButton.setAttribute('aria-pressed', String(exact()));
    allButton.setAttribute('aria-pressed', String(!exact()));
    if (!res.length) listBox.append(el('p', { class: 'muted', text: exact()
      ? 'No exact SFCC/OMS roles match these filters. Switch to All collected leads to widen the view.'
      : 'No leads match these filters.' }));
    clear(chipsBox);
    const scopedLeads = exact() ? d.leads.filter(l => l.exact_role_match === true) : d.leads;
    for (const p of PARTITIONS) {
      const n = scopedLeads.filter(l => l.partition === p).length;
      chipsBox.append(el('button', { class: 'chip p-' + partClass(p), type: 'button', 'aria-pressed': v.parts.includes(p) ? 'true' : 'false', text: p + ' ' + n,
        on: { click: () => { v.parts = v.parts.includes(p) ? v.parts.filter(x => x !== p) : v.parts.concat(p); update(); syncPartChecks(); } } }));
    }
  };
  const partChecks = {};
  const syncPartChecks = () => { for (const p of PARTITIONS) partChecks[p].checked = v.parts.includes(p); };
  const exactButton = el('button', { type: 'button', text: 'Exact SFCC/OMS', disabled: !scopeAvailable,
    on: { click: () => { v.roleScope = 'exact'; update(); } } });
  const allButton = el('button', { type: 'button', text: 'All collected leads',
    on: { click: () => { v.roleScope = 'all'; update(); } } });
  const scope = el('div', { class: 'lead-scope', role: 'group', 'aria-label': 'Role match' }, exactButton, allButton);
  const sel = (label, key, options, fmt) => {
    const s = el('select', { 'aria-label': label }, el('option', { value: '', text: 'Any' }), options.map(o => el('option', { value: o, text: fmt ? fmt(o) : o })));
    s.value = v[key] || '';
    s.addEventListener('change', () => { v[key] = s.value; update(); });
    return el('label', { class: 'field' }, el('span', { text: label }), s);
  };
  const search = el('input', { type: 'search', 'aria-label': 'Search', placeholder: 'Title, company, description', value: v.q });
  search.addEventListener('input', debounce(() => { v.q = search.value; update(); }, 150));
  const minScore = el('input', { type: 'number', min: '0', max: '100', inputmode: 'numeric', value: v.minScore });
  minScore.addEventListener('input', debounce(() => { v.minScore = minScore.value; update(); }, 150));
  const dateControls = leadDateControls(v, update);
  const partFs = el('fieldset', null, el('legend', { text: 'Partitions' }), el('div', { class: 'checks' }, PARTITIONS.map(p => {
    const c = el('input', { type: 'checkbox', checked: v.parts.includes(p) });
    c.addEventListener('change', () => { v.parts = c.checked ? v.parts.concat(p) : v.parts.filter(x => x !== p); update(); });
    partChecks[p] = c; return el('label', { class: 'check' }, c, el('span', { text: p }));
  })));
  const reset = el('button', { type: 'button', text: 'Reset filters', on: { click: () => { store.del('or.view'); onUnlockedKeepRoute(); } } });
  const panel = el('div', { class: 'panel', id: 'filter-panel', hidden: true }, partFs,
    el('div', { class: 'grid-fields' },
      sel('Eligibility', 'elig', uniq(d.leads.map(l => l.eligibility)), x => x.replace(/_/g, ' ').toLowerCase()),
      sel('Job type', 'ctype', uniq(d.leads.map(l => l.contract_type))),
      sel('Company country', 'country', uniq(d.leads.map(l => l.company_country))),
      sel('Currency', 'currency', uniq(d.leads.map(l => l.pay_currency))),
      sel('Collected via', 'source', sources),
      sel('Platform', 'platform', LEAD_PLATFORMS),
      el('label', { class: 'field' }, el('span', { text: 'Minimum score' }), minScore),
      sel('Lead type', 'ltype', uniq(d.leads.map(l => l.lead_type))),
      sel('Listing status', 'status', uniq(d.leads.map(l => l.status))),
      sel('CRM status', 'crm', d.crm_statuses || [])),
    reset);
  const toggle = el('button', { class: 'filters-toggle', type: 'button', 'aria-expanded': String(!panel.hidden), 'aria-controls': 'filter-panel' }, el('span', { text: 'More filters' }), el('span', { 'aria-hidden': 'true', text: '▾' }));
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  app.append(el('h1', { text: 'Leads' }), scope);
  if (v.temp) app.append(el('div', { class: 'panel temp-view', role: 'status' },
    el('span', { text: 'Showing open roles at ' + v.temp + '. Your saved filters are unchanged. ' }),
    el('button', { type: 'button', text: 'Back to my filters', on: { click: () => { S.view = savedLeadView(); route(); } } })));
  if (!scopeAvailable) app.append(el('p', { class: 'small muted', text: 'Exact role matching is available after the next data refresh.' }));
  if (d.excluded_hidden > 0 && v.parts.includes('Excluded')) app.append(el('p', { class: 'small muted', text: d.excluded_hidden + ' lower-scoring excluded leads are not shown on the phone site to keep it fast.' }));
  app.append(el('label', { class: 'field search-top' }, el('span', { class: 'sr-only', text: 'Search leads' }), search), dateControls, chipsBox, toggle, panel, countLine);
  if (feedbackCfg()) { S.syncLine = msgBox(); S.syncLine.setAttribute('data-role', 'sync-status'); app.append(S.syncLine); }
  app.append(listBox);
  update();
  if (getToken() && !S.overrides) ensureOverrides().then(ov => { if (ov && document.body.contains(listBox)) update(); });
}
function leadDateControls(v, update) {
  const option = ([value, label]) => el('option', { value, text: label });
  const field = (label, control) => el('label', { class: 'field' }, el('span', { text: label }), control);
  const basis = el('select', null, Object.entries(LEAD_DATES).map(([key, date]) => option([key, date.label])));
  const windowOptions = DATE_WINDOWS.map(option);
  const unknownOption = windowOptions[windowOptions.length - 1];
  const windowSelect = el('select', { 'aria-describedby': 'lead-date-help' }, windowOptions);
  const sort = el('select', null, [
    ['best', 'Best match, then newest'], ['newest', 'Newest first'], ['oldest', 'Oldest first'],
    ['score', 'Highest score'], ['pay', 'Highest pay (USD/hour)'],
  ].map(option));
  const from = el('input', { type: 'date', value: v.dateFrom, 'aria-describedby': 'lead-date-help' });
  const to = el('input', { type: 'date', value: v.dateTo, 'aria-describedby': 'lead-date-help' });
  const dates = el('div', { class: 'lead-date-range' }, field('From', from), field('Through', to));
  const help = el('p', { class: 'muted small date-help', id: 'lead-date-help', 'aria-live': 'polite' });
  const sync = () => {
    unknownOption.hidden = unknownOption.disabled = v.dateBasis !== 'posted';
    if (unknownOption.disabled && v.dateWindow === 'unknown') v.dateWindow = '';
    windowSelect.value = v.dateWindow;
    dates.hidden = v.dateWindow !== 'custom';
    const range = leadDateRange(v, Date.now());
    help.textContent = range.invalid ? 'The start date must be on or before the end date.'
      : v.dateWindow === 'custom' ? 'Dates use your device time. Both dates are inclusive.'
      : v.dateWindow === 'unknown' ? 'Showing leads without a posting date.'
      : v.dateBasis === 'posted' && v.dateWindow ? 'A posting date is required for this range.' : '';
  };
  for (const [control, key] of [[basis, 'dateBasis'], [windowSelect, 'dateWindow'], [sort, 'sort'], [from, 'dateFrom'], [to, 'dateTo']]) {
    control.value = v[key];
    control.addEventListener('change', () => { v[key] = control.value; sync(); update(); });
  }
  sync();
  return el('div', { class: 'card lead-date-controls' },
    el('div', { class: 'lead-date-fields' }, field('Date to use', basis), field('Date range', windowSelect), field('Sort by', sort)), dates, help);
}
function onUnlockedKeepRoute() { S.view = defaultLeadView(); route(); }

/* ---------- staffing firms & talent networks ---------- */
const STAFF_STATUSES = ['Not contacted', 'Applied to talent pool', 'Emailed recruiter', 'Replied', 'Interviewing', 'Placed', 'Not a fit', 'Do not contact'];
const STAFF_CLOSED = ['Not a fit', 'Do not contact'];
const STAFF_CONTACTED = ['Applied to talent pool', 'Emailed recruiter', 'Replied', 'Interviewing', 'Placed'];
const STAFF_TYPES = { talent_network: 'Talent network', staffing_agency: 'Staffing agency', salesforce_specialist: 'Salesforce specialist', consultancy: 'Consultancy', marketplace: 'Marketplace' };
const STAFF_HIRES = { india_ok: 'Accepts India', global: 'Global', unknown: 'India unknown', excludes_india: 'Excludes India' };
const STAFF_SORTS = [['priority', 'Priority'], ['sf', 'Salesforce first'], ['roles', 'Open roles'], ['az', 'A–Z']];
const STAFF_VIEW_KEY = 'or.staffView';
function staffData() { return (S.data && S.data.staffing) || { companies: [], problems: [], weekly_cap: 15, default_hires_from: ['india_ok', 'global', 'unknown'] }; }
function defaultStaffView() {
  return { q: '', types: [], hires: (staffData().default_hires_from || ['india_ok', 'global', 'unknown']).slice(), sf: '', tech: '', engagement: '', hq: '',
    status: '', sort: 'priority', cSf: false, cIndia: false, cRoles: false, cNew: false, cNet: false };
}
function savedStaffView() {
  const d = defaultStaffView(); const saved = store.json(STAFF_VIEW_KEY, {}) || {};
  const v = Object.assign(d, saved);
  for (const k of ['types', 'hires']) if (!Array.isArray(v[k])) v[k] = d[k];
  if (!STAFF_SORTS.some(x => x[0] === v.sort)) v.sort = 'priority';
  return v;
}
function staffRec(c) {
  const snapshot = { status: c.status, at: c.status_at, note: c.status_note, first_contact_at: c.status_first_contact_at || '' };
  if (c.status_followed_up_at) snapshot.followed_up_at = c.status_followed_up_at;
  const records = [S.pendingStaffing[c.id], S.overrides?.staffing_status?.[c.id], snapshot];
  return mergeStaffRecord(...records.filter(r => STAFF_STATUSES.includes(r?.status))) || { status: 'Not contacted' };
}
function staffStatus(c) { return staffRec(c).status; }
function staffWeekCount(now = Date.now()) {
  // Count firms first contacted in the last 7 days (a later reply or status edit does not count again).
  return staffAll().map(staffRec).filter(r =>
    STAFF_CONTACTED.includes(r.status) && (parseDate(r.first_contact_at || r.at) ?? -Infinity) >= now - 7 * DAY_MS).length;
}
function staffIsSf(c) { return c.salesforce_focus === 'yes' || c.salesforce_focus === 'partial' || (c.tech || []).some(t => t === 'salesforce' || t === 'sfcc'); }
function filterStaffing(v = S.staffView) {
  const q = v.q.trim().toLowerCase();
  const out = (staffData().companies || []).filter(c => {
    const st = staffStatus(c);
    if (v.status ? st !== v.status : STAFF_CLOSED.includes(st)) return false;
    if (q && !((c.company || '') + ' ' + (c.notes || '') + ' ' + (c.tech || []).join(' ')).toLowerCase().includes(q)) return false;
    if (v.types.length && !v.types.includes(c.type)) return false;
    if (v.hires.length && !v.hires.includes(c.hires_from)) return false;
    if (v.sf && c.salesforce_focus !== v.sf) return false;
    if (v.tech && !(c.tech || []).includes(v.tech)) return false;
    if (v.engagement && c.engagement !== v.engagement) return false;
    if (v.hq && c.hq !== v.hq) return false;
    if (v.cSf && !staffIsSf(c)) return false;
    if (v.cIndia && !['india_ok', 'global'].includes(c.hires_from)) return false;
    if (v.cRoles && !(c.open_roles > 0)) return false;
    if (v.cNew && st !== 'Not contacted') return false;
    if (v.cNet && c.type !== 'talent_network') return false;
    return true;
  });
  const sfRank = { yes: 2, partial: 1 };
  const byPri = (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || String(a.company).localeCompare(String(b.company));
  const rank = { priority: byPri, az: (a, b) => String(a.company).localeCompare(String(b.company), undefined, { sensitivity: 'base' }),
    sf: (a, b) => (sfRank[b.salesforce_focus] || 0) - (sfRank[a.salesforce_focus] || 0) || byPri(a, b),
    roles: (a, b) => (b.open_roles || 0) - (a.open_roles || 0) || byPri(a, b) }[v.sort] || byPri;
  return out.sort(rank);
}
function staffGmailHref(subject, body) {
  return safeUrl('https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || ''));
}
async function setStaffStatus(c, status, note, m, extra) {
  const now = new Date().toISOString(); const prev = staffRec(c);
  const first = prev.first_contact_at || (STAFF_CONTACTED.includes(prev.status) ? (prev.at || '') : (STAFF_CONTACTED.includes(status) ? now : ''));
  // One follow-up per "Emailed recruiter": the time it was sent stays while the status stays.
  const followed = (extra && extra.followed_up_at) || (status === prev.status && prev.followed_up_at) || '';
  S.pendingStaffing[c.id] = Object.assign({ status, note: note || '', at: now }, first ? { first_contact_at: first } : {},
    followed ? { followed_up_at: followed } : {});
  savePending();
  if (!getToken()) { m.set('Saved on this device. It will sync once you add a GitHub token in Settings.', 'ok'); return true; }
  m.set('Saving…');
  try { await saveOverrides(() => {}, 'Staffing: ' + status + ' ' + c.id); m.set('Saved and synced to GitHub.', 'ok'); return true; }
  catch (e) { m.set((e.message || 'Save failed') + ' Your change is kept on this device and will sync on the next successful save.', 'err'); return false; }
}
function staffCard(c, rerender) {
  const rec = staffRec(c); const st = rec.status; const d = c.drafts || {};
  const contactAllowed = st !== 'Do not contact';
  const draftReasons = Array.isArray(d.reasons) ? d.reasons : [];
  const draftAllowed = contactAllowed && !draftReasons.length;
  const open = S.staffOpen && S.staffOpen.id === c.id;
  const m = msgBox();
  if (open && S.staffOpen.msg) m.set(S.staffOpen.msg[0], S.staffOpen.msg[1]);
  const hcls = { india_ok: 'ok', global: 'ok', unknown: 'warn', excludes_india: 'bad' }[c.hires_from] || 'warn';
  const sources = Array.isArray(c.sources) ? c.sources.map(safeUrl).filter(Boolean) : [];
  const evidence = el('div', { class: 'small evidence', hidden: true },
    el('p', { text: c.hires_from_evidence || 'No evidence recorded.' }),
    sources.length ? el('p', null, sources.flatMap((url, i) =>
      [i ? ' · ' : '', link(url, sources.length === 1 ? 'Source' : 'Source ' + (i + 1))])) : null);
  const hbtn = el('button', { type: 'button', class: 'pill pill-btn ' + hcls, 'aria-expanded': 'false', text: STAFF_HIRES[c.hires_from] || 'India unknown' });
  hbtn.addEventListener('click', () => { evidence.hidden = !evidence.hidden; hbtn.setAttribute('aria-expanded', String(!evidence.hidden)); });
  const tech = (c.tech || []); const techShown = tech.slice(0, 6);
  const roles = contactAllowed && c.open_roles > 0 ? el('a', { class: 'pill ok', href: '#leads', text: c.open_roles + ' open role' + (c.open_roles === 1 ? '' : 's'),
    on: { click: () => { S.view = Object.assign(defaultLeadView(), { q: c.company, roleScope: 'all', parts: PARTITIONS.slice(), temp: c.company }); } } }) : null;
  const gmail = draftAllowed && (d.subject || d.body) ? staffGmailHref(d.subject, d.body) : null;
  const statusSel = el('select', { 'aria-label': 'Status for ' + c.company }, STAFF_STATUSES.map(x => el('option', { value: x, text: x })));
  statusSel.value = st;
  const note = el('input', { type: 'text', 'aria-label': 'Note', placeholder: 'Note (optional)', maxlength: '300', value: rec.note || '' });
  const save = el('button', { type: 'button', class: 'primary', text: 'Save status', on: { click: async () => {
    save.disabled = true;
    S.staffOpen = { id: c.id, msg: null };
    const ok = await setStaffStatus(c, statusSel.value, note.value.trim(), m);
    S.staffOpen = { id: c.id, msg: [ok ? 'Saved' + (getToken() ? ' and synced to GitHub.' : ' on this device. It will sync once you add a GitHub token in Settings.') : 'Saved on this device; sync failed. It will retry on the next save.', ok ? 'ok' : 'err'] };
    rerender();
  } } });
  const emailedAt = parseDate(rec.at);
  const canFu = draftAllowed && st === 'Emailed recruiter' && emailedAt != null && Date.now() - emailedAt >= 7 * DAY_MS
    && (d.follow_up?.body || d.follow_up?.subject) && !rec.followed_up_at;
  const hasDrafts = draftAllowed && (d.body || d.talent_pool_note || gmail || canFu || d.resume_url);
  const draftsBox = el('details', { class: 'staff-more', open: open || null },
    el('summary', { text: hasDrafts ? 'Drafts & status' : 'Status' }),
    contactAllowed && draftReasons.length ? el('ul', { class: 'plain small' }, draftReasons.map(reason => el('li', { text: reason }))) : null,
    gmail ? el('p', { class: 'small muted', text: 'Add the firm’s published careers address in Gmail and review your draft.' }) : null,
    hasDrafts ? el('div', { class: 'btn-row' },
      d.body ? copyBtn('Copy recruiter note', () => (d.subject ? d.subject + '\n\n' : '') + d.body, m) : null,
      d.talent_pool_note ? copyBtn('Copy talent-pool note', () => d.talent_pool_note, m) : null,
      gmail ? link(gmail, 'Open in Gmail', 'btn') : null,
      canFu ? copyBtn('Copy follow-up', () => (d.follow_up.subject ? d.follow_up.subject + '\n\n' : '') + (d.follow_up.body || ''), m) : null,
      d.resume_url ? link(d.resume_url, 'Resume link', 'btn') : null) : null,
    el('label', { class: 'field' }, el('span', { text: 'Status' }), statusSel),
    el('label', { class: 'field' }, el('span', { text: 'Note' }), note),
    el('div', { class: 'btn-row' }, save), m);
  return el('article', { class: 'card staff-card', 'data-id': c.id },
    el('div', { class: 'staff-head' }, el('h2', { text: c.company }), el('span', { class: 'small muted', text: c.hq || '' })),
    el('div', { class: 'meta' }, el('span', { class: 'pill', text: STAFF_TYPES[c.type] || c.type || 'Other' }), hbtn,
      c.salesforce_focus === 'yes' || c.salesforce_focus === 'partial' ? el('span', { class: 'pill Adjacent', text: c.salesforce_focus === 'yes' ? 'Salesforce' : 'Some Salesforce' }) : null,
      roles, st !== 'Not contacted' ? el('span', { class: 'pill track', text: st }) : null),
    evidence,
    tech.length ? el('div', { class: 'skills' }, techShown.map(t => el('span', { class: 'skill', text: t })), tech.length > 6 ? el('span', { class: 'skill', text: '+' + (tech.length - 6) }) : null) : null,
    c.why && c.why.length ? el('p', { class: 'small', text: c.why.join(' · ') }) : null,
    el('p', { class: 'small muted', text: c.verified_on ? 'Verified ' + c.verified_on : 'unverified' }),
    el('div', { class: 'btn-row' },
      contactAllowed && c.apply_url ? link(c.apply_url, 'Join talent pool / Apply', 'btn primary') : null,
      c.website ? link(c.website, 'Website', 'btn') : null,
      contactAllowed && c.contact_url ? link(c.contact_url, 'Contact page', 'btn') : null),
    draftsBox);
}
/* Weekly queue (staffing.weekly_queue): the next Salesforce/SFCC firms to contact, paced per rolling 7 days, and the
   firms whose "Emailed recruiter" is old enough for their one follow-up. Drafts only; Gmail opens without a recipient. */
function staffQueueCfg() { const q = staffData().queue; return q && typeof q === 'object' && Number(q.size) > 0 ? q : null; }
function staffDraftsBlocked(c) { const d = c.drafts || {}; return Array.isArray(d.reasons) && d.reasons.length > 0; }
function staffQueuePool(q) {
  const hires = Array.isArray(q.hires_from) ? q.hires_from : ['india_ok', 'global', 'unknown'];
  return (staffData().companies || []).filter(c => c.queue_match === true && staffStatus(c) === 'Not contacted' &&
    hires.includes(c.hires_from) && !staffDraftsBlocked(c))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || String(a.company).localeCompare(String(b.company)));
}
function staffQueue(now = Date.now()) {
  const q = staffQueueCfg(); if (!q) return null;
  const contacted = staffWeekCount(now); const size = Number(q.size);
  const room = Math.max(0, size - contacted);
  const pool = staffQueuePool(q);
  return { size, contacted, room, waiting: pool.length, firms: pool.slice(0, room) };
}
function staffFollowUps(now = Date.now()) {
  const q = staffQueueCfg(); if (!q) return [];
  const wait = (Number(q.follow_up_days) > 0 ? Number(q.follow_up_days) : 7) * DAY_MS;
  return staffAll().map(c => ({ c, r: staffRec(c) }))
    .filter(({ c, r }) => r.status === 'Emailed recruiter' && !r.followed_up_at && !staffDraftsBlocked(c) &&
      (parseDate(r.at) ?? Infinity) <= now - wait)
    .sort((a, b) => parseDate(a.r.at) - parseDate(b.r.at)).map(x => x.c);
}
function staffQueueRow(c, update, follow) {
  const d = c.drafts || {}; const rec = staffRec(c); const m = msgBox();
  const mark = (status, label, extra) => {
    const b = el('button', { type: 'button', class: 'small-btn', text: label });
    b.addEventListener('click', async () => {
      b.disabled = true;
      const ok = await setStaffStatus(c, status, rec.note || '', m, extra);
      S.staffQueueMsg = [c.company + ': ' + (extra && extra.followed_up_at ? 'follow-up recorded' : status) + '. ' +
        (ok ? (getToken() ? 'Saved and synced to GitHub.' : 'Saved on this device; it syncs once you add a GitHub token in Settings.')
          : 'Saved on this device; sync failed and will retry on the next save.'), ok ? 'ok' : 'err'];
      update();
    });
    return b;
  };
  const fu = d.follow_up || {};
  const days = Math.floor((Date.now() - (parseDate(rec.at) ?? Date.now())) / DAY_MS);
  const sub = follow ? 'Emailed ' + fmtDay(parseDate(rec.at)) + ' (' + days + ' days ago)'
    : [STAFF_HIRES[c.hires_from], c.salesforce_focus === 'yes' ? 'Salesforce' : c.salesforce_focus === 'partial' ? 'Some Salesforce' : (c.tech || []).includes('sfcc') ? 'SFCC' : ''].filter(Boolean).join(' · ');
  const buttons = follow ? [
    fu.subject || fu.body ? link(staffGmailHref(fu.subject, fu.body), 'Open follow-up in Gmail', 'btn small-btn') : null,
    fu.subject || fu.body ? copyBtn('Copy follow-up', () => (fu.subject ? fu.subject + '\n\n' : '') + (fu.body || ''), m, 'small-btn') : null,
    mark('Emailed recruiter', 'Follow-up sent', { followed_up_at: new Date().toISOString() }), mark('Replied', 'Replied')
  ] : [
    d.subject || d.body ? link(staffGmailHref(d.subject, d.body), 'Open in Gmail', 'btn small-btn') : null,
    d.body ? copyBtn('Copy recruiter note', () => (d.subject ? d.subject + '\n\n' : '') + d.body, m, 'small-btn') : null,
    c.apply_url ? link(c.apply_url, 'Talent pool', 'btn small-btn') : null,
    mark('Emailed recruiter', 'Emailed'), c.apply_url ? mark('Applied to talent pool', 'Applied to pool') : null
  ];
  return el('div', { class: 'queue-row', 'data-id': c.id },
    el('div', { class: 'queue-head' }, el('strong', { text: c.company }), sub ? el('span', { class: 'small muted', text: sub }) : null),
    el('div', { class: 'btn-row' }, buttons), m);
}
function staffQueueSection(update) {
  const q = staffQueue(); if (!q) return null;
  const due = staffFollowUps();
  // Collapsible (open by default) so the full firm list stays one tap away on a phone; stays closed while filtering.
  const box = el('details', { class: 'card queue', 'data-role': 'staff-queue', open: !S.staffQueueClosed });
  box.addEventListener('toggle', () => { S.staffQueueClosed = !box.open; });
  const note = q.room === 0 ? 'Weekly target reached. New firms appear here as earlier contacts pass 7 days.'
    : q.firms.length ? 'Next ' + q.firms.length + ' Salesforce/SFCC firm' + (q.firms.length === 1 ? '' : 's') + ', highest priority first. Gmail opens a draft without a recipient: add the firm’s published careers address yourself.'
      : 'No uncontacted Salesforce/SFCC firms left in the list.';
  box.append(el('summary', null, el('span', { class: 'queue-title', text: 'This week’s queue' }),
    el('span', { class: 'small muted queue-sub', text: '· ' + q.firms.length + ' to contact' + (due.length ? ' · ' + due.length + ' follow-up' + (due.length === 1 ? '' : 's') + ' due' : '') })),
    el('p', { class: 'small muted', text: q.contacted + ' of ' + q.size + ' contacted in the last 7 days. ' + note }));
  if (S.staffQueueMsg) { const m = msgBox(); m.set(S.staffQueueMsg[0], S.staffQueueMsg[1]); box.append(m); S.staffQueueMsg = null; }
  for (const c of q.firms) box.append(staffQueueRow(c, update, false));
  if (due.length) {
    box.append(el('h3', { text: 'Follow-ups due (' + due.length + ')' }));
    for (const c of due) box.append(staffQueueRow(c, update, true));
  }
  return box;
}
/* Demand board (staffing.demand_board): companies that posted SFCC/OMS roles recently, including roles that exclude
   India. Agencies/SIs get a subcontract pitch (drafts only). A pitch is saved as a Staffing status ("Emailed
   recruiter") under the company's id, so it counts in this week's target and gets one follow-up like a firm. */
const DEMAND_TYPES = { agency: 'Agency/SI', staffing: 'Staffing firm', brand: 'Brand', vendor: 'Salesforce', unknown: 'Type unknown' };
const DEMAND_ELIG = { CONFIRMED_INDIA: 'open to India', CONFIRMED_WORLDWIDE: 'worldwide' };
function demandData() { const d = staffData().demand; return d && typeof d === 'object' && Array.isArray(d.companies) ? d : null; }
function staffAll() {
  // Firms on the list plus board companies that are not on it (a company on both shares the firm's id and record).
  const firms = staffData().companies || []; const d = demandData();
  if (!d) return firms;
  const ids = new Set(firms.map(c => c.id));
  return firms.concat(d.companies.filter(c => c && c.id && !ids.has(c.id)));
}
function demandPitch(c) { const d = c.drafts || {}; return c.type === 'agency' && d.body && !staffDraftsBlocked(c) ? d : null; }
function demandRoleMeta(r) {
  const e = String(r.eligibility || '');
  return [r.date ? fmtDay(parseDate(r.date)) : '', DEMAND_ELIG[e] || (e.startsWith('RESTRICTED') ? 'excludes India' : 'India unknown'),
    r.status && r.status !== 'OPEN' ? String(r.status).toLowerCase() : ''].filter(Boolean).join(' · ');
}
function demandRow(c, update, leadIds) {
  const rec = staffRec(c); const st = rec.status; const pitch = demandPitch(c); const m = msgBox();
  const mark = (status, label) => {
    const b = el('button', { type: 'button', class: 'small-btn', text: label });
    b.addEventListener('click', async () => {
      b.disabled = true;
      const ok = await setStaffStatus(c, status, rec.note || '', m);
      S.demandMsg = [c.company + ': ' + (status === 'Emailed recruiter' ? 'pitch recorded' : status) + '. ' +
        (ok ? (getToken() ? 'Saved and synced to GitHub.' : 'Saved on this device; it syncs once you add a GitHub token in Settings.')
          : 'Saved on this device; sync failed and will retry on the next save.'), ok ? 'ok' : 'err'];
      update();
    });
    return b;
  };
  const pills = [el('span', { class: 'pill', title: c.type_reason || '', text: DEMAND_TYPES[c.type] || DEMAND_TYPES.unknown })];
  if (c.hot) pills.push(el('span', { class: 'pill ok', text: 'Hiring fast' }));
  if (c.on_staffing_list) pills.push(el('span', { class: 'pill', text: 'On the Staffing list' }));
  if (st !== 'Not contacted') pills.push(el('span', { class: 'pill warn', text: (st === 'Emailed recruiter' ? 'Pitched' : st) + (rec.at && parseDate(rec.at) != null ? ' ' + fmtDay(parseDate(rec.at)) : '') }));
  const n = Number(c.postings) || 0; const n30 = Number(c.postings_30d) || 0; const ok = Number(c.india_ok) || 0;
  const counts = [n + ' SFCC/OMS role' + (n === 1 ? '' : 's') + ' in ' + (demandData().window_days || 90) + ' days',
    n30 ? n30 + ' in 30 days' : '', ok ? ok + ' open to India' : '',
    c.last_posted && parseDate(c.last_posted) != null ? 'last ' + fmtDay(parseDate(c.last_posted)) : ''].filter(Boolean).join(' · ');
  const roles = el('ul', { class: 'plain small demand-roles' }, (c.roles || []).map(r => el('li', null,
    leadIds.has(r.lead_id) ? el('a', { href: '#lead/' + encodeURIComponent(r.lead_id), text: r.title || '(untitled)' }) : el('span', { text: r.title || '(untitled)' }),
    el('span', { class: 'muted', text: ' · ' + demandRoleMeta(r) + (r.url && safeUrl(r.url) ? ' · ' : '') }),
    r.url && safeUrl(r.url) ? link(r.url, 'listing') : null)));
  const closed = STAFF_CLOSED.includes(st);
  const buttons = !pitch || closed ? [] : [
    link(staffGmailHref(pitch.subject, pitch.body), 'Open pitch in Gmail', 'btn small-btn'),
    copyBtn('Copy pitch', () => (pitch.subject ? pitch.subject + '\n\n' : '') + pitch.body, m, 'small-btn'),
    st === 'Not contacted' ? mark('Emailed recruiter', 'Pitched') : mark('Replied', 'Replied'),
    st === 'Not contacted' ? mark('Not a fit', 'Not a fit') : null];
  const notes = [];
  const draft = c.drafts || {};
  if (c.type === 'agency' && staffDraftsBlocked(c)) notes.push('No pitch yet: ' + draft.reasons.join(' '));
  if (pitch && Array.isArray(pitch.warnings)) for (const w of pitch.warnings) notes.push(String(w));
  if (c.type !== 'agency') notes.push(c.type === 'brand' || c.type === 'vendor' ? 'Not an agency: no subcontract pitch. Their roles show where SFCC work is.'
    : c.type === 'staffing' ? 'A staffing firm: use its recruiter route rather than a subcontract pitch.'
      : 'Type unknown: if it is an agency or SI, add it to staffing.demand_board.types to get a pitch.');
  const people = warmCfg() ? demandPeople(c) : [];
  const newest = (c.roles || [])[0] || {};
  const warm = people.length ? el('details', { class: 'small', 'data-role': 'warm' },
    el('summary', { text: 'You know ' + people.length + (people.length === 1 ? ' person' : ' people') + ' here' }),
    people.slice(0, 3).map(p => personRow(p, { title: newest.title, company: c.company, url: newest.url }, m))) : null;
  return el('div', { class: 'queue-row demand-row', 'data-id': c.id },
    el('div', { class: 'queue-head' }, el('strong', { text: c.company || '(company)' }), pills), warm,
    el('p', { class: 'small muted', text: counts + (c.type_reason && c.type !== 'unknown' ? ' · tagged ' + (DEMAND_TYPES[c.type] || c.type) + ' because ' + c.type_reason : '') }),
    roles, notes.length ? el('p', { class: 'small muted', text: notes.join(' ') }) : null,
    buttons.some(Boolean) ? el('div', { class: 'btn-row' }, buttons) : null, m);
}
function demandSection(update) {
  const d = demandData(); if (!d) return null;
  // Closed by default (the weekly queue comes first); the summary still says how many agencies wait for a pitch.
  const box = el('details', { class: 'card queue demand', 'data-role': 'demand', open: !!S.demandOpen });
  box.addEventListener('toggle', () => { S.demandOpen = box.open; });
  const todo = d.companies.filter(c => demandPitch(c) && staffStatus(c) === 'Not contacted').length;
  const total = d.companies.length;
  box.append(el('summary', null, el('span', { class: 'queue-title', text: 'Hiring for SFCC now' }),
    el('span', { class: 'small muted queue-sub', text: '· ' + total + ' compan' + (total === 1 ? 'y' : 'ies') + (todo ? ' · ' + todo + ' agenc' + (todo === 1 ? 'y' : 'ies') + ' to pitch' : '') })),
    el('p', { class: 'small muted', text: 'Companies that posted Salesforce Commerce or OMS roles in the last ' + (d.window_days || 90) +
      ' days, including roles that exclude India. Agencies and SIs often subcontract: the pitch offers overflow capacity and cites the role they posted. A pitch counts in this week’s target. Gmail opens a draft without a recipient.' }));
  if (S.demandMsg) { const m = msgBox(); m.set(S.demandMsg[0], S.demandMsg[1]); box.append(m); S.demandMsg = null; }
  const leadIds = new Set(((S.data && S.data.leads) || []).map(l => l.id));
  for (const c of d.companies) box.append(demandRow(c, update, leadIds));
  if (Number(d.total_companies) > total) box.append(el('p', { class: 'small muted', text: 'Showing ' + total + ' of ' + d.total_companies + ' companies (staffing.demand_board.max_companies).' }));
  return box;
}
function viewStaffing(app) {
  const sd = staffData(); const all = sd.companies || [];
  if (!S.staffView) S.staffView = savedStaffView();
  const v = S.staffView;
  const listBox = el('div', { class: 'cards staff' });
  const countLine = el('div', { class: 'count-line', role: 'status', 'aria-live': 'polite' });
  const weekLine = el('p', { class: 'small', 'data-role': 'week' });
  const queueBox = el('div', { 'data-role': 'staff-queue-box' });
  const chipsBox = el('div', { class: 'chips', role: 'group', 'aria-label': 'Quick filters' });
  const CHIPS = [['cSf', 'Salesforce'], ['cIndia', 'Accepts India'], ['cRoles', 'Has open roles'], ['cNew', 'Not contacted'], ['cNet', 'Talent networks']];
  const update = () => {
    store.setJson(STAFF_VIEW_KEY, v);
    const res = filterStaffing(v);
    clear(listBox);
    const frag = document.createDocumentFragment();
    for (const c of res) frag.append(staffCard(c, update));
    listBox.append(frag);
    S.staffOpen = null;
    const hiddenClosed = v.status ? 0 : all.filter(c => STAFF_CLOSED.includes(staffStatus(c))).length;
    countLine.textContent = res.length + ' of ' + all.length + ' firms' + (hiddenClosed ? ' · ' + hiddenClosed + ' closed hidden (Not a fit / Do not contact)' : '');
    weekLine.textContent = 'This week: ' + staffWeekCount() + '/' + (staffQueueCfg() ? staffQueueCfg().size : (sd.weekly_cap || 15)) + ' contacted';
    clear(queueBox);
    const queue = staffQueueSection(update);
    if (queue) queueBox.append(queue);
    const demand = demandSection(update);
    if (demand) queueBox.append(demand);
    if (!res.length) listBox.append(el('div', { class: 'card muted', 'data-role': 'empty' },
      el('p', { text: 'No firms match these filters.' }),
      el('p', { class: 'small', text: 'Try clearing a quick chip, adding "India unknown" under Hires from, or choosing Reset filters. Firms marked Not a fit or Do not contact are hidden unless you pick that status.' })));
    clear(chipsBox);
    for (const [k, label] of CHIPS) chipsBox.append(el('button', { type: 'button', class: 'chip', 'aria-pressed': String(!!v[k]), text: label,
      on: { click: () => { v[k] = !v[k]; update(); } } }));
  };
  const sel = (label, key, options, fmt, anyLabel) => {
    const s = el('select', { 'aria-label': label }, el('option', { value: '', text: anyLabel || 'Any' }), options.map(o => el('option', { value: o, text: fmt ? fmt(o) : o })));
    s.value = v[key] || '';
    s.addEventListener('change', () => { v[key] = s.value; update(); });
    return el('label', { class: 'field' }, el('span', { text: label }), s);
  };
  const multi = (legend, key, map) => el('fieldset', { class: 'one-col-fs' }, el('legend', { text: legend }), el('div', { class: 'checks' }, Object.entries(map).map(([k, label]) => {
    const c = el('input', { type: 'checkbox', checked: v[key].includes(k) });
    c.addEventListener('change', () => { v[key] = c.checked ? v[key].concat(k) : v[key].filter(x => x !== k); update(); });
    return el('label', { class: 'check' }, c, el('span', { text: label }));
  })));
  const search = el('input', { type: 'search', 'aria-label': 'Search', placeholder: 'Company, notes, tech', value: v.q });
  search.addEventListener('input', debounce(() => { v.q = search.value; update(); }, 150));
  const sort = el('select', { 'aria-label': 'Sort' }, STAFF_SORTS.map(([k, t]) => el('option', { value: k, text: t })));
  sort.value = v.sort; sort.addEventListener('change', () => { v.sort = sort.value; update(); });
  const reset = el('button', { type: 'button', text: 'Reset filters', on: { click: () => { store.del(STAFF_VIEW_KEY); S.staffView = null; route(); } } });
  const panel = el('div', { class: 'panel', id: 'staff-filter-panel', hidden: true },
    multi('Type', 'types', STAFF_TYPES), multi('Hires from', 'hires', STAFF_HIRES),
    el('div', { class: 'grid-fields' },
      sel('Salesforce focus', 'sf', ['yes', 'partial', 'no']),
      sel('Tech', 'tech', uniq(all.flatMap(c => c.tech || []))),
      sel('Engagement', 'engagement', uniq(all.map(c => c.engagement))),
      sel('HQ country', 'hq', uniq(all.map(c => c.hq))),
      sel('Status', 'status', STAFF_STATUSES, null, 'Any (hide closed)'),
      el('label', { class: 'field' }, el('span', { text: 'Sort by' }), sort)),
    reset);
  const toggle = el('button', { class: 'filters-toggle', type: 'button', 'aria-expanded': String(!panel.hidden), 'aria-controls': 'staff-filter-panel' }, el('span', { text: 'Filters & sort' }), el('span', { 'aria-hidden': 'true', text: '▾' }));
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  const types = {}; for (const c of all) types[c.type] = (types[c.type] || 0) + 1;
  app.append(el('h1', { text: 'Staffing' }),
    el('p', { class: 'muted', text: 'Overseas staffing firms & talent networks that place remote contractors. Apply via their talent pool or send one personal recruiter note. Never pay a placement fee.' }),
    el('p', { class: 'small muted', 'data-role': 'totals', text: all.length + ' firms · ' + (types.talent_network || 0) + ' talent networks · ' + all.filter(staffIsSf).length + ' with Salesforce work · ' + all.filter(c => c.open_roles > 0).length + ' with open roles' }),
    weekLine, queueBox);
  if (sd.problems && sd.problems.length) app.append(el('details', { class: 'panel issues', 'data-role': 'issues' }, el('summary', { text: 'List issues (' + sd.problems.length + ')' }),
    el('ul', { class: 'plain small' }, sd.problems.map(p => el('li', { text: String(p) })))));
  app.append(el('label', { class: 'field search-top' }, el('span', { class: 'sr-only', text: 'Search firms' }), search), chipsBox, toggle, panel, countLine, listBox);
  update();
  if (getToken() && !S.overrides) ensureOverrides().then(() => { if (document.body.contains(listBox)) update(); });
}

/* ---------- lead detail ---------- */
function leadVerificationForm(lead) {
  if (!lead.verification_revision) return null;
  const existing = leadVerification(lead);
  const eligibility = el('select', { id: 'review-india' }, [
    ['unverified', 'Use listing evidence'], ['confirmed', 'India contracting confirmed'],
    ['restricted', 'India contracting excluded'],
  ].map(([value, text]) => el('option', { value, text })));
  eligibility.value = existing?.eligibility || 'unverified';
  const country = el('input', { id: 'review-country', placeholder: 'e.g. US or GB', maxlength: 2 });
  country.value = existing?.company_country || '';
  const source = el('select', { id: 'review-evidence', required: true },
    [['', 'Choose evidence'], ['employer_listing', 'Employer listing'], ['application_form', 'Application form'],
      ['recruiter_reply', 'Recruiter or buyer reply']].map(([value, text]) => el('option', { value, text })));
  source.value = existing?.source || '';
  const note = el('textarea', { id: 'review-summary', required: true, maxlength: 240, rows: 2 });
  note.value = existing?.summary || '';
  const message = msgBox();
  const save = el('button', { class: 'primary', type: 'submit', text: 'Save verification' });
  const form = el('form', null,
    el('label', { class: 'field' }, el('span', { text: 'India eligibility' }), eligibility),
    el('label', { class: 'field' }, el('span', { text: 'Verified buyer country (optional)' }), country),
    el('label', { class: 'field' }, el('span', { text: 'Evidence source' }), source),
    el('label', { class: 'field' }, el('span', { text: 'Brief evidence summary. Omit private contact details.' }), note),
    el('div', { class: 'btn-row' }, save), message);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const code = country.value.trim().toUpperCase();
    if ((code && !/^[A-Z]{2}$/.test(code)) || !source.value || !note.value.trim()) {
      message.set('Use a two-letter buyer country code and supply a short source summary.', 'err');
      return;
    }
    S.pendingVerifications[lead.id] = { event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
      owner_key: ownerKey(), eligibility: eligibility.value, company_country: code, source: source.value,
      summary: note.value.trim(), revision: lead.verification_revision };
    savePending();
    // Remove stale draft and follow-up controls in the current view as soon as evidence changes.
    const kit = document.getElementById('apply-kit');
    if (kit) kit.hidden = true;
    if (!getToken()) {
      message.set('Saved on this device. Add a GitHub token in Settings to sync.', 'ok');
      return;
    }
    save.disabled = true;
    message.set('Saving…');
    try {
      await saveOverrides(() => {}, 'Record lead eligibility verification');
      message.set('Synced. The next rebuild will update the lead assessment.', 'ok');
    } catch (error) {
      message.set((error.message || 'Sync failed') + ' Verification is kept on this device.', 'err');
    } finally {
      save.disabled = false;
    }
  });
  return el('details', null, el('summary', { text: 'Record verified evidence' }),
    existing ? el('p', { class: 'small', text: 'Recorded ' + fmtDate(existing.occurred_at) + ' · ' + String(existing.source || '').replace(/_/g, ' ') }) : null,
    existing && (existing.revision !== lead.verification_revision || parseDate(existing.occurred_at) < Date.now() - 30 * DAY_MS)
      ? el('p', { class: 'small', text: 'This evidence needs a new review because the listing changed or 30 days passed.' }) : null,
    el('p', { class: 'small muted', text: 'A listed restriction still blocks positive confirmation. Review contradictory evidence with the buyer.' }), form);
}
function eligibilityAsk(l) {
  if (!l.eligibility_question) return null;
  const m = msgBox();
  return el('div', { class: 'ask', 'data-role': 'eligibility-question' },
    el('h3', { text: 'Ask before applying' }),
    el('p', { class: 'small muted', text: 'Paste this to the poster or recruiter (LinkedIn message, email or the form). Nothing is sent for you.' }),
    el('p', { class: 'ask-text', text: l.eligibility_question }),
    el('div', { class: 'btn-row' }, copyBtn('Copy eligibility question', () => l.eligibility_question, m, 'primary')), m);
}
/* ---------- people you know (feature map W1–W2) ---------- */
// Your own LinkedIn Connections.csv is read in this browser and kept only on this device (localStorage): names are
// never uploaded, synced or committed. Leads and companies then show who you know there, with a short referral note
// you copy and send yourself. Nothing here talks to LinkedIn.
const CONN_KEY = 'or.connections';
function warmCfg() { const w = S.data && S.data.acquisition && S.data.acquisition.warm_paths; return w && w.enabled === true ? w : null; }
// The same key as radar.normalize.text.company_key, so a connection's company matches a lead's company_key.
function companyKey(name) {
  return String(name || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|limited|gmbh|bv|b\.v|pvt|private|co|corp|corporation|plc|srl|sa|ag|oy|ab)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
// LinkedIn's export starts with a few "Notes" lines; the header row names the columns. Email addresses are not kept.
function parseConnections(text) {
  const rows = parseCsv(text);
  const low = r => r.map(x => String(x).trim().toLowerCase());
  const h = rows.findIndex(r => low(r).includes('first name') && low(r).includes('company'));
  if (h < 0) return null;
  const head = low(rows[h]);
  const [fi, li, ui, ci, pi] = ['first name', 'last name', 'url', 'company', 'position'].map(c => head.indexOf(c));
  const by = {}; let count = 0;
  for (const r of rows.slice(h + 1)) {
    const company = String(r[ci] || '').trim(); const first = String(r[fi] || '').trim();
    const last = li >= 0 ? String(r[li] || '').trim() : '';
    const key = companyKey(company);
    if (!key || !(first || last)) continue;
    const url = ui >= 0 ? (safeUrl(String(r[ui] || '').trim()) || '') : '';
    (by[key] = by[key] || []).push([first.slice(0, 60), (first + ' ' + last).trim().slice(0, 120),
      pi >= 0 ? String(r[pi] || '').trim().slice(0, 120) : '', url, company.slice(0, 120)]);
    count++;
  }
  return { v: 1, at: new Date().toISOString(), count, companies: Object.keys(by).length, by };
}
function connections() {
  if (S.conn !== undefined) return S.conn;
  try { S.conn = JSON.parse(localStorage.getItem(CONN_KEY) || 'null'); } catch (e) { S.conn = null; }
  if (!S.conn || typeof S.conn.by !== 'object' || !S.conn.by) S.conn = null;
  return S.conn;
}
function peopleAt(key) {
  const c = warmCfg() && connections();
  if (!c || !key) return [];
  return (Array.isArray(c.by[key]) ? c.by[key] : []).map(([first, name, position, url, company]) => ({ first, name, position, url, company }));
}
function leadPeople(l) { return peopleAt(l.company_key || companyKey(l.company)); }
function demandPeople(c) { return peopleAt(String(c.id || '').startsWith('demand:') ? String(c.id).slice(7) : companyKey(c.company)); }
// A link for a note: http(s) only, without utm_* tracking parameters (analytics only; the page is the same).
function noteLink(url) {
  const href = safeUrl(url); if (!href) return '';
  try { const u = new URL(href); for (const k of Array.from(u.searchParams.keys())) if (/^utm_/i.test(k)) u.searchParams.delete(k); return u.href; }
  catch (e) { return href; }
}
// The referral note (W2): outreach.templates.referral_ask, kept to warm_paths.note_max_chars (300).
function referralNote(p, role) {
  const max = Math.max(120, Math.min(1000, Number((warmCfg() || {}).note_max_chars) || 300));
  const t = (((S.data.outreach || {}).templates || {}).referral_ask) || {};
  const ident = (S.data.outreach || {}).identity || {};
  const headline = String(ident.headline || '').split('·')[0].trim();
  const v = { first_name: p.first || 'there', company: role.company || p.company || 'your company', role: String(role.title || 'a role'),
    link: noteLink(role.url), headline_short: headline, name_short: String(ident.name || '').trim().split(/\s+/)[0] || '' };
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m0, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m0))
    .replace(/…\./g, '…').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
  const tpls = [headline ? t.body : null, t.short].filter(x => typeof x === 'string' && x.trim());
  if (!tpls.length) return '';
  for (const tpl of tpls) { const s = fill(tpl, v); if (s.length <= max) return s; }
  const last = tpls[tpls.length - 1];
  for (let n = v.role.length - 1; n >= 12; n--) {
    const s = fill(last, Object.assign({}, v, { role: v.role.slice(0, n).trim() + '…' }));
    if (s.length <= max) return s;
  }
  const s = fill(last, Object.assign({}, v, { link: '', role: v.role.length > 40 ? v.role.slice(0, 39).trim() + '…' : v.role }));
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
function personRow(p, role, m) {
  const note = referralNote(p, role);
  return el('div', { class: 'warm-person' }, el('h3', { text: p.name + (p.position ? ' · ' + p.position : '') }),
    note ? el('pre', { class: 'draft small', text: note }) : null,
    el('div', { class: 'btn-row' }, note ? copyBtn('Copy note', () => note, m, 'small-btn') : null,
      p.url ? link(p.url, 'Open profile', 'btn small-btn') : null));
}
function warmSection(l) {
  const people = warmCfg() ? leadPeople(l) : [];
  if (!people.length) return null;
  const m = msgBox();
  const role = { title: l.title, company: l.company, url: l.apply_url };
  return el('section', { class: 'card', 'data-role': 'warm-people' }, el('h2', { text: 'People you know at ' + (l.company || 'this company') }),
    el('p', { class: 'small muted', text: 'From your LinkedIn export, kept on this device. A referral often beats a cold application: copy the note and send it yourself.' }),
    people.slice(0, 5).map(p => personRow(p, role, m)),
    people.length > 5 ? el('p', { class: 'small muted', text: '+' + (people.length - 5) + ' more at this company.' }) : null, m);
}
function warmSettingsCard() {
  if (!warmCfg()) return null;
  const m = msgBox();
  const box = el('div', { class: 'card', 'data-role': 'connections' });
  const render = () => {
    clear(box);
    const c = connections();
    const fileIn = el('input', { type: 'file', accept: '.csv,text/csv', 'aria-label': 'LinkedIn Connections.csv' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0]; if (!f) return;
      let text; try { text = await f.text(); } catch (e) { m.set('Could not read that file.', 'err'); return; }
      const parsed = parseConnections(text);
      if (!parsed || !parsed.count) { m.set("No connections found. Use Connections.csv from LinkedIn's data export.", 'err'); return; }
      try { localStorage.setItem(CONN_KEY, JSON.stringify(parsed)); }
      catch (e) { m.set('This browser would not keep it (private mode or storage full). Nothing was stored.', 'err'); return; }
      S.conn = parsed;
      m.set('Imported ' + parsed.count + ' connections at ' + parsed.companies + ' companies. They stay on this device.', 'ok');
      render();
    });
    const when = c && parseDate(c.at);
    box.append(...[el('h2', { text: 'People you know' }),
      el('p', { class: 'small muted', text: "Import your own LinkedIn connections to see who you know at each lead's company, with a short referral note. " +
        'On LinkedIn: Settings & Privacy → Data privacy → Get a copy of your data → Connections. The file is read in this browser and kept only ' +
        'on this device: names are never uploaded or synced, and email addresses are not kept.' }),
      c ? el('p', { class: 'small', 'data-role': 'connections-status', text: c.count + ' connections at ' + c.companies + ' companies' +
        (when != null ? ', imported ' + fmtDay(when) : '') + '. Import a fresh copy every couple of months.' }) : null,
      el('label', { class: 'field' }, el('span', { text: c ? 'Replace with a newer Connections.csv' : 'Connections.csv' }), fileIn),
      c ? el('div', { class: 'btn-row' }, el('button', { type: 'button', class: 'danger', text: 'Remove from this device', on: { click: () => {
        try { localStorage.removeItem(CONN_KEY); } catch (e) { /* nothing stored */ }
        S.conn = null; m.set('Removed from this device.', 'ok'); render();
      } } })) : null, m].filter(Boolean));  // native append() would print "null" for a skipped part
  };
  render();
  return box;
}
function viewLead(id) {
  const app = $app();
  const l = S.data.leads.find(x => x.id === id);
  app.append(el('a', { class: 'back', href: '#leads', text: '← All leads' }));
  if (!l) { app.append(el('p', { text: 'That lead was not found. It may have been removed in a newer update.' })); return; }
  const pc = partClass(l.partition);
  const sec = (title, ...kids) => el('section', { class: 'card' }, el('h2', { text: title }), ...kids);
  const list = (arr) => (arr && arr.length) ? el('ul', { class: 'plain' }, arr.map(x => el('li', { text: String(x) }))) : null;
  const dl = (rows) => el('dl', { class: 'kv' }, rows.filter(r => r[1] != null && r[1] !== '').flatMap(r => [el('dt', { text: r[0] }), el('dd', null, r[1])]));
  const flags = l.flags || [];
  const danger = flags.filter(f => f === 'UNTRUSTED_INSTRUCTIONS' || f === 'SCAM_SIGNAL');
  const out = [];
  out.push(el('h1', { text: l.title || '(untitled)' }));
  out.push(el('p', { class: 'muted', text: [l.company, l.company_country && l.company_country !== 'UNKNOWN' ? l.company_country : null].filter(Boolean).join(' · ') }));
  if (danger.length) out.push(el('div', { class: 'warnbox', role: 'alert', text: 'Warning: ' + danger.map(f => f === 'SCAM_SIGNAL' ? 'this listing shows scam signals' : 'the listing text contains instructions aimed at AI tools (ignore them)').join('; ') + '. Be careful before applying or sharing any details.' }));
  out.push(el('div', { class: 'card' },
    el('div', { class: 'meta' }, el('div', { class: 'score ' + pc, text: String(Math.round(l.score || 0)) }), el('span', { class: 'pill ' + pc, text: l.partition }),
      (l.reasons || []).map(r => el('span', { class: 'pill', text: String(r).replace(/_/g, ' ').toLowerCase() }))),
    el('div', { class: 'btn-row' }, l.apply_url && safeUrl(l.apply_url) ? link(l.apply_url, l.lead_type === 'SIGNAL' ? 'Open original post' : 'Open listing', 'btn primary big') : el('p', { class: 'muted', text: 'No listing link available.' })),
    l.apply_kit ? el('div', { class: 'small muted', text: 'Apply kit below (drafts, copy and send helpers).' }) : null,
    (l.source_links && l.source_links.length) ? el('div', null, el('div', { class: 'small muted', text: 'Found via' }),
      el('ul', { class: 'plain' }, l.source_links.map(s => el('li', null, link(s.url, s.source || s.url), s.attribution ? el('span', { class: 'small muted', text: ' — ' + s.attribution }) : null)))) : null));
  const warm = warmSection(l);
  if (warm) out.push(warm);
  if (l.apply_kit) out.push(applyKitSection(l));
  out.push(sec('Eligibility',
    el('p', null, el('span', { class: 'pill ' + (/^CONFIRMED/.test(l.eligibility || '') ? 'ok' : /^RESTRICTED/.test(l.eligibility || '') ? 'bad' : 'warn'), text: (l.eligibility || '').replace(/_/g, ' ').toLowerCase() })),
    (l.eligibility_evidence && l.eligibility_evidence.length) ? el('ul', { class: 'plain' }, l.eligibility_evidence.map(e => el('li', { text: (e.field || '') + ': “' + (e.text || '') + '” → ' + (e.meaning || '') }))) : el('p', { class: 'muted', text: 'No evidence recorded.' }),
    dl([['Work location', l.work_location], ['Timezone requirement', l.timezone_requirement]]), eligibilityAsk(l), leadVerificationForm(l)));
  out.push(sec('Pay & terms', dl([
    ['Pay', l.pay_text], ['Pay evidence', l.pay_evidence], ['Comparison', l.usd_hourly != null ? '≈ $' + Number(l.usd_hourly).toFixed(2).replace(/\.00$/, '') + '/h for comparison' : null],
    ['Contract type', l.contract_type], ['Hours per week', l.hours_per_week],
    ['Posted', leadDateValue(l, 'posted') || 'Unknown'], ['First found', leadDateValue(l, 'found')],
    ['Last changed', leadDateValue(l, 'changed') || 'No recorded change'], ['Last verified', fmtDate(l.date_last_verified)],
    ['Listing status', l.status], ['Listing re-check', recheckText(l.recheck)], ['Lead type', l.lead_type],
    ['Possible ghost', l.possible_ghost && l.possible_ghost.reason ? String(l.possible_ghost.reason).replace(/^./, ch => ch.toUpperCase()) +
      '. Long-open or reposted roles are often filled or only collecting CVs: ask before investing time.' : null]])));
  if (l.skills && l.skills.length) out.push(sec('Skills', el('div', { class: 'skills' }, l.skills.map(s => el('span', { class: 'skill', text: s })))));
  const adv = [['Why it matches', l.why], ['Missing', l.missing], ['How to verify', l.verify]].filter(x => x[1] && x[1].length);
  out.push(sec('Assessment', adv.map(([t, a]) => el('div', null, el('h3', { text: t }), list(a))),
    dl([['Next action', l.next_action], ['Complexity', l.complexity], ['Feasibility', l.feasibility]])));
  if (l.breakdown) out.push(sec('Score breakdown', el('div', { class: 'bars' }, Object.entries(l.breakdown).map(([k, b]) => {
    const fill = el('i'); fill.style.width = Math.max(0, Math.min(100, (b.max ? (b.points / b.max) * 100 : 0))) + '%';
    return el('div', { class: 'bar-row' }, el('div', { class: 'bar-top' }, el('span', { text: k.replace(/_/g, ' ') }), el('span', { text: b.points + ' / ' + b.max })),
      el('div', { class: 'bar', role: 'presentation' }, fill), el('div', { class: 'small muted', text: b.detail || '' }));
  }))));
  if (flags.length) out.push(sec('Flags', el('div', { class: 'skills' }, flags.map(f => el('span', { class: 'pill ' + (danger.includes(f) ? 'bad' : ''), text: f })))));
  // CRM
  const m = msgBox();
  const statusSel = el('select', { id: 'crm-status' }, (S.data.crm_statuses || ['New']).map(s => el('option', { value: s, text: s })));
  const cur = effRec(l);
  statusSel.value = cur.status;
  const note = el('textarea', { id: 'crm-note', maxlength: '2000' }); note.value = cur.note || '';
  const reasonSel = feedbackCfg() ? el('select', { id: 'crm-reason' }, el('option', { value: '', text: 'Choose a reason' }),
    feedbackReasons().map(r => el('option', { value: r.key, text: r.label }))) : null;
  if (reasonSel) reasonSel.value = cur.reason || '';
  const reasonField = reasonSel ? el('label', { class: 'field', hidden: statusSel.value !== NOT_A_FIT },
    el('span', { text: 'Why it is not a fit (teaches the scoring; see More → Learned rules)' }), reasonSel) : null;
  statusSel.addEventListener('change', () => { if (reasonField) reasonField.hidden = statusSel.value !== NOT_A_FIT; });
  const save = el('button', { class: 'primary', type: 'button', text: 'Save' });
  save.addEventListener('click', async () => {
    save.disabled = true;
    const reason = statusSel.value === NOT_A_FIT && reasonSel ? (reasonSel.value || 'other') : null;
    newInteraction('opportunity', l, statusSel.value, note.value, null, 'status', cur.channel || l.interaction_channel || '', reason, cur.status || 'New');
    if (DRAFT_STOP_STATES.includes(statusSel.value)) route();
    if (!getToken()) { m.set('Saved on this device. It will sync once you add a GitHub token in Settings.', 'ok'); save.disabled = false; return; }
    m.set('Saving…');
    try { await saveOverrides(() => {}, 'CRM: update lead ' + l.id); m.set('Saved and synced to GitHub.', 'ok'); }
    catch (e) { m.set((e.message || 'Save failed') + ' Your change is kept on this device and will sync on the next successful save.', 'err'); }
    save.disabled = false;
  });
  out.push(sec('CRM', S.pending[l.id] ? el('p', { class: 'pill warn', text: 'Pending local change (not yet synced)' }) : null,
    el('label', { class: 'field' }, el('span', { text: 'Status' }), statusSel), reasonField, el('label', { class: 'field' }, el('span', { text: 'Note' }), note), el('div', { class: 'btn-row' }, save), m));
  if ((l.interaction_history || []).length) out.push(sec('Interaction history', list(l.interaction_history.map(it =>
    fmtDate(it.at) + ' · ' + (it.kind === 'followup' ? 'Follow-up recorded' : it.status) + (it.channel ? ' · ' + it.channel : '')))));
  out.push(sec('Description', el('div', { class: 'small muted', text: l.slim ? 'Excerpt only (excluded lead). Open the source link for the full text.' : 'source text (untrusted)' }), el('pre', { class: 'src-text', tabindex: '0', 'aria-label': 'Source text (untrusted)', text: l.description || '' })));
  app.append(...out);
  ensureOverrides();
}

/* ---------- run ---------- */
function stopPoll() { if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; } }
function stopPollIfLeaving() { if ((location.hash || '').slice(1) !== 'run') stopPoll(); }
async function runNow(msgEl) {
  const m = msgEl || msgBox();
  m.set('Starting run…');
  const since = Date.now();
  await gh('POST', '/actions/workflows/' + WORKFLOW + '/dispatches', { ref: 'main', inputs: { mode: 'manual', force: 'true' } }, 'Actions: write');
  S.watch = { since, state: 'queued', conclusion: null, url: null, deadline: since + 5 * 60 * 1000, note: 'Run requested. Waiting for GitHub to start it…' };
  if ((location.hash || '') === '#run') route(); else location.hash = '#run';
}
async function pollRuns() {
  const w = S.watch; if (!w) return;
  try {
    const j = await gh('GET', '/actions/workflows/' + WORKFLOW + '/runs?per_page=5', null, 'Actions: read');
    const runs = (j && j.workflow_runs) || [];
    const mine = runs.find(r => (parseDate(r.created_at) || 0) >= w.since - 60000);
    if (mine) { w.state = mine.status; w.conclusion = mine.conclusion; w.url = mine.html_url; w.note = ''; }
    else w.note = 'Waiting for the run to appear…';
  } catch (e) { w.note = e.message; }
  renderWatch();
  const done = w.state === 'completed';
  if (done || Date.now() > w.deadline) { stopPoll(); w.finished = true; renderWatch(); return; }
  S.pollTimer = setTimeout(pollRuns, 10000);
}
function renderWatch() {
  const box = document.getElementById('watch'); if (!box || !S.watch) return;
  const w = S.watch; clear(box);
  const label = w.state === 'completed' ? 'completed (' + (w.conclusion || 'unknown') + ')' : w.state;
  box.append(el('h2', { text: 'Run status' }), el('p', null, el('span', { class: 'pill ' + (w.state === 'completed' ? (w.conclusion === 'success' ? 'ok' : 'bad') : 'warn'), text: label })));
  if (w.note) box.append(el('p', { class: 'muted', text: w.note }));
  if (w.url) box.append(el('p', null, link(w.url, 'View run on GitHub')));
  if (w.state === 'completed') box.append(el('p', { text: 'The site updates after the deploy step finishes (about 1–2 minutes). Then reload the data.' }));
  else if (w.finished) box.append(el('p', { class: 'muted', text: 'Stopped watching after 5 minutes. Check GitHub Actions for the result.' }));
  if (w.state === 'completed' || w.finished) box.append(el('button', { type: 'button', text: 'Reload data', on: { click: async (ev) => { ev.target.disabled = true; try { S.data = await fetchAndDecrypt(S.pass); updateAge(); route(); } catch (e) { ev.target.disabled = false; box.append(el('p', { class: 'msg err', text: 'Could not reload data.' })); } } } }));
}
function viewRun(app) {
  const r = S.data.run || {};
  const st = r.stats || {};
  const m = msgBox();
  const btn = el('button', { class: 'primary', type: 'button', text: 'Run now' });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await runNow(m); } catch (e) { m.set(e.message, 'err'); btn.disabled = false; }
  });
  app.append(el('h1', { text: 'Run' }));
  app.append(el('div', { class: 'card' }, el('h2', { text: 'Last run' }),
    el('dl', { class: 'kv' }, [['Status', r.status], ['Started', fmtDate(r.started_at)], ['New leads', st.new], ['Qualified', st.qualified], ['Needs verification', st.needs_verification], ['Irrelevant skipped', st.irrelevant_skipped]]
      .filter(x => x[1] != null && x[1] !== '').flatMap(x => [el('dt', { text: x[0] }), el('dd', { text: String(x[1]) })])),
    el('div', { class: 'btn-row' }, btn), m, el('p', { class: 'small muted', text: 'Run now needs a GitHub token with Actions write access (see Settings).' })));
  app.append(el('div', { class: 'card', id: 'watch', 'aria-live': 'polite' }));
  const srcs = r.sources || [];
  const coverage = S.data.acquisition?.sources || [];
  app.append(el('div', { class: 'card' }, el('h2', { text: 'Sources in the last run' }),
    coverage.length ? el('p', { class: 'small muted' },
      `${srcs.length} listed for this run · ${coverage.length} configured overall. `,
      el('a', { href: '#today', text: 'See Source readiness in Today' })) : null,
    srcs.length ? el('div', { class: 'table-wrap' }, el('table', null,
    el('thead', null, el('tr', null, ['Source', 'Status', 'Fetched', 'Relevant', 'New', 'Error'].map(h => el('th', { scope: 'col', text: h })))),
    el('tbody', null, srcs.map(s => el('tr', null, el('td', { text: s.key }), el('td', { text: sourceStatus(s.status) }), el('td', { text: String(s.fetched ?? '') }), el('td', { text: String(s.relevant ?? '') }), el('td', { text: String(s.new ?? '') }), el('td', { class: 'err', text: s.error || '' })))))) : el('p', { class: 'muted', text: 'No source details.' }),
    srcs.filter(s => s.search).map(s => el('p', { class: 'small muted', text: s.key + ' · ' + searchSummary(s.search) }))));
  if (S.watch) { renderWatch(); if (!S.watch.finished && S.watch.state !== 'completed' && !S.pollTimer) S.pollTimer = setTimeout(pollRuns, 1500); }
}

/* ---------- profile & resume ---------- */
function effActiveProfile() { return (S.overrides && S.overrides.active_profile) || S.data.active_profile; }
function effActiveProfiles() {
  const o = S.overrides && S.overrides.active_profiles, d = S.data.active_profiles;
  const a = Array.isArray(o) && o.length ? o : (Array.isArray(d) && d.length ? d : null);
  return a ? a.slice() : [effActiveProfile()].filter(Boolean);
}
function effProfiles() {
  const byKey = new Map();
  for (const p of S.data.profiles || []) byKey.set(p.key, p);
  for (const p of (S.overrides && S.overrides.profiles) || []) byKey.set(p.key, Object.assign({}, byKey.get(p.key) || {}, p));
  const adds = (S.overrides && S.overrides.skill_additions) || {};  // skills you confirmed (M7), until the run lists them
  // A full profile save lists every skill of its profile and decides them, as on the server: a skill removed there
  // must not come back from an older answer.
  const full = new Set(((S.overrides && S.overrides.profiles) || []).filter(p => p && p.replace_skills !== false).map(p => p.key));
  for (const [key, skills] of Object.entries(adds)) {
    const p = byKey.get(key);
    if (!p || full.has(key) || !skills || typeof skills !== 'object') continue;
    const merged = Object.assign({}, p.skills || {});
    for (const [k, v] of Object.entries(skills)) if (!merged[k]) merged[k] = { level: (v && v.level) || 'secondary', status: 'verified' };
    byKey.set(key, Object.assign({}, p, { skills: merged }));
  }
  return Array.from(byKey.values());
}
function profileForSave(p) {
  const skills = {};
  for (const [k, v] of Object.entries(p.skills || {})) skills[k] = { level: v.level };
  return { key: p.key, name: p.name, keywords: p.keywords || [], skills, replace_skills: true };
}
function upsertProfile(o, prof, makeActive) {
  o.profiles = Array.isArray(o.profiles) ? o.profiles : [];
  const i = o.profiles.findIndex(x => x.key === prof.key);
  if (i >= 0) o.profiles[i] = Object.assign({}, o.profiles[i], prof); else o.profiles.push(prof);
  if (makeActive) {
    o.active_profile = prof.key;
    const cur = Array.isArray(o.active_profiles) ? o.active_profiles : (S.data.active_profiles || []);
    o.active_profiles = [prof.key].concat(cur.filter(k => k !== prof.key));
  }
}
function defaultLevel(k) {
  const f = (S.data.taxonomy[k] || {}).family;
  return PRIMARY_FAMILIES.includes(f) ? 'primary' : ADJACENT_FAMILIES.includes(f) ? 'adjacent' : 'secondary';
}
function detectSkills(text) {
  const flat = text.replace(/\s+/g, ' ');
  const found = [];
  for (const [k, t] of Object.entries(S.data.taxonomy || {})) {
    for (const pat of t.patterns || []) {
      let re; try { re = new RegExp(pat, 'i'); } catch (e) { continue; }
      const mt = re.exec(flat);
      if (mt) {
        const s = Math.max(0, mt.index - 55), e = Math.min(flat.length, mt.index + mt[0].length + 55);
        found.push({ key: k, evidence: (s > 0 ? '…' : '') + flat.slice(s, e).trim() + (e < flat.length ? '…' : '') });
        break;
      }
    }
  }
  return found;
}
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load failed')); document.head.append(s); });
}
async function extractText(file, m) {
  const name = file.name.toLowerCase();
  if (/\.(txt|md)$/.test(name)) return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('Could not read file.')); fr.readAsText(file); });
  if (name.endsWith('.pdf')) {
    m.set('Loading PDF reader…');
    let pdfjs;
    try {
      pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
    } catch (e) { throw new Error('The PDF reader could not be loaded (are you offline?). Please export your resume as a TXT file and upload that instead.'); }
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let txt = '';
    for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const c = await pg.getTextContent(); txt += c.items.map(x => x.str).join(' ') + '\n'; }
    return txt;
  }
  if (name.endsWith('.docx')) {
    m.set('Loading DOCX reader…');
    try { if (!window.mammoth) await loadScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js'); } catch (e) { throw new Error('The DOCX reader could not be loaded (are you offline?). Please export your resume as a TXT file and upload that instead.'); }
    const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value || '';
  }
  throw new Error('Unsupported file type. Use PDF, DOCX, TXT or MD.');
}
/* ---------- skill questions (feature map M7) ---------- */
// Skills your own leads keep naming that a profile does not list. Nothing changes until you answer: "Yes" or "Some
// exposure" is a profile save (the next run rescores), "Not me" is remembered in the overrides file.
function gapItems() {
  const all = (S.data.acquisition || {}).skill_gaps;
  if (!Array.isArray(all)) return null;  // settings.profile_gaps is off
  const gone = (S.overrides && S.overrides.skill_gaps_dismissed) || {};
  const profs = new Map(effProfiles().map(p => [p.key, p]));
  return all.filter(it => it && typeof it.skill === 'string' && !gone[it.skill] && Array.isArray(it.profiles) &&
    it.profiles.some(pp => pp && profs.has(pp.key) && !((profs.get(pp.key).skills || {})[it.skill])));
}
async function answerGap(it, level, rerender) {
  if (!getToken()) { S.gapMsg = ['Add a GitHub token in Settings first. Saving profiles needs it.', 'err']; rerender(); return; }
  const names = [];
  try {
    await saveOverrides(o => {
      names.length = 0;
      const adds = o.skill_additions = (o.skill_additions && typeof o.skill_additions === 'object') ? o.skill_additions : {};
      const at = new Date().toISOString();
      for (const pp of it.profiles) {  // from the file just read, so a save from another device is kept
        const base = (S.data.profiles || []).find(x => x.key === pp.key);
        const saved = Array.isArray(o.profiles) ? o.profiles.find(x => x && x.key === pp.key) : null;
        if (!base && !saved) continue;
        const listed = ((saved && saved.skills) || (base && base.skills) || {})[it.skill] || (adds[pp.key] || {})[it.skill];
        if (listed) continue;
        // Added on its own (skill_additions): other skills, keywords and later config changes stay as they are.
        adds[pp.key] = Object.assign({}, adds[pp.key], { [it.skill]: { level, at } });
        // A full profile save in the file lists every skill; without this one it would reject the new skill next run.
        if (saved && saved.skills && typeof saved.skills === 'object') saved.skills = Object.assign({}, saved.skills, { [it.skill]: { level } });
        names.push((saved && saved.name) || (base && base.name) || pp.name || pp.key);
      }
    }, 'Profile skills: add ' + it.skill + ' (' + level + ')');
    S.gapMsg = [names.length ? it.label + ' added to ' + names.join(', ') + ' as ' + level + '. Scores change on the next run.'
      : it.label + ' is already in those profiles.', 'ok'];
  } catch (e) { S.gapMsg = [(e.message || 'Save failed') + ' Nothing was changed.', 'err']; }
  rerender();
}
async function dismissGap(it, rerender) {
  if (!getToken()) { S.gapMsg = ['Add a GitHub token in Settings first. Saving profiles needs it.', 'err']; rerender(); return; }
  try {
    await saveOverrides(o => {
      o.skill_gaps_dismissed = Object.assign({}, o.skill_gaps_dismissed || {}, { [it.skill]: new Date().toISOString() });
    }, 'Skill question: not me (' + it.skill + ')');
    S.gapMsg = [it.label + ': noted, it will not be asked again.', 'ok'];
  } catch (e) { S.gapMsg = [(e.message || 'Save failed') + ' Nothing was changed.', 'err']; }
  rerender();
}
function gapSection(rerender) {
  const items = gapItems();
  if (items === null) return null;
  const msg = S.gapMsg;
  if (!items.length && !msg) return null;
  const box = el('section', { class: 'card gaps', 'data-role': 'skill-gaps' }, el('h2', { text: 'Do you have these skills?' }),
    el('p', { class: 'small muted', text: items.length ? "Your leads keep naming these and your profiles don't list them, so those leads lose points. " +
      'Add one only if it is really yours: scores change on the next run, and drafts still use only your confirmed proof points.'
      : 'No skill questions are waiting.' }));
  if (msg) box.append(el('p', { class: 'msg ' + (msg[1] || 'ok'), text: msg[0] }));
  for (const it of items) {
    const n = Number(it.leads) || 0, strong = Number(it.strong) || 0, days = Number(it.days) || 30;
    const where = it.profiles.filter(pp => pp && pp.key).map(pp => (pp.name || pp.key) + ' ' + (Number(pp.leads) || 0)).join(', ');
    const buttons = [];
    const lock = () => buttons.forEach(b => { b.disabled = true; });
    buttons.push(el('button', { type: 'button', class: 'primary', text: 'Yes, real work', 'aria-label': 'Yes, real work with ' + it.label,
      on: { click: () => { lock(); answerGap(it, 'secondary', rerender); } } }));
    buttons.push(el('button', { type: 'button', text: 'Some exposure', 'aria-label': 'Some exposure to ' + it.label,
      on: { click: () => { lock(); answerGap(it, 'adjacent', rerender); } } }));
    buttons.push(el('button', { type: 'button', class: 'small-btn', text: 'Not me', 'aria-label': 'Not me: ' + it.label,
      on: { click: () => { lock(); dismissGap(it, rerender); } } }));
    box.append(el('div', { class: 'gap-item', 'data-skill': it.skill },
      el('h3', { text: it.label || it.skill }),
      el('p', { class: 'small', text: n + ' lead' + (n === 1 ? '' : 's') + ' in the last ' + days + ' days named it' +
        (strong ? ' (' + strong + ' Qualified or Needs verification)' : '') + '. By profile: ' + where + '.' }),
      Array.isArray(it.examples) && it.examples.length ? el('p', { class: 'small muted', text: 'For example: ' + it.examples.map(String).join(' · ') }) : null,
      el('div', { class: 'btn-row' }, buttons)));
  }
  return box;
}
function viewProfile(app) {
  const m = msgBox();
  app.append(el('h1', { text: 'Profile & resume' }));
  const ident = (S.data.outreach && S.data.outreach.identity) || {};
  const rz = ident.resume || {};
  const rzRows = Object.entries(rz).filter(([, u]) => safeUrl(u));
  app.append(el('div', { class: 'card' }, el('h2', { text: 'Your resume' }),
    el('p', { text: (ident.name || '') + (ident.headline ? ' · ' + ident.headline : '') }),
    rzRows.length ? el('div', { class: 'btn-row' }, rzRows.map(([k, u]) => link(u, 'Open ' + k.replace(/_/g, ' '), 'btn')))
      : el('p', { class: 'muted', text: 'No resume link set. Add one under More → Outreach settings.' }),
    el('p', { class: 'small muted', text: 'This link goes into every application message for matching tracks. To change it, edit the resume links in Outreach settings.' })));
  const listCard = el('div', { class: 'card' });
  const resumeCard = el('div', { class: 'card' });
  const renderProfiles = () => {
    clear(listCard);
    const actives = effActiveProfiles();
    const boxes = effProfiles().map(p => ({ key: p.key, c: el('input', { type: 'checkbox', checked: actives.includes(p.key), 'aria-label': 'Active: ' + (p.name || p.key) }), name: p.name || p.key }));
    listCard.append(el('h2', { text: 'Active profiles' }),
      el('p', { class: 'small muted', text: 'Leads are scored against every ticked profile and shown under the best-fitting one.' }),
      el('div', { class: 'checks one-col' }, boxes.map(b => el('label', { class: 'check' }, b.c, el('span', { text: b.name })))),
      el('div', { class: 'btn-row' }, el('button', { class: 'primary', type: 'button', id: 'save-actives', text: 'Save active profiles', on: { click: () => {
        const sel = boxes.filter(b => b.c.checked).map(b => b.key);
        if (!sel.length) { m.set('Tick at least one profile.', 'err'); return; }
        doSave(() => { S.__o.active_profiles = sel; S.__o.active_profile = sel[0]; }, 'Set active profiles: ' + sel.join(', '));
      } } })),
      el('h2', { text: 'Profiles' }));
    for (const p of effProfiles()) {
      const kw = el('input', { type: 'text', 'aria-label': 'Keywords for ' + p.name, value: (p.keywords || []).join(', ') });
      const isActive = actives.includes(p.key);
      const entries = Object.entries(p.skills || {});
      listCard.append(el('details', { class: 'prof' , open: isActive },
        el('summary', { class: 'check' }, el('strong', { text: p.name || p.key }), isActive ? el('span', { class: 'active-mark', text: ' • active' }) : null),
        el('div', { class: 'skills' }, entries.map(([k, v]) => el('span', { class: 'skill', text: skillLabel(k) + ' (' + (v.level || '?') + ')' }))),
        el('label', { class: 'field' }, el('span', { text: 'Keywords (comma separated)' }), kw),
        el('div', { class: 'btn-row' },
          el('button', { type: 'button', text: 'Save keywords', on: { click: () => doSave(() => upsertProfile(S.__o, Object.assign(profileForSave(p), { keywords: csv(kw.value) }), false), 'Update keywords for ' + p.key) } }),
          null)));
    }
  };
  async function doSave(fn, msg, runAfter) {
    if (!getToken()) { m.set('Add a GitHub token in Settings first. Saving profiles needs it.', 'err'); return false; }
    m.set('Saving…');
    try {
      await saveOverrides((o) => { S.__o = o; fn(); }, msg);
      m.set('Saved to GitHub. It takes effect on the next run.', 'ok'); renderProfiles();
      if (runAfter) await runNow(m);
      return true;
    } catch (e) { m.set(e.message, 'err'); return false; }
  }
  const fileIn = el('input', { type: 'file', id: 'resume-file', accept: '.pdf,.docx,.txt,.md' });
  const result = el('div');
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; clear(result); if (!f) return;
    m.set('Reading resume…');
    let text;
    try { text = await extractText(f, m); } catch (e) { m.set(e.message || 'Could not read that file.', 'err'); return; }
    if (!text || text.trim().length < 20) { m.set('No text found in that file. If it is a scanned PDF, export a TXT version.', 'err'); return; }
    const found = detectSkills(text);
    m.set(found.length ? 'Found ' + found.length + ' skills. Review below. The file itself stays on this device.' : 'No known skills detected in this resume.', found.length ? 'ok' : 'err');
    if (!found.length) return;
    const rows = found.map(f2 => {
      const lvl = defaultLevel(f2.key);
      const cb = el('input', { type: 'checkbox', checked: lvl !== 'adjacent', 'aria-label': 'Include ' + skillLabel(f2.key) });
      const ls = el('select', { 'aria-label': 'Level for ' + skillLabel(f2.key) }, ['primary', 'secondary', 'adjacent'].map(x => el('option', { value: x, text: x })));
      ls.value = lvl;
      return { key: f2.key, cb, ls, node: el('div', { class: 'skill-row' }, cb, el('div', { class: 'sr-main' }, el('strong', { text: skillLabel(f2.key) }), el('div', { class: 'evidence', text: f2.evidence }), ls)) };
    });
    const nameIn = el('input', { type: 'text', id: 'prof-name', value: 'My resume' });
    const build = () => {
      const name = nameIn.value.trim() || 'My resume'; const key = slug(name);
      const skills = {}; for (const r of rows) if (r.cb.checked) skills[r.key] = { level: r.ls.value };
      const existing = effProfiles().find(p => p.key === key);
      return { key, name, keywords: existing ? (existing.keywords || []) : [], skills, replace_skills: true };
    };
    const save = (run) => () => {
      const prof = build();
      if (!Object.keys(prof.skills).length) { m.set('Select at least one skill.', 'err'); return; }
      doSave(() => upsertProfile(S.__o, prof, true), 'Save resume profile ' + prof.key, run);
    };
    result.append(el('h2', { text: 'Detected skills' }), el('p', { class: 'small muted', text: 'Untick anything that is not really yours. Only this confirmed list is saved, never the resume text.' }),
      ...rows.map(r => r.node), el('label', { class: 'field' }, el('span', { text: 'Profile name' }), nameIn),
      el('div', { class: 'btn-row' }, el('button', { class: 'primary', type: 'button', text: 'Save as profile & make active', on: { click: save(false) } }), el('button', { type: 'button', text: 'Save & run now', on: { click: save(true) } })));
  });
  resumeCard.append(el('h2', { text: 'Upload resume' }), el('p', { class: 'small muted', text: 'PDF, DOCX, TXT or MD. Parsed in your browser; the file is never uploaded.' }),
    el('label', { class: 'field' }, el('span', { text: 'Resume file' }), fileIn), result);
  const gapHolder = el('div');
  const renderGaps = () => { clear(gapHolder); const section = gapSection(() => { renderGaps(); renderProfiles(); }); if (section) gapHolder.append(section); };
  app.append(m, gapHolder, resumeCard, listCard);
  renderGaps(); renderProfiles();
  ensureOverrides().then(() => { if (document.body.contains(listCard)) { renderGaps(); renderProfiles(); } });
}

/* ---------- filters (saved preferences) ---------- */
function checkGroup(legend, options, selected) {
  const boxes = options.map(o => ({ o, c: el('input', { type: 'checkbox', checked: selected.includes(o) }) }));
  return { node: el('fieldset', null, el('legend', { text: legend }), el('div', { class: 'checks' }, boxes.map(b => el('label', { class: 'check' }, b.c, el('span', { text: b.o }))))), get: () => boxes.filter(b => b.c.checked).map(b => b.o) };
}
function viewFilters(app) {
  const m = msgBox();
  app.append(el('h1', { text: 'Scoring filters' }), el('p', { class: 'muted', text: 'These are saved scoring preferences: they change how leads are classified on the next run. They are separate from the quick view filters on the Leads screen.' }), m);
  const holder = el('div'); app.append(holder);
  const build = () => {
    clear(holder);
    const d = S.data; const ov = S.overrides || {};
    const pr = Object.assign({}, d.preferences, ov.preferences); const cd = Object.assign({}, d.candidate, ov.candidate);
    const preset = ov.active_preset || d.preset;
    const g = {};
    g.ct = checkGroup('Allowed job types (none ticked = all)', CONTRACT_TYPES, pr.allowed_contract_types || []);
    const aC = pr.allowed_company_countries || [];
    g.co = checkGroup('Allowed company countries (none ticked = all)', COUNTRIES, aC);
    g.el = checkGroup('Allowed eligibility (none ticked = all except restricted)', ELIGIBILITIES, pr.allowed_eligibility || []);
    const chk = (label, val) => { const c = el('input', { type: 'checkbox', checked: !!val }); return { c, node: el('label', { class: 'check' }, c, el('span', { text: label })) }; };
    const txt = (label, val, type) => { const i = el('input', { type: type || 'text', value: val ?? '', inputmode: type === 'number' ? 'decimal' : null }); return { i, node: el('label', { class: 'field' }, el('span', { text: label }), i) }; };
    const kuc = chk('Keep jobs with unknown job type', pr.keep_unknown_contract_type);
    const kcc = chk('Keep jobs with unknown company country', pr.keep_unknown_company_country);
    const inr = chk('Show INR-paid jobs (inr_visible)', pr.inr_visible);
    const dom = chk('Domestic (Indian) clients can qualify', pr.domestic_clients_qualify);
    const otherC = txt('Other allowed countries (comma separated codes)', aC.filter(c => !COUNTRIES.includes(c)).join(', '));
    const exC = txt('Excluded company countries (comma separated codes)', (pr.excluded_company_countries || []).join(', '));
    const maxAge = txt('Max posting age in days (0 = no limit)', pr.max_posting_age_days ?? 0, 'number');
    const blocked = txt('Blocked keywords (comma separated)', (pr.blocked_keywords || []).join(', '));
    const minH = txt('Min hours per week', cd.min_hours_per_week, 'number');
    const maxH = txt('Max hours per week', cd.max_hours_per_week, 'number');
    const tgt = txt('Target hourly rate (USD, minimum)', cd.target_hourly_usd_min, 'number');
    const presets = d.presets || {};
    const ps = el('select', { id: 'preset' }, Object.keys(presets).map(k => el('option', { value: k, text: k.replace(/_/g, ' ') })));
    ps.value = preset;
    const pd = el('p', { class: 'small muted', text: presets[ps.value] || '' });
    ps.addEventListener('change', () => { pd.textContent = presets[ps.value] || ''; });
    const num = (i, fallback) => { const n = parseFloat(i.value); return isNaN(n) ? fallback : n; };
    const collect = () => ({
      pref: {
        allowed_contract_types: g.ct.get(), keep_unknown_contract_type: kuc.c.checked,
        allowed_company_countries: Array.from(new Set(g.co.get().concat(upperCsv(otherC.i.value)))), keep_unknown_company_country: kcc.c.checked,
        excluded_company_countries: upperCsv(exC.i.value), allowed_eligibility: g.el.get(), inr_visible: inr.c.checked, domestic_clients_qualify: dom.c.checked,
        max_posting_age_days: Math.max(0, Math.round(num(maxAge.i, 0))), blocked_keywords: csv(blocked.i.value),
      },
      cand: { min_hours_per_week: num(minH.i, cd.min_hours_per_week), max_hours_per_week: num(maxH.i, cd.max_hours_per_week), target_hourly_usd_min: num(tgt.i, cd.target_hourly_usd_min) },
      preset: ps.value,
    });
    const doSave = async (run) => {
      if (!getToken()) { m.set('Add a GitHub token in Settings first. Saving filters needs it.', 'err'); return; }
      const c = collect(); m.set('Saving…');
      try {
        await saveOverrides((o) => { o.preferences = Object.assign({}, o.preferences, c.pref); o.candidate = Object.assign({}, o.candidate, c.cand); o.active_preset = c.preset; }, 'Update scoring filters');
        m.set('Saved to GitHub. It takes effect on the next run.', 'ok');
        if (run) await runNow(m);
      } catch (e) { m.set(e.message, 'err'); }
    };
    holder.append(
      g.ct.node, el('div', null, kuc.node), g.co.node, otherC.node, el('div', null, kcc.node), exC.node, g.el.node,
      el('div', null, inr.node, dom.node), el('div', { class: 'grid-fields' }, maxAge.node, blocked.node, minH.node, maxH.node, tgt.node),
      el('label', { class: 'field' }, el('span', { text: 'Active preset' }), ps), pd,
      el('div', { class: 'btn-row' }, el('button', { class: 'primary', type: 'button', text: 'Save', on: { click: () => doSave(false) } }), el('button', { type: 'button', text: 'Save & run now', on: { click: () => doSave(true) } })));
  };
  build();
  if (getToken() && !S.overrides) ensureOverrides().then(() => { if (S.overrides && location.hash === '#filters' && !holder.dataset.touched) build(); });
  holder.addEventListener('input', () => { holder.dataset.touched = '1'; }, { once: true });
}

/* ---------- settings ---------- */
function viewSettings(app) {
  const m = msgBox();
  const repo = el('input', { type: 'text', id: 'repo', value: getRepo(), autocapitalize: 'none', autocomplete: 'off', placeholder: 'owner/name' });
  const tok = el('input', { type: 'password', id: 'token', autocomplete: 'off', autocapitalize: 'none', placeholder: getToken() ? '(token saved - leave blank to keep)' : 'github_pat_…' });
  const rem = el('input', { type: 'checkbox', id: 'remtoken', checked: store.isLocal('or.token') });
  const persist = () => {
    const r = repo.value.trim();
    if (r) { try { localStorage.setItem('or.repo', r); } catch (e) { /* storage blocked: kept for this page only */ } }
    if (tok.value.trim()) store.set('or.token', tok.value.trim(), rem.checked);
    else if (getToken()) { const t = getToken(); store.set('or.token', t, rem.checked); }
    tok.value = '';
  };
  const pendingN = pendingChangeCount();
  app.append(el('h1', { text: 'Settings' }),
    el('div', { class: 'card' },
      el('label', { class: 'field' }, el('span', { text: 'Repository' }), repo),
      el('label', { class: 'field' }, el('span', { text: 'GitHub token' }), tok),
      el('details', null, el('summary', { text: 'How to create the token' }),
        el('p', null, 'Create a fine-grained personal access token at ', link('https://github.com/settings/personal-access-tokens/new', 'github.com/settings/personal-access-tokens/new'),
          '. Limit it to ONLY this repository, and grant permissions Actions: Read and write and Contents: Read and write. Choose any expiry you like.')),
      el('label', { class: 'check' }, rem, el('span', { text: 'Remember on this device' })),
      el('div', { class: 'btn-row' },
        el('button', { class: 'primary', type: 'button', text: 'Save settings', on: { click: () => { persist(); m.set('Saved.', 'ok'); tok.placeholder = '(token saved - leave blank to keep)'; } } }),
        el('button', { type: 'button', text: 'Test token', on: { click: async () => {
          persist(); m.set('Testing…');
          try {
            const lines = [];
            const j = await gh('GET', '', null, 'Metadata: read');
            lines.push('✓ Repository: ' + j.full_name);
            try { await gh('GET', '/contents/README.md?ref=main', null, 'Contents: read'); lines.push('✓ Contents: read'); }
            catch (e2) { lines.push('✗ Contents: ' + e2.message); }
            try { await gh('GET', '/actions/workflows/' + WORKFLOW, null, 'Actions: read'); lines.push('✓ Actions: read (write is checked when you press Run now)'); }
            catch (e3) { lines.push('✗ Actions: ' + e3.message); }
            if (j.permissions && j.permissions.push === false) lines.push('✗ Token is read-only: give it Contents and Actions "Read and write".');
            const bad = lines.some((x) => x.startsWith('✗'));
            m.set(lines.join(' · '), bad ? 'err' : 'ok');
          }
          catch (e) { m.set(e.message, 'err'); }
        } } }),
        el('button', { class: 'danger', type: 'button', text: 'Forget on this device', on: { click: () => { store.del('or.token'); store.del('or.pass'); store.del('or.view'); store.del('or.repo');
          try { localStorage.removeItem(CONN_KEY); } catch (e) { /* nothing stored */ } S.conn = undefined; lock(); } } })),
      pendingN ? el('div', null, el('p', { class: 'pill warn', text: pendingN + ' change(s) waiting to sync' }), el('div', { class: 'btn-row' }, el('button', { type: 'button', text: 'Sync pending changes now', on: { click: async () => {
        persist(); m.set('Syncing…');
        try { await saveOverrides(() => {}, 'CRM: sync pending changes'); m.set('Synced.', 'ok'); } catch (e) { m.set(e.message, 'err'); }
      } } }))) : null, m),
    ...[warmSettingsCard()].filter(Boolean),  // native append() would print "null" when the feature is off
    el('div', { class: 'card' }, el('h2', { text: 'Outreach' }), el('p', { class: 'small muted', text: 'Identity, rates, tracks, proof points and message templates.' }), el('a', { class: 'btn', href: '#outreach', text: 'Outreach settings' })),
    el('div', { class: 'card' }, el('h2', { text: 'Privacy' }), el('p', { text: 'Lead data is encrypted at rest on GitHub Pages and decrypted only in this browser. Your resume text never leaves this device; only the skill list you confirm is saved. Your token stays in this browser and is only ever sent to api.github.com.' })));
}

/* ---------- drafts, apply kit, follow-ups ---------- */
const EMAIL_RE = /^[^\s@<>,;:"']+@[^\s@<>,;:"']+\.[^\s@<>,;:"']+$/;
async function copyText(t) {
  t = String(t == null ? '' : t);
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; } } catch (e) { /* fall back */ }
  const ta = el('textarea', { readonly: true, 'aria-hidden': 'true', tabindex: '-1', class: 'offscreen' });
  ta.value = t; document.body.append(ta); ta.focus(); ta.select();
  try { ta.setSelectionRange(0, t.length); } catch (e) { /* ignore */ }
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove(); return ok;
}
function copyBtn(label, getText, m, cls) {
  return el('button', { type: 'button', class: cls, text: label, on: { click: async () => {
    const ok = await copyText(getText());
    m.set(ok ? 'Copied: ' + label.replace(/^Copy /, '') + '.' : 'Could not copy. Select the text and copy it manually.', ok ? 'ok' : 'err');
  } } });
}
function mailtoHref(email, subject, body) {
  if (!EMAIL_RE.test(String(email || ''))) return null;
  const b = body.length > MAIL_BODY_MAX ? body.slice(0, MAIL_BODY_MAX) + '…' : body;
  return 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(b);
}
function gmailHref(email, subject, body) {
  if (!EMAIL_RE.test(String(email || ''))) return null;
  return safeUrl('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(email) + '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body));
}
/* Editable subject + body with copy / mail buttons. Edits persist in localStorage under o.key. */
function draftEditor(o) {
  const saved = o.key ? store.json(o.key, null) : null;
  const source = JSON.stringify([o.subject || '', o.body || '']);
  const current = saved && saved.source === source ? saved : null;
  const subj = el('input', { type: 'text', class: 'draft-subject', 'aria-label': 'Subject', maxlength: '300' });
  const body = el('textarea', { class: 'draft-body', rows: '12', 'aria-label': 'Message body' });
  subj.value = current ? current.s : (o.subject || ''); body.value = current ? current.b : (o.body || '');
  const m = msgBox();
  const hasMail = EMAIL_RE.test(String(o.email || ''));
  const note = el('p', { class: 'small muted' });
  const mailA = hasMail ? el('a', { class: 'btn', rel: 'noopener noreferrer', 'data-act': 'mailto', text: 'Email (mail app)' }) : null;
  const gmailA = hasMail ? el('a', { class: 'btn', target: '_blank', rel: 'noopener noreferrer', 'data-act': 'gmail', text: 'Open in Gmail' }) : null;
  const refresh = () => {
    if (hasMail) {
      mailA.setAttribute('href', mailtoHref(o.email, subj.value, body.value));
      const g = gmailHref(o.email, subj.value, body.value); if (g) gmailA.setAttribute('href', g);
      note.textContent = body.value.length > MAIL_BODY_MAX ? 'The mail-app link only carries the first ' + MAIL_BODY_MAX + ' characters (mailto limit). Use Open in Gmail or Copy message for the full text.' : '';
    }
  };
  const onEdit = () => { if (o.key) store.setJson(o.key, { s: subj.value, b: body.value, source }); refresh(); };
  subj.addEventListener('input', onEdit); body.addEventListener('input', onEdit);
  const reset = el('button', { type: 'button', text: 'Reset draft', on: { click: () => { if (o.key) store.del(o.key); subj.value = o.subject || ''; body.value = o.body || ''; refresh(); m.set('Draft reset to the generated text.', 'ok'); } } });
  refresh();
  const node = el('div', { class: 'draft' },
    el('label', { class: 'field' }, el('span', { text: 'Subject' }), subj),
    el('label', { class: 'field' }, el('span', { text: 'Message' }), body),
    el('div', { class: 'btn-row' }, copyBtn('Copy message', () => body.value, m, 'primary'), copyBtn('Copy subject', () => subj.value, m), ...(o.extra || []), reset),
    hasMail ? el('div', { class: 'btn-row' }, mailA, gmailA) : null, hasMail ? note : null, m);
  return { node, subj, body, msg: m, clear: () => { if (o.key) store.del(o.key); } };
}
function kitsOf(l) { return [l.apply_kit].concat(l.alt_kits || []).filter(Boolean); }
function selKit(l) {
  const kits = kitsOf(l); const k = store.json('or.kitsel.' + l.id, null);
  return kits.find(x => x.track === k) || kits[0] || null;
}
function dueDate(l, rec) {
  const at = parseDate(rec.occurred_at || rec.at);
  if (rec.follow_up_days != null) return Number(rec.follow_up_days) > 0 && at != null ? at + Number(rec.follow_up_days) * DAY_MS : null;
  return parseDate(l.follow_up_at);
}
function canFollowUp(obj, kit, rec) {
  return !!kit && kit.ready === true && kit.follow_up_allowed === true && kit.channel === 'email' &&
    !locallySuppressed(obj) && String(obj.status || 'OPEN').toUpperCase() === 'OPEN' &&
    (!obj.verification_revision || !verificationNeedsRebuild(obj)) &&
    ['Applied', 'Contacted'].includes(rec.status) && (rec.channel || obj.interaction_channel) === 'email';
}
// A5: an application made on a platform or a form, with drafts from outreach.quiet_follow_ups.
function canQuietFollowUp(obj, kit, rec) {
  return !!kit && Array.isArray(kit.quiet_follow_ups) && kit.quiet_follow_ups.length > 0 &&
    !locallySuppressed(obj) && String(obj.status || 'OPEN').toUpperCase() === 'OPEN' &&
    rec.status === 'Applied' && (rec.channel || obj.interaction_channel) !== 'email';  // a question asked is not an application
}
function fmtDay(ms) { return new Date(ms).toLocaleDateString([], { dateStyle: 'medium' }); }
async function setLeadStatus(l, status, note, days, m, ctx, kind = 'status', channel = '') {
  newInteraction('opportunity', l, status, note, days, kind, channel);
  if (!getToken()) { m.set('Saved on this device. It will sync once you add a GitHub token in Settings.', 'ok'); return true; }
  m.set('Saving…');
  try { await saveOverrides(() => {}, 'CRM: ' + (ctx || 'update') + ' ' + l.id); m.set('Saved and synced to GitHub.', 'ok'); return true; }
  catch (e) { m.set((e.message || 'Save failed') + ' Your change is kept on this device and will sync on the next successful save.', 'err'); return false; }
}
function applyKitSection(l) {
  const kits = kitsOf(l);
  const sec = el('section', { class: 'card kit', id: 'apply-kit' });
  const render = () => {
    clear(sec);
    const k = selKit(l);
    const m = msgBox();
    sec.append(el('h2', { text: 'Apply kit' }));
    if (k.warnings && k.warnings.length) sec.append(el('div', { class: 'amberbox', role: 'note' }, el('strong', { text: 'Check before sending' }), el('ul', { class: 'plain' }, k.warnings.map(w => el('li', { text: String(w) })))));
    if (kits.length > 1) {
      sec.append(el('div', { class: 'small muted', text: 'Pitch track' }), el('div', { class: 'seg', role: 'group', 'aria-label': 'Pitch track' }, kits.map(x =>
        el('button', { type: 'button', 'aria-pressed': x.track === k.track ? 'true' : 'false', text: x.track_name || x.track, on: { click: () => { store.setJson('or.kitsel.' + l.id, x.track); render(); } } }))));
    }
    if (!canDraftNow(l, k)) {
      sec.append(el('p', { class: 'msg warn', text: 'Draft unavailable for the current status, contact preferences or evidence checks.' }));
      if (l.apply_url) sec.append(link(l.apply_url, 'Review source', 'btn'));
      return;
    }
    sec.append(el('p', { class: 'small muted', text: 'Channel: ' + String(k.channel || '').replace(/_/g, ' ') + (k.resume_url ? ' · ' : '') }));
    if (k.resume_url) sec.lastChild.append(link(k.resume_url, 'resume'));
    const extra = [];
    if (k.short_answer) extra.push(copyBtn('Copy short answer', () => k.short_answer, m));
    const rz = (S.data.outreach && S.data.outreach.identity && S.data.outreach.identity.resume) || {};
    const rzUrl = k.channel === 'platform' ? null : k.resume_url || Object.values(rz).find(u => safeUrl(u));
    if (rzUrl && safeUrl(rzUrl)) extra.push(copyBtn('Copy resume link', () => rzUrl, m), link(rzUrl, 'Open resume (PDF)', 'btn'));
    if (k.platform_body) extra.push(copyBtn('Copy platform version', () => k.platform_body, m));
    const ed = draftEditor({ key: 'or.kit.' + l.id + '.' + k.track, subject: k.subject, body: k.body, email: k.contact_email, extra });
    sec.append(ed.node);
    if (k.platform_body) sec.append(el('p', { class: 'small muted', text: 'Platform version: for Upwork/LinkedIn/Contra: no links or email.' }));
    if (k.channel === 'hn_reply') sec.append(el('p', { class: 'small', text: 'Reply on Hacker News, or email if the post lists one.' }));
    const row = el('div', { class: 'btn-row' }); 
    if (l.apply_url && safeUrl(l.apply_url)) row.append(link(l.apply_url, 'Open application', 'btn'));
    const rec = effRec(l);
    const applyBtn = el('button', { type: 'button', class: 'primary', id: 'mark-applied', text: 'Mark as applied' });
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      const days = k.follow_up_allowed && k.channel === 'email' ? 4 : 0;
      const ok = await setLeadStatus(l, 'Applied', 'applied via ' + (k.channel || 'unknown') + ' (' + (k.track_name || k.track) + ')', days, m, 'mark applied', 'status', k.channel);
      if (ok) {
        for (const x of kits) store.del('or.kit.' + l.id + '.' + x.track);
        sec.querySelector('.fu-date').textContent = days ? 'Status: Applied. Follow-up due ' + fmtDay(Date.now() + days * DAY_MS) + ' (see Follow-ups).' : 'Status: Applied. No email follow-up scheduled for this channel.';
      }
      applyBtn.disabled = false;
    });
    row.append(applyBtn);
    sec.append(row, el('p', { class: 'small fu-date', text: rec.status === 'Applied' ? 'Status: Applied.' : '' }), m,
      el('p', { class: 'small muted', text: 'Nothing is sent automatically. Review before sending.' }));
  };
  render();
  return sec;
}
function viewFollowups(app) {
  app.append(el('h1', { text: 'Follow-ups' }), el('p', { class: 'muted small', text: 'Leads you applied to or contacted that are due (or due within 2 days). Nothing is sent automatically. Review before sending.' }));
  const box = el('div', { class: 'cards one' });
  app.append(box);
  const render = () => {
    if (!document.body.contains(box)) return;
    clear(box);
    const now = Date.now(); const fu = store.json('or.fu', {});
    const items = [];
    for (const l of S.data.leads) {
      if (l.reply_seen_at) continue;  // your email already shows a reply, invitation or rejection (Today → Inbox updates)
      const rec = effRec(l); const k = selKit(l);
      const quiet = !canFollowUp(l, k, rec) && canQuietFollowUp(l, k, rec);
      if (!quiet && !canFollowUp(l, k, rec)) continue;
      const note = String(rec.note || '');
      const count = Math.max(Number(l.follow_up_count || 0), Number(fu[l.id] || 0));
      if (/follow-up 2 sent/i.test(note) || count >= 2) continue;
      const stage = (/follow-up 1 sent/i.test(note) || count >= 1) ? 2 : 1;
      // A quiet application: due a set number of quiet days after you applied, or after follow-up 1.
      const base = parseDate(rec.occurred_at || rec.at); const step = quiet ? k.quiet_follow_ups[stage - 1] : null;
      const due = quiet ? (step && base != null ? base + Number(step.after_days || 7) * DAY_MS : null) : dueDate(l, rec);
      if (due == null || due > now + FOLLOWUP_WINDOW_DAYS * DAY_MS) continue;
      items.push({ l, rec, due, stage, quiet });
    }
    items.sort((a, b) => a.due - b.due);
    if (!items.length) { box.append(el('p', { class: 'muted', text: 'No follow-ups due right now.' })); return; }
    for (const { l, rec, due, stage, quiet } of items) {
      const k = selKit(l); const tpl = k && (quiet ? k.quiet_follow_ups : k.follow_ups) && (quiet ? k.quiet_follow_ups : k.follow_ups)[stage - 1];
      const m = msgBox();
      const dd = Math.round((due - now) / DAY_MS);
      const dueTxt = due <= now ? (dd < 0 ? 'overdue by ' + (-dd) + ' d' : 'due now') : 'due ' + fmtDay(due);
      const card = el('article', { class: 'card fu-card', 'data-id': l.id },
        el('a', { class: 'lead-title', href: '#lead/' + encodeURIComponent(l.id), text: l.title || '(untitled)' }),
        el('div', { class: 'meta' }, el('span', { text: l.company || '' }), el('span', { class: 'pill ' + (rec.status === 'Applied' ? 'ok' : 'warn'), text: rec.status }), el('span', { class: 'pill warn', text: dueTxt }), el('span', { class: 'pill', text: 'follow-up ' + stage })));
      if (!tpl) card.append(el('p', { class: 'muted', text: 'No follow-up draft stored for this lead.' }), l.apply_url && safeUrl(l.apply_url) ? el('div', { class: 'btn-row' }, link(l.apply_url, 'Open application', 'btn')) : null);
      else {
        const sent = el('button', { type: 'button', text: 'Mark follow-up sent' });
        const extra = [];
        if (l.apply_url && safeUrl(l.apply_url)) extra.push(link(l.apply_url, 'Open application', 'btn'));
        extra.push(sent);
        const ed = draftEditor({ key: 'or.fu.' + l.id + '.' + stage, subject: tpl.subject, body: tpl.body, email: quiet ? '' : k.contact_email, extra });
        sent.addEventListener('click', async () => {
          sent.disabled = true;
          const ok = quiet
            ? await setLeadStatus(l, rec.status, 'follow-up ' + stage + ' sent', null, ed.msg, 'follow-up ' + stage + ' sent', 'followup',
              ['platform', 'application_form', 'hn_reply'].includes(k.channel) ? k.channel : '')
            : await setLeadStatus(l, rec.status, 'follow-up ' + stage + ' sent', stage === 1 ? 6 : 0, ed.msg, 'follow-up ' + stage + ' sent', 'followup', 'email');
          if (ok) { const f = store.json('or.fu', {}); f[l.id] = stage; store.setJson('or.fu', f); ed.clear(); render(); } else sent.disabled = false;
        });
        if (quiet) card.append(el('p', { class: 'small muted', text: 'You applied ' + (k.channel === 'platform' ? 'on a platform' : 'through a form') +
          ', so there is no email thread. Send it where you can reach them: a reply to their confirmation email, or a message to the recruiter.' }));
        card.append(el('details', { open: true }, el('summary', { text: 'Follow-up ' + stage + ' draft' }), ed.node));
      }
      box.append(card);
    }
  };
  render();
  if (getToken() && !S.overrides) ensureOverrides().then(render);
}

/* ---------- prospects ---------- */
function viewProspects(app) {
  app.append(el('h1', { text: 'Prospects' }), el('p', { class: 'muted small', text: 'Review cited SFCC/OMS agency signals and prepare a personal message. Confirm ownership before using an unassigned record.' }));
  const box = el('div', { class: 'cards one' }); app.append(box);
  const render = () => {
    if (!document.body.contains(box)) return;
    clear(box);
    const target = decodeURIComponent((location.hash.split('/')[1] || ''));
    const list = (S.data.prospects || []).filter(p => !target || p.id === target);
    if (!list.length) box.append(el('p', { class: 'muted', text: 'No prospects yet.' }));
    for (const p of list) {
      const rec = effProspectRec(p);
      const m = msgBox();
      const st = el('select', { 'aria-label': 'Status for ' + p.company }, (S.data.crm_statuses || ['New']).map(s => el('option', { value: s, text: s })));
      st.value = rec.status || 'New';
      const note = el('input', { type: 'text', 'aria-label': 'Note for ' + p.company, maxlength: '500' }); note.value = rec.note || '';
      const save = el('button', { type: 'button', text: 'Save status', on: { click: async () => {
        if (p.owner_key !== ownerKey()) { m.set('Confirm this record belongs to your outreach first.', 'err'); return; }
        newInteraction('prospect', p, st.value, note.value, st.value === 'Contacted' && p.draft && p.draft.follow_up_allowed ? 4 : null, 'status', (p.draft && p.draft.channel) || 'manual');
        if (DRAFT_STOP_STATES.includes(st.value)) render();
        if (!getToken()) { m.set('Saved on this device; add a GitHub token to sync.', 'ok'); return; }
        save.disabled = true; m.set('Saving…');
        try {
          await saveOverrides(() => {}, 'Prospect status: ' + p.id);
          m.set('Saved and synced to GitHub.', 'ok');
        } catch (e) { m.set(e.message || 'Save failed', 'err'); }
        save.disabled = false;
      } } });
      const claim = !p.owner_key ? el('button', { type: 'button', text: 'Confirm for my outreach', on: { click: async () => {
        if (!getToken()) { m.set('Add a GitHub token to save ownership confirmation.', 'err'); return; }
        const event = { event_id: crypto.randomUUID(), subject_id: p.id, owner_key: ownerKey(), occurred_at: new Date().toISOString() };
        try {
          await saveOverrides(o => {
            const claims = Array.isArray(o.prospect_claims) ? o.prospect_claims : [];
            o.prospect_claims = claims.some(x => x && x.subject_id === event.subject_id && x.owner_key === event.owner_key) ? claims : claims.concat(event);
          }, 'Confirm prospect ownership: ' + p.id);
          m.set('Ownership confirmation saved. Rebuild the site to prepare this prospect for your outreach; previous sender history remains unassigned.', 'ok');
        } catch (e) { m.set(e.message || 'Save failed', 'err'); }
      } } }) : null;
      const d = p.draft;
      const ed = canDraftNow(p, d, true) ? draftEditor({ key: 'or.pdraft.' + p.id, subject: d.subject, body: d.body, email: '' }) : null;
      const due = dueDate(p, rec);
      const localStage = /follow-up 2 sent/i.test(rec.note || '') ? 2 : /follow-up 1 sent/i.test(rec.note || '') ? 1 : 0;
      const stage = Math.max(Number(p.follow_up_count || 0), localStage) + 1;
      let followup = null;
      if (canFollowUp(p, d, rec) && due != null && due <= Date.now() + FOLLOWUP_WINDOW_DAYS * DAY_MS && stage <= 2) {
        const tpl = (d.follow_ups || [])[stage - 1];
        if (tpl) {
          const sent = el('button', { type: 'button', text: 'Mark follow-up ' + stage + ' sent' });
          const fuEditor = draftEditor({ key: 'or.pfu.' + p.id + '.' + stage, subject: tpl.subject, body: tpl.body, extra: [sent] });
          sent.addEventListener('click', async () => {
            sent.disabled = true;
            newInteraction('prospect', p, rec.status, 'follow-up ' + stage + ' sent', stage === 1 ? 6 : 0, 'followup', 'email');
            if (!getToken()) { fuEditor.msg.set('Saved on this device, awaiting sync.', 'ok'); return; }
            try { await saveOverrides(() => {}, 'Prospect follow-up: ' + p.id); fuEditor.clear(); render(); }
            catch (e) { fuEditor.msg.set((e.message || 'Sync failed') + ' Action kept on this device.', 'err'); }
          });
          followup = el('details', { open: true }, el('summary', { text: 'Email follow-up ' + stage + ' · due ' + fmtDay(due) }), fuEditor.node);
        }
      }
      box.append(el('article', { class: 'card prospect', 'data-id': p.id },
        el('h2', { text: p.company || '(unnamed)' }),
        el('div', { class: 'meta' }, p.country ? el('span', { text: p.country }) : null, p.segment ? el('span', { class: 'pill', text: p.segment }) : null, p.platform ? el('span', { text: p.platform }) : null),
        p.need_signals ? el('p', null, el('strong', { text: 'Signals: ' }), p.need_signals) : null,
        p.pitch_angle ? el('p', null, el('strong', { text: 'Pitch: ' }), p.pitch_angle) : null,
        p.outreach_channel ? el('p', { class: 'small muted', text: 'Channel: ' + p.outreach_channel }) : null,
        p.website && safeUrl(p.website) ? el('p', null, link(p.website, 'Website')) : null,
        (p.evidence_urls || []).map(url => el('p', { class: 'small' }, link(url, 'Signal source'))),
        !p.owner_key ? el('p', { class: 'msg warn', text: 'Unassigned record: its past activity is not attributed to you.' }) : null,
        el('div', { class: 'grid-fields' }, el('label', { class: 'field' }, el('span', { text: 'Status' }), st), el('label', { class: 'field' }, el('span', { text: 'Note' }), note)),
        el('div', { class: 'btn-row' }, p.owner_key === ownerKey() ? save : claim), m, followup,
        d ? el('details', null, el('summary', { text: 'Draft message' }),
          (d.warnings && d.warnings.length) ? el('div', { class: 'amberbox', role: 'note' }, el('strong', { text: 'Check before sending' }), el('ul', { class: 'plain' }, d.warnings.map(w => el('li', { text: String(w) })))) : null,
          ed ? ed.node : el('p', { class: 'muted', text: 'Draft unavailable for the current status, contact preferences or evidence checks.' }), el('p', { class: 'small muted', text: 'Nothing is sent automatically. Review before sending.' })) : null));
    }
  };
  render();
  if (getToken() && !S.overrides) ensureOverrides().then(render);
}

/* ---------- more ---------- */
function viewMore(app) {
  app.append(el('h1', { text: 'More' }), el('div', { class: 'card more' },
    [...(reviewData() ? [['#review', 'Weekly review']] : []), ['#profile', 'Profile'], ['#run', 'Run'], ['#filters', 'Scoring filters'], ['#outreach', 'Outreach settings'], ['#settings', 'Settings']].map(([h, t]) => el('a', { class: 'btn big', href: h, text: t }))));
  if (S.data.learning) app.append(learnedRulesCard(S.data.learning));
  if (S.data.acquisition && S.data.acquisition.source_health) app.append(sourceHealthCard(S.data.acquisition.source_health));
}
/* Weekly review (settings.weekly_review, feature map F1–F2): the last weeks' actions and what came back (replies the
   inbox found count before you tap them), sources to cut, and next week's pitches. Read-only: the counts are as of
   the last rebuild; statuses and pitches are live on this device. */
function reviewData() {
  const r = S.data && S.data.acquisition && S.data.acquisition.weekly_review;
  return r && Array.isArray(r.weeks) && r.weeks.length ? r : null;
}
const REVIEW_STAGES = { replies: 'Replied', interviews: 'Interview', contracts: 'Contract', rejections: 'Said no' };
function reviewCount(v, one, many) { const k = Number(v || 0); return k + ' ' + (k === 1 ? one : many); }
function reviewRange(w) {
  const a = parseDate(w.since), b = parseDate(w.until);
  return a == null || b == null ? '' : fmtDay(a) + ' – ' + fmtDay(b);
}
function reviewCheck(label, check, text) {
  const met = check ? check.met : null;
  const pill = met === true ? el('span', { class: 'pill ok', text: 'Target met' })
    : met === false ? el('span', { class: 'pill warn', text: 'Target missed' }) : null;
  return el('div', { class: 'review-check' }, el('div', { class: 'queue-head' }, el('strong', { text: label }), pill),
    el('p', { class: 'small', text }));
}
function reviewWeekCard(w) {
  const n = v => Number(v || 0); const c = w.checks || {};
  const hours = c.alert_hours || {}; const pct = c.complete_pct || {};
  const back = reviewCount(w.replies, 'reply', 'replies') + ' · ' + reviewCount(w.interviews, 'interview', 'interviews') + ' · ' +
    reviewCount(w.contracts, 'contract', 'contracts') +
    (n(w.rejections) ? ' · ' + n(w.rejections) + ' said no' : '') +
    (n(w.detected) ? '. The inbox found ' + n(w.detected) + (n(w.untapped) ? ' (' + n(w.untapped) + ' not tapped yet)' : '') + '.' : '.');
  const channels = Array.isArray(w.by_channel) ? w.by_channel : [];
  return el('section', { class: 'card', 'data-role': 'review-week' }, el('h2', { text: 'Last 7 days' }),
    el('p', { class: 'small muted', text: reviewRange(w) }),
    reviewCheck('Questions and applications', c.actions, n(w.actions) + ' of ' + n((c.actions || {}).target) + ' (' +
      n(w.asked) + ' asked, ' + n(w.applied) + ' applied)'),
    reviewCheck('Pitches', c.pitches, n(w.pitched) + ' of ' + n((c.pitches || {}).target) +
      ': staffing firms, agencies and prospects first contacted'),
    reviewCheck('What came back', null, back),
    reviewCheck('Gmail alert to radar', hours, hours.value == null ? 'No Gmail leads in these 7 days.'
      : 'Median ' + hours.value + ' h over ' + reviewCount(hours.leads, 'lead', 'leads') + ' (target ' + hours.target + ' h)'),
    reviewCheck('Gmail job leads with a company and a location', pct, pct.value == null ? 'No Gmail job leads in these 7 days.'
      : pct.value + '% of ' + n(pct.leads) + ' (target ' + pct.target + '%)'),
    channels.length ? el('details', null, el('summary', { text: 'By channel (' + channels.length + ')' }),
      el('ul', { class: 'plain small' }, channels.map(r => el('li', null, el('strong', { text: r.channel }), ': ' +
        [reviewCount(r.actions, 'action', 'actions'), reviewCount(r.replies, 'reply', 'replies'),
          reviewCount(r.interviews, 'interview', 'interviews'), reviewCount(r.contracts, 'contract', 'contracts')].join(' → '))))) : null);
}
function reviewRepliesCard(items) {
  const leadIds = new Set(((S.data && S.data.leads) || []).map(l => l.id));
  const rows = items.map(x => {
    const name = x.kind === 'lead' ? [x.title, x.company].filter(Boolean).join(' · ') : (x.company || String(x.id));
    const href = x.kind === 'lead' ? (leadIds.has(x.id) ? '#lead/' + encodeURIComponent(x.id) : null)
      : x.kind === 'prospect' ? '#prospects/' + encodeURIComponent(x.id) : '#staffing';
    const when = parseDate(x.at);
    return el('li', { 'data-kind': x.kind },
      el('span', { class: 'pill' + (x.stage === 'rejections' ? '' : ' ok'), text: REVIEW_STAGES[x.stage] || String(x.stage) }), ' ',
      href ? el('a', { href, text: name || '(untitled)' }) : el('span', { text: name || '(untitled)' }),
      el('span', { class: 'small muted', text: ' · ' + [x.channel, when == null ? '' : fmtDay(when),
        x.tapped ? '' : 'found by the inbox, not tapped yet'].filter(Boolean).join(' · ') }));
  });
  return el('section', { class: 'card', 'data-role': 'review-replies' }, el('h2', { text: 'What came back' }),
    el('p', { class: 'small muted', text: 'Replies, interviews, contracts and refusals in the last 14 days, recorded by you or found by the inbox.' }),
    rows.length ? el('ul', { class: 'plain' }, rows) : el('p', { class: 'small muted', text: 'Nothing came back in the last 14 days.' }));
}
function reviewCutCard() {
  const sh = S.data.acquisition && S.data.acquisition.source_health;
  if (!sh) return null;
  const rows = (sh.sources || []).filter(r => r.enabled && (r.flag === 'consider_disabling' || r.flag === 'failing'));
  return el('section', { class: 'card', 'data-role': 'review-cut' }, el('h2', { text: 'Sources to cut or fix' }),
    rows.length ? el('ul', { class: 'plain small' }, rows.map(r => el('li', null,
      el('span', { class: 'pill ' + HEALTH_FLAGS[r.flag][0], text: HEALTH_FLAGS[r.flag][1] }), ' ', el('strong', { text: r.key }),
      r.flag_text ? ': ' + r.flag_text : ''))) : el('p', { class: 'small muted', text: 'No source is flagged.' }),
    el('p', { class: 'small' }, el('a', { href: '#more', text: 'Source health' }), ' has the numbers. Nothing is disabled automatically.'));
}
function reviewPitches(n) {
  const out = []; const seen = new Set(); const d = demandData();
  for (const c of d ? d.companies : []) {
    if (seen.has(c.id) || !demandPitch(c) || staffStatus(c) !== 'Not contacted') continue;
    seen.add(c.id);
    const k = Number(c.postings_30d) || 0;
    out.push({ c, why: 'Agency hiring for SFCC' + (k ? ' · ' + k + (k === 1 ? ' role' : ' roles') + ' in 30 days' : '') });
  }
  const q = staffQueueCfg();
  for (const c of q ? staffQueuePool(q) : []) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({ c, why: 'Staffing firm' + (STAFF_HIRES[c.hires_from] ? ' · ' + STAFF_HIRES[c.hires_from] : '') });
  }
  return out.slice(0, n);
}
function reviewPitchesCard(n) {
  const items = reviewPitches(n);
  return el('section', { class: 'card', 'data-role': 'review-pitches' }, el('h2', { text: 'Next week’s ' + n + ' pitches' }),
    el('p', { class: 'small muted', text: 'Agencies hiring for SFCC that have a pitch, then firms from the weekly queue. Copy each draft on the Staffing tab; nothing is sent for you.' }),
    items.length ? el('ol', { class: 'small' }, items.map(({ c, why }) => el('li', null, el('strong', { text: c.company || '(company)' }), ' · ' + why)))
      : el('p', { class: 'small muted', text: 'Nobody is waiting: every agency with a pitch and every queued firm has a status.' }),
    el('a', { class: 'btn small-btn', href: '#staffing', text: 'Open Staffing' }));
}
function reviewWeeksCard(weeks) {
  return el('section', { class: 'card', 'data-role': 'review-weeks' }, el('h2', { text: 'Last ' + weeks.length + ' weeks' }),
    el('ul', { class: 'plain small' }, weeks.map(w => el('li', null, el('strong', { text: reviewRange(w) }), ': ' +
      [reviewCount(w.actions, 'question or application', 'questions and applications'), reviewCount(w.pitched, 'pitch', 'pitches'),
        reviewCount(w.replies, 'reply', 'replies'), reviewCount(w.interviews, 'interview', 'interviews'),
        reviewCount(w.contracts, 'contract', 'contracts')].join(' · ')))));
}
function reviewTodayCard(now = Date.now()) {
  if (!reviewData() || new Date(now).getDay() !== 0) return null;
  return el('section', { class: 'card', 'data-role': 'review-link' }, el('h2', { text: 'Weekly review' }),
    el('p', { class: 'small', text: 'It’s Sunday: fifteen minutes for what came back, what to cut and next week’s pitches.' }),
    el('a', { class: 'btn small-btn', href: '#review', text: 'Open the review' }));
}
function viewReview(app) {
  app.append(el('h1', { text: 'Weekly review' }));
  const r = reviewData();
  if (!r) { app.append(el('p', { class: 'card muted', text: 'The weekly review is off (settings.weekly_review).' })); return; }
  const pitches = Math.max(1, Math.min(30, Number(r.pitches) || 10));
  app.append(el('p', { class: 'muted', text: 'Fifteen minutes: what came back, what to cut, whom to pitch next. Counts are as of the last rebuild (' +
      fmtDate(S.data.generated_at) + '); statuses and pitches are live on this device.' }),
    reviewWeekCard(r.weeks[0]), reviewRepliesCard(Array.isArray(r.replies) ? r.replies : []), ...[reviewCutCard()].filter(Boolean),
    reviewPitchesCard(pitches), ...(r.weeks.length > 1 ? [reviewWeeksCard(r.weeks)] : []));
  if (getToken() && !S.overrides) ensureOverrides().then(ov => { if (ov && location.hash === '#review') route(); });
}
const HEALTH_FLAGS = { failing: ['bad', 'Failing'], consider_disabling: ['warn', 'Consider disabling'], not_configured: ['warn', 'Not set up'] };
function sourceHealthCard(sh) {
  const n = v => Number(v || 0).toLocaleString();
  const card = el('section', { class: 'card', id: 'source-health', 'data-role': 'source-health' }, el('h2', { text: 'Source health' }),
    el('p', { class: 'small muted', text: 'Fetched and relevant add up every run (a listing that stays up counts each time). New, Qualified and ' +
      'Needs verification count leads the source found first in that window. Flags are hints: nothing is disabled automatically.' }));
  for (const r of sh.sources || []) {
    const flag = Object.prototype.hasOwnProperty.call(HEALTH_FLAGS, r.flag) ? HEALTH_FLAGS[r.flag] : null;
    const idle = (!r.enabled || r.flag === 'not_configured') &&
      Object.values(r.windows || {}).every(x => !x || ['fetched', 'relevant', 'new'].every(k => !x[k]));
    const windows = idle ? [] : (sh.windows || []).map(String).map(w => {
      const x = (r.windows || {})[w] || {};
      return el('p', { class: 'small', text: w + ' days: ' + n(x.fetched) + ' fetched · ' + n(x.relevant) + ' relevant · ' + n(x.new) + ' new · ' +
        n(x.qualified) + ' Qualified · ' + n(x.needs_verification) + ' Needs verification' + (x.failed ? ' · ' + n(x.failed) + ' failed run' + (x.failed === 1 ? '' : 's') : '') });
    });
    card.append(el('div', { class: 'health-row' + (r.enabled ? '' : ' muted'), 'data-key': r.key },
      el('div', { class: 'queue-head' }, el('strong', { text: r.key }),
        el('span', { class: 'pill ' + (r.status === 'success' ? 'ok' : r.status === 'failed' || r.status === 'circuit_open' ? 'bad' : ''), text: sourceStatus(r.status) }),
        flag ? el('span', { class: 'pill ' + flag[0], text: flag[1] }) : null,
        r.last_run_at ? el('span', { class: 'small muted', text: 'last run ' + fmtDate(r.last_run_at) }) : null),
      windows,
      r.flag_text ? el('p', { class: 'small', text: r.flag_text }) : null,
      r.setup_url ? el('p', { class: 'small' }, link(r.setup_url, 'Open the setup step')) : null,
      r.last_error ? (r.flag === 'not_configured'
        ? el('p', { class: 'small muted', text: 'Waiting for: ' + r.last_error })
        : el('p', { class: 'small err', text: 'Last error' + (r.last_error_at ? ' (' + fmtDate(r.last_error_at) + ')' : '') + ': ' + r.last_error })) : null));
  }
  return card;
}
function pendingLearningReset(id, computedAt) {
  const resets = (S.overrides && S.overrides.learning_resets) || {};
  const at = parseDate(resets[id]) ?? parseDate(resets.all);
  return at != null && at > (parseDate(computedAt) ?? 0);
}
async function saveLearningReset(id, m) {
  if (!getToken()) { m.set('Add a GitHub token in Settings first. Resets are saved to your private repository.', 'err'); return false; }
  m.set('Saving…');
  try {
    await saveOverrides(o => { o.learning_resets = Object.assign({}, o.learning_resets, { [id]: new Date().toISOString() }); },
      'Learned rules: reset ' + id);
    m.set('Reset saved. The rule stops applying on the next rebuild; your feedback history is kept.', 'ok');
    return true;
  } catch (e) { m.set(e.message || 'Save failed', 'err'); return false; }
}
async function addBlockedKeyword(phrase, m) {
  if (!getToken()) { m.set('Add a GitHub token in Settings first.', 'err'); return false; }
  m.set('Saving…');
  try {
    await saveOverrides(o => {
      const prefs = Object.assign({}, S.data.preferences, o.preferences);
      const current = Array.isArray(prefs.blocked_keywords) ? prefs.blocked_keywords : [];
      o.preferences = Object.assign({}, o.preferences, { blocked_keywords: Array.from(new Set(current.concat(phrase))) });
    }, 'Scoring filters: block keyword ' + phrase);
    m.set('Added to blocked keywords. Matching leads are excluded from the next run (edit in Scoring filters).', 'ok');
    return true;
  } catch (e) { m.set(e.message || 'Save failed', 'err'); return false; }
}
function learnedRulesCard(lr) {
  const m = msgBox();
  const card = el('section', { class: 'card', id: 'learned-rules', 'data-role': 'learned-rules' }, el('h2', { text: 'Learned rules' }));
  if (!lr.enabled) {
    card.append(el('p', { class: 'muted', text: 'Learning is off. Turn it on with scoring.learning.enabled in config/scoring.example.yaml.' }));
    return card;
  }
  card.append(el('p', { class: 'small muted', text: 'Small, capped adjustments learned from your Not a fit reasons. They apply from the next run; reset one to drop its effect (your feedback history is kept).' }));
  const reasons = Object.entries(lr.by_reason || {}).filter(([, n]) => n > 0);
  card.append(el('p', { class: 'small', text: reasons.length
    ? 'Not a fit so far: ' + reasons.map(([k, n]) => reasonLabel(k) + ' ' + n).join(' · ')
    : 'No Not a fit reasons recorded yet. Use the buttons on lead cards.' }));
  const th = lr.thresholds || {};
  const rule = (item, buttons) => el('div', { class: 'rule', 'data-id': item.id },
    el('p', { text: item.text || item.id }),
    pendingLearningReset(item.id, lr.computed_at) ? el('p', { class: 'small pill warn', text: 'Reset saved; applies on the next rebuild' }) : null,
    el('div', { class: 'btn-row' }, buttons));
  const resetBtn = (item, text) => el('button', { type: 'button', class: 'small-btn', text: text || 'Reset', on: { click: () => saveLearningReset(item.id, m) } });
  const active = lr.rules || [];
  card.append(el('h3', { text: 'Active (' + active.length + ')' }));
  if (!active.length) card.append(el('p', { class: 'small muted', text: 'None yet. A company needs ' + ((th.company_demotion || {}).min_marks || 2) +
    ' Agency spam marks; a skill needs ' + ((th.skill_weight || {}).min_marks || 3) + ' Wrong stack marks.' }));
  for (const r of active) {
    const see = r.type === 'company_demotion' ? el('a', { class: 'btn small-btn', href: '#leads', text: 'See leads',
      on: { click: () => { S.view = Object.assign(defaultLeadView(), { q: r.label || r.target, roleScope: 'all', parts: PARTITIONS.slice(), temp: r.label || r.target }); } } }) : null;
    card.append(rule(r, [resetBtn(r), see]));
  }
  const sugg = lr.suggestions || [];
  if (sugg.length) {
    card.append(el('h3', { text: 'Suggestions (' + sugg.length + ')' }), el('p', { class: 'small muted', text: 'Never applied automatically. Adding a keyword excludes every lead that contains it.' }));
    for (const sg of sugg) card.append(rule(sg, [
      el('button', { type: 'button', class: 'small-btn primary', text: 'Block “' + sg.phrase + '”', on: { click: () => addBlockedKeyword(sg.phrase, m) } }),
      resetBtn(sg, 'Dismiss')]));
  }
  const notes = lr.notes || [];
  if (notes.length) {
    card.append(el('h3', { text: 'Notes (' + notes.length + ')' }));
    for (const n of notes) card.append(rule(n, [resetBtn(n, 'Dismiss')]));
  }
  if (active.length || sugg.length || notes.length) card.append(el('div', { class: 'btn-row' },
    el('button', { type: 'button', class: 'danger', text: 'Reset all learned rules', on: { click: () => saveLearningReset('all', m) } })));
  card.append(m, el('p', { class: 'small muted', text: 'Last computed ' + (fmtDate(lr.computed_at) || 'never') + '. Thresholds and caps: scoring.learning in config/scoring.example.yaml.' }));
  if (getToken() && !S.overrides) ensureOverrides().then(ov => { if (ov && location.hash === '#more') route(); });
  return card;
}

/* ---------- outreach settings ---------- */
const IDENT_FIELDS = [['headline', 'Headline'], ['email', 'Email'], ['linkedin', 'LinkedIn URL'], ['location', 'Location'], ['overlap', 'Time-zone overlap'], ['postal_address', 'Postal address'], ['portfolio_url', 'Portfolio URL'], ['booking_url', 'Booking URL']];
function viewOutreach(app) {
  const m = msgBox();
  app.append(el('h1', { text: 'Outreach settings' }), el('p', { class: 'muted small', text: 'Used when apply kits and prospect drafts are built on the next run.' }), m);
  const holder = el('div'); app.append(holder);
  const build = () => {
    clear(holder);
    const o = JSON.parse(JSON.stringify((S.overrides && S.overrides.outreach) || S.data.outreach || {}));
    o.identity = o.identity || {}; delete o.identity.phone;
    o.rates = o.rates || {}; o.tracks = o.tracks || []; o.templates = o.templates || {};
    const id = o.identity;
    const tf = (label, val) => { const i = el('input', { type: 'text', value: val ?? '', autocomplete: 'off' }); return { i, node: el('label', { class: 'field' }, el('span', { text: label }), i) }; };
    const ta = (label, val, rows) => { const t = el('textarea', { rows: rows || 4 }); t.value = val ?? ''; return { t, node: el('label', { class: 'field' }, el('span', { text: label }), t) }; };
    const idf = IDENT_FIELDS.map(([k, lab]) => [k, tf(lab, id[k])]);
    const footer = ta('Cold email footer', id.cold_email_footer, 4);
    // resume rows
    const resBox = el('div'); const resRows = [];
    const addRes = (k, u) => {
      const ki = el('input', { type: 'text', 'aria-label': 'Resume key', placeholder: 'key', value: k }); const ui = el('input', { type: 'text', 'aria-label': 'Resume URL', placeholder: 'https://…', value: u });
      const row = { ki, ui }; 
      row.node = el('div', { class: 'kv-row' }, ki, ui, el('button', { type: 'button', 'aria-label': 'Remove resume link', text: '✕', on: { click: () => { row.node.remove(); resRows.splice(resRows.indexOf(row), 1); } } }));
      resRows.push(row); resBox.append(row.node);
    };
    for (const [k, u] of Object.entries(id.resume || {})) addRes(k, u);
    const rate = tf('Hourly rate (USD)', o.rates.hourly_usd); const rnote = ta('Rate note', o.rates.note, 3);
    // tracks
    const trackUis = o.tracks.map(t => {
      const pitch = ta('Pitch', t.pitch, 4);
      const offers = ta('Offers (one per line)', (t.offers || []).join('\n'), 4);
      const trackSource = tf('Pitch evidence source', t.evidence_source);
      const trackPlatform = tf('Track project platform', t.project_platform);
      const trackConfirmed = el('input', { type: 'checkbox', checked: t.confirmed === true });
      const pBox = el('div'); const rows = [];
      const addProof = (p) => {
        const txt = el('textarea', { rows: 3, 'aria-label': 'Proof point text' }); txt.value = p.text || '';
        const pub = el('input', { type: 'checkbox', checked: !!p.public }); const conf = el('input', { type: 'checkbox', checked: !!p.confirmed });
        const sk = el('input', { type: 'text', 'aria-label': 'Skills (comma separated)', placeholder: 'skills, comma separated', value: (p.skills || []).join(', ') });
        const evidence = tf('Evidence source', p.evidence_source);
        const platform = tf('Project platform', p.project_platform);
        const role = tf('Your responsibility', p.role);
        const client = el('input', { type: 'checkbox', checked: p.client_specific !== false });
        const approved = el('input', { type: 'checkbox', checked: p.publication_approved === true });
        const row = { txt, pub, conf, sk, evidence, platform, role, client, approved, original: p };
        row.node = el('div', { class: 'proof-row' }, txt, el('div', { class: 'checks' }, el('label', { class: 'check' }, pub, el('span', { text: 'Public' })), el('label', { class: 'check' }, conf, el('span', { text: 'Confirmed' }))), sk,
          evidence.node, platform.node, role.node,
          el('div', { class: 'checks' }, el('label', { class: 'check' }, client, el('span', { text: 'Client-specific work' })), el('label', { class: 'check' }, approved, el('span', { text: 'Publication permission confirmed' }))),
          el('button', { type: 'button', text: 'Remove proof point', on: { click: () => { row.node.remove(); rows.splice(rows.indexOf(row), 1); } } }));
        rows.push(row); pBox.append(row.node);
      };
      (t.proof_points || []).forEach(addProof);
      return { t, pitch, offers, rows, trackSource, trackPlatform, trackConfirmed, node: el('details', { class: 'prof' }, el('summary', null, el('strong', { text: t.name || t.key })),
        pitch.node, offers.node, trackSource.node, trackPlatform.node,
        el('label', { class: 'check' }, trackConfirmed, el('span', { text: 'Pitch verified against this source' })), el('h3', { text: 'Proof points' }),
        el('p', { class: 'small muted', text: 'Messages require public, confirmed proof with a source and matching platform. Client-specific work also needs publication permission.' }), pBox,
        el('div', { class: 'btn-row' }, el('button', { type: 'button', text: 'Add proof point', on: { click: () => addProof({ text: '', skills: [], public: false, confirmed: false }) } }))) };
    });
    // templates
    const tplUis = [];
    for (const [name, v] of Object.entries(o.templates)) {
      if (typeof v === 'string') tplUis.push({ path: [name], ui: ta(name.replace(/_/g, ' '), v, 4) });
      else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) if (typeof v2 === 'string') tplUis.push({ path: [name, k2], ui: ta(name.replace(/_/g, ' ') + ' - ' + k2, v2, k2 === 'subject' ? 2 : 8) });
    }
    const collect = () => {
      const out = JSON.parse(JSON.stringify(o));
      for (const [k, f] of idf) out.identity[k] = f.i.value.trim();
      out.identity.cold_email_footer = footer.t.value;
      const res = {}; for (const r of resRows) { const k = r.ki.value.trim(); if (k) res[k] = r.ui.value.trim(); } out.identity.resume = res;
      delete out.identity.phone;
      const hr = rate.i.value.trim(); out.rates = Object.assign({}, o.rates, { hourly_usd: hr !== '' && !isNaN(Number(hr)) ? Number(hr) : '', note: rnote.t.value });
      out.tracks = trackUis.map(u => Object.assign({}, u.t, {
        pitch: u.pitch.t.value, offers: u.offers.t.value.split('\n').map(x => x.trim()).filter(Boolean),
        evidence_source: u.trackSource.i.value.trim(), project_platform: u.trackPlatform.i.value.trim(), confirmed: u.trackConfirmed.checked,
        proof_points: u.rows.filter(r => r.txt.value.trim()).map(r => Object.assign({}, r.original, {
          text: r.txt.value.trim(), skills: csv(r.sk.value), public: r.pub.checked, confirmed: r.conf.checked,
          evidence_source: r.evidence.i.value.trim(), project_platform: r.platform.i.value.trim(), role: r.role.i.value.trim(),
          client_specific: r.client.checked, publication_approved: r.approved.checked })),
      }));
      for (const { path, ui } of tplUis) { if (path.length === 1) out.templates[path[0]] = ui.t.value; else out.templates[path[0]][path[1]] = ui.t.value; }
      return out;
    };
    const doSave = async (run) => {
      if (!getToken()) { m.set('Add a GitHub token in Settings first. Saving outreach settings needs it.', 'err'); return; }
      const val = collect(); m.set('Saving…');
      try {
        await saveOverrides((ov) => { ov.outreach = val; }, 'Update outreach settings');
        m.set('Saved to GitHub. It takes effect on the next run.', 'ok');
        if (run) await runNow(m);
      } catch (e) { m.set(e.message, 'err'); }
    };
    holder.append(
      el('section', { class: 'card' }, el('h2', { text: 'Identity' }), el('div', { class: 'grid-fields' }, idf.map(x => x[1].node)), footer.node,
        el('h3', { text: 'Resume links' }), resBox, el('div', { class: 'btn-row' }, el('button', { type: 'button', text: 'Add resume link', on: { click: () => addRes('', '') } })),
        el('p', { class: 'small muted', text: 'Phone numbers are never stored here.' })),
      el('section', { class: 'card' }, el('h2', { text: 'Rates' }), rate.node, rnote.node),
      el('section', { class: 'card' }, el('h2', { text: 'Tracks' }), el('p', { class: 'small muted', text: 'Only proof points that are public AND confirmed are used in messages.' }), trackUis.map(u => u.node)),
      el('section', { class: 'card' }, el('h2', { text: 'Templates' }), el('p', { class: 'small muted', text: 'Placeholders in {braces} are filled in when messages are built.' }), tplUis.map(x => x.ui.node)),
      el('div', { class: 'btn-row' }, el('button', { class: 'primary', type: 'button', id: 'save-outreach', text: 'Save', on: { click: () => doSave(false) } }), el('button', { type: 'button', id: 'save-rebuild', text: 'Save & rebuild site', on: { click: () => doSave(true) } })));
  };
  build();
  if (getToken() && !S.overrides) ensureOverrides().then(() => { if (S.overrides && location.hash === '#outreach' && !holder.dataset.touched) build(); });
  holder.addEventListener('input', () => { holder.dataset.touched = '1'; }, { once: true });
}

boot();
