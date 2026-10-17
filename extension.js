// Agora pour VS Code et Cursor : chat multi-IA qui peut lire et modifier les fichiers du projet.
const vscode = require('vscode');
const path = require('path');

const PROVIDERS = {
  pollinations: { name: 'Agora Gratuit', key: false, chat: 'https://text.pollinations.ai/openai', models: 'https://text.pollinations.ai/models', def: 'openai' },
  groq:       { name: 'Groq', keyUrl: 'https://console.groq.com/keys', chat: 'https://api.groq.com/openai/v1/chat/completions', models: 'https://api.groq.com/openai/v1/models', def: 'llama-3.3-70b-versatile' },
  gemini:     { name: 'Gemini', keyUrl: 'https://aistudio.google.com/apikey', chat: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', models: 'https://generativelanguage.googleapis.com/v1beta/openai/models', def: 'gemini-2.5-flash' },
  openrouter: { name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', chat: 'https://openrouter.ai/api/v1/chat/completions', models: 'https://openrouter.ai/api/v1/models', def: 'meta-llama/llama-3.3-70b-instruct:free', freeOnly: true },
  mistral:    { name: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys', chat: 'https://api.mistral.ai/v1/chat/completions', models: 'https://api.mistral.ai/v1/models', def: 'codestral-latest' },
  cerebras:   { name: 'Cerebras', keyUrl: 'https://cloud.cerebras.ai', chat: 'https://api.cerebras.ai/v1/chat/completions', models: 'https://api.cerebras.ai/v1/models', def: 'llama-3.3-70b' },
  openai:     { name: 'ChatGPT', keyUrl: 'https://platform.openai.com/api-keys', chat: 'https://api.openai.com/v1/chat/completions', models: 'https://api.openai.com/v1/models', def: 'gpt-4.1-mini' },
  anthropic:  { name: 'Claude', keyUrl: 'https://console.anthropic.com/settings/keys', chat: 'https://api.anthropic.com/v1/messages', models: 'https://api.anthropic.com/v1/models', def: 'claude-sonnet-5-5', kind: 'anthropic' },
  xai:        { name: 'Grok', keyUrl: 'https://console.x.ai', chat: 'https://api.x.ai/v1/chat/completions', models: 'https://api.x.ai/v1/models', def: 'grok-4' },
};

const ACTIONS = {
  explain:  s => `Explique ce code simplement : ce qu'il fait, comment, et les points à surveiller.\n\n${s}`,
  fix:      s => `Trouve le ou les bugs dans ce code. Explique la cause en une phrase, puis corrige le fichier (contenu complet, avec son chemin).\n\n${s}`,
  refactor: s => `Refactorise ce code pour qu'il soit plus lisible et maintenable, sans changer son comportement. Donne le fichier complet avec son chemin, puis les changements en 3 points.\n\n${s}`,
  comment:  s => `Ajoute des commentaires utiles à ce code (en français), sans modifier la logique. Donne le fichier complet commenté avec son chemin.\n\n${s}`,
  tests:    s => `Écris des tests pour ce code, y compris les cas limites, dans un nouveau fichier (indique son chemin). Si la plateforme n'a pas de framework de test, décris des scénarios de test manuels.\n\n${s}`,
};

let ctx, view, history = [], abort = null, lastEditor = null;
const proposals = new Map();   // id -> { files: [{ path, content, old, isNew }] }
const undoStack = [];          // [{ label, items: [{ path, old, isNew }] }]
const cfg = () => vscode.workspace.getConfiguration('agora');
const post = m => view?.webview.postMessage(m);

/* ---------- Clés ---------- */
async function getKey(p) { return PROVIDERS[p].key === false ? '' : (await ctx.secrets.get('agora.key.' + p)) || ''; }
async function linkedList() {
  const out = [];
  for (const [id, p] of Object.entries(PROVIDERS)) out.push({ id, name: p.name, linked: p.key === false || !!(await ctx.secrets.get('agora.key.' + id)) });
  return out;
}

/* ---------- Projet ouvert ---------- */
const root = () => vscode.workspace.workspaceFolders?.[0]?.uri;
function safeRel(p) {
  if (!p) return null;
  let r = p.trim().replace(/^[`'"]+|[`'":]+$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!r || r.startsWith('/') || /^[a-zA-Z]:/.test(r)) return null;
  const n = path.posix.normalize(r);
  if (n.startsWith('..') || n.includes('/../')) return null;
  return n;
}
const uriOf = rel => vscode.Uri.joinPath(root(), ...rel.split('/'));
async function readRel(rel) {
  try {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uriOf(rel).toString());
    if (open) return open.getText();
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uriOf(rel)));
  } catch { return null }
}
async function listFiles() {
  if (!root()) return [];
  const uris = await vscode.workspace.findFiles('**/*', '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/*.{png,jpg,jpeg,gif,webp,ico,ttf,otf,woff,woff2,mp3,ogg,wav,mp4,webm,zip,rar,7z,ytd,yft,ydr,ytyp,ymap,ybn,ycd,dds,rpf,exe,dll,vsix}}', 400);
  return uris.map(u => vscode.workspace.asRelativePath(u, false)).sort();
}
async function writeRel(rel, content) {
  const uri = uriOf(rel), edit = new vscode.WorkspaceEdit();
  const old = await readRel(rel);
  if (old === null) { edit.createFile(uri, { ignoreIfExists: true }); edit.insert(uri, new vscode.Position(0, 0), content) }
  else {
    const doc = await vscode.workspace.openTextDocument(uri);
    edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) throw new Error('modification refusée par l\'éditeur');
  const doc = await vscode.workspace.openTextDocument(uri); await doc.save();
  return old;
}
async function deleteRel(rel) { const e = new vscode.WorkspaceEdit(); e.deleteFile(uriOf(rel), { ignoreIfNotExists: true }); await vscode.workspace.applyEdit(e) }

/* ---------- Lecture des blocs de fichiers dans la réponse ---------- */
function parseFiles(text) {
  const out = [], re = /(?:^|\n)([^\n]*)\n```([\w#+.-]*)[^\n]*\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(text))) {
    let rel = null; const prev = m[1];
    if (prev && prev.length < 160) { const f = prev.match(/([\w@.-]+\/)*[\w@-]+\.[A-Za-z0-9]{1,8}\b/); if (f) rel = safeRel(f[0]) }
    if (!rel) { const f = m[3].match(/^\s*(?:--|\/\/|#|<!--|\/\*)\s*(?:fichier\s*:?\s*|file\s*:?\s*)?(([\w@.-]+\/)*[\w@-]+\.[A-Za-z0-9]{1,8})\b/i); if (f) rel = safeRel(f[1]) }
    if (rel && !/^\d+(\.\d+)+$/.test(rel)) out.push({ path: rel, content: m[3].replace(/\n?$/, '\n') });
  }
  const seen = new Map(); for (const f of out) seen.set(f.path, f); return [...seen.values()];
}
function diffStat(oldT, newT) {
  const a = (oldT || '').split('\n'), b = newT.split('\n'), sa = new Map(), sb = new Map();
  a.forEach(l => sa.set(l, (sa.get(l) || 0) + 1)); b.forEach(l => sb.set(l, (sb.get(l) || 0) + 1));
  let add = 0, del = 0;
  for (const [l, n] of sb) add += Math.max(0, n - (sa.get(l) || 0));
  for (const [l, n] of sa) del += Math.max(0, n - (sb.get(l) || 0));
  return { add, del: oldT === null ? 0 : del };
}

/* ---------- Contexte de l'éditeur ---------- */
function editorContext() {
  const ed = vscode.window.activeTextEditor || lastEditor;
  if (!ed) return null;
  const doc = ed.document, sel = ed.selection;
  const name = vscode.workspace.asRelativePath(doc.uri, false);
  if (!sel.isEmpty) return { name, lang: doc.languageId, text: doc.getText(sel), range: `lignes ${sel.start.line + 1}–${sel.end.line + 1}`, selection: true };
  const text = doc.getText();
  return { name, lang: doc.languageId, text: text.length > 14000 ? text.slice(0, 14000) + '\n… (fichier tronqué)' : text, range: 'fichier entier', selection: false };
}
const ctxBlock = c => c ? `Contexte : \`${c.name}\` (${c.range})\n\`\`\`${c.lang}\n${c.text}\n\`\`\`` : '';

let stateTimer = 0;
function postStateSoon() { clearTimeout(stateTimer); stateTimer = setTimeout(postState, 250) }
async function postState() {
  if (!view) return;
  const c = editorContext();
  post({ type: 'state', provider: cfg().get('provider'), model: cfg().get('model') || PROVIDERS[cfg().get('provider')]?.def, providers: await linkedList(),
    includeFile: cfg().get('includeFile'), autoApply: cfg().get('autoApply'), hasFolder: !!root(), canUndo: undoStack.length > 0,
    context: c ? { name: c.name, range: c.range, selection: c.selection } : null });
}

async function listModels(p) {
  const P = PROVIDERS[p], key = await getKey(p);
  const headers = P.kind === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : key ? { Authorization: 'Bearer ' + key } : {};
  const r = await fetch(P.models, { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  let list = Array.isArray(j) ? j : (j.data || j.models || []);
  if (P.freeOnly) list = list.filter(m => (m.id || '').endsWith(':free'));
  return [...new Set(list.map(m => typeof m === 'string' ? m : (m.id || m.name)).filter(Boolean).map(id => id.replace(/^models\//, '')))]
    .filter(id => !/embed|whisper|tts|moderation|image|audio|realtime|transcribe/i.test(id)).sort();
}

/* ---------- Envoi à l'IA ---------- */
/* ---------- Agent : outils que l'IA peut appeler ---------- */
const TOOLS = [
  { name: 'list_files', description: 'Liste les fichiers du projet ouvert (chemins relatifs). Filtre optionnel sur une partie du chemin.', params: { filter: { type: 'string', description: 'Texte que le chemin doit contenir, ex. "client/" ou ".lua". Facultatif.' } }, req: [] },
  { name: 'search_text', description: 'Cherche un texte dans tous les fichiers du projet. Renvoie les fichiers et lignes trouvés.', params: { query: { type: 'string', description: 'Texte exact à chercher.' } }, req: ['query'] },
  { name: 'read_file', description: 'Lit le contenu complet d\'un fichier du projet.', params: { path: { type: 'string', description: 'Chemin relatif, ex. "client/main.lua".' } }, req: ['path'] },
  { name: 'edit_file', description: 'Modifie un fichier existant en remplaçant un passage exact par un nouveau texte. Lis le fichier avant. old_text doit apparaître une seule fois. Pour ajouter du code, mets dans old_text une ligne existante et dans new_text cette même ligne suivie du nouveau code.', params: { path: { type: 'string' }, old_text: { type: 'string', description: 'Passage exact actuel (copié du fichier).' }, new_text: { type: 'string', description: 'Texte qui remplace ce passage.' } }, req: ['path', 'old_text', 'new_text'] },
  { name: 'write_file', description: 'Crée un nouveau fichier ou remplace entièrement un fichier, avec le contenu complet.', params: { path: { type: 'string' }, content: { type: 'string', description: 'Contenu complet du fichier.' } }, req: ['path', 'content'] },
];
const oaTools = () => TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.params, required: t.req } } }));
const anTools = () => TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: { type: 'object', properties: t.params, required: t.req } }));
const noTools = new Set();          // fournisseurs/modèles qui refusent les outils
let pending = new Map();            // chemin -> { content, old } : modifications en attente (mode Demander)

async function currentText(rel) { return pending.has(rel) ? pending.get(rel).content : await readRel(rel) }
let sessionAuto = false;
const approvals = new Map();
function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  if (A.length * B.length > 250000) return B.slice(0, 40).map(t => ({ t: '+', l: t }));
  const n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { ops.push({ t: ' ', l: A[i] }); i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) ops.push({ t: '-', l: A[i++] }); else ops.push({ t: '+', l: B[j++] }) }
  while (i < n) ops.push({ t: '-', l: A[i++] }); while (j < m) ops.push({ t: '+', l: B[j++] });
  const keep = new Set(); ops.forEach((o, k) => { if (o.t !== ' ') for (let d = -2; d <= 2; d++) keep.add(k + d) });
  const out = []; let last = -2;
  ops.forEach((o, k) => { if (!keep.has(k)) return; if (k > last + 1 && out.length) out.push({ t: '…', l: '' }); out.push(o); last = k });
  return out.slice(0, 160);
}
async function askApproval(rel, old, content) {
  const reqId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  proposals.set(reqId, { files: [{ path: rel, content, old, isNew: old === null }] });
  const st = diffStat(old, content);
  post({ type: 'approve', reqId, path: rel, isNew: old === null, add: st.add, del: st.del, diff: old === null ? content.split('\n').slice(0, 60).map(l => ({ t: '+', l })) : lineDiff(old, content) });
  showDiff(reqId, rel);
  return new Promise(res => {
    approvals.set(reqId, res);
    abort?.signal.addEventListener('abort', () => { if (approvals.has(reqId)) { approvals.delete(reqId); res('no') } });
  });
}
async function closeDiffTabs() {
  try { for (const g of vscode.window.tabGroups.all) for (const t of g.tabs) if (t.input?.modified?.scheme === 'agora-proposed') await vscode.window.tabGroups.close(t) } catch {}
}
async function stage(rel, content) {
  const old = pending.has(rel) ? pending.get(rel).old : await readRel(rel);
  if (!cfg().get('autoApply') && !sessionAuto) {
    const d = await askApproval(rel, old, content);
    closeDiffTabs();
    if (d === 'no') return 'L\'utilisateur a REFUSÉ cette modification. Ne la refais pas telle quelle : demande-lui ce qu\'il préfère ou propose une autre approche.';
    if (d === 'always') sessionAuto = true;
    const prev = await writeRel(rel, content);
    undoStack.push({ label: rel, items: [{ path: rel, old: prev, isNew: prev === null }] });
    postState();
    return 'Modification acceptée par l\'utilisateur et enregistrée sur le disque.';
  }
  if (true) {
    const prev = await writeRel(rel, content);
    undoStack.push({ label: rel, items: [{ path: rel, old: prev, isNew: prev === null }] });
    const st = diffStat(prev, content);
    post({ type: 'info', text: `${prev === null ? 'Créé' : 'Modifié'} : ${rel}  +${st.add} −${st.del}` });
    postState();
    return 'Fichier enregistré sur le disque.';
  }
}
async function runTool(name, a) {
  if (!root()) return 'Erreur : aucun dossier ouvert dans l\'éditeur.';
  try {
    if (name === 'list_files') { const f = (await listFiles()).filter(p => !a.filter || p.includes(a.filter)); post({ type: 'info', text: 'Liste des fichiers' + (a.filter ? ` (${a.filter})` : '') }); return f.slice(0, 400).join('\n') || '(aucun fichier)' }
    if (name === 'search_text') {
      post({ type: 'info', text: `Recherche « ${a.query} »` });
      const out = []; for (const p of (await listFiles()).slice(0, 400)) { const t = await currentText(p); if (!t) continue; t.split('\n').forEach((l, i) => { if (l.includes(a.query) && out.length < 60) out.push(`${p}:${i + 1}: ${l.trim().slice(0, 160)}`) }) }
      return out.join('\n') || 'Aucun résultat.';
    }
    const rel = safeRel(a.path); if (!rel) return 'Erreur : chemin invalide (il doit être relatif au projet, sans ..).';
    if (name === 'read_file') { const t = await currentText(rel); post({ type: 'info', text: 'Lecture : ' + rel }); return t === null ? 'Erreur : fichier introuvable. Utilise list_files pour voir les chemins.' : t.slice(0, 60000) }
    if (name === 'write_file') { if (typeof a.content !== 'string') return 'Erreur : content manquant.'; post({ type: 'info', text: 'Écriture : ' + rel }); return await stage(rel, a.content.endsWith('\n') ? a.content : a.content + '\n') }
    if (name === 'edit_file') {
      const t = await currentText(rel); if (t === null) return 'Erreur : fichier introuvable. Pour créer un fichier, utilise write_file.';
      let old = a.old_text ?? '', nw = a.new_text ?? '';
      let n = old ? t.split(old).length - 1 : 0;
      if (n === 0 && old) { const norm = s => s.replace(/[ \t]+$/gm, '').replace(/\r\n/g, '\n'); const tt = norm(t), oo = norm(old); if (tt.split(oo).length - 1 === 1){ post({ type: 'info', text: 'Modification : ' + rel }); return await stage(rel, tt.replace(oo, () => nw)) } }
      if (n === 0) return 'Erreur : old_text introuvable dans le fichier. Relis le fichier (read_file) et copie le passage exactement.';
      if (n > 1) return `Erreur : old_text apparaît ${n} fois. Ajoute des lignes autour pour qu'il soit unique.`;
      post({ type: 'info', text: 'Modification : ' + rel });
      return await stage(rel, t.replace(old, () => nw));
    }
    return 'Outil inconnu.';
  } catch (e) { return 'Erreur : ' + e.message }
}

async function systemPrompt(withTools) {
  let s = (cfg().get('instructions') || '') + '\nTu es Agora, un agent de code intégré à l\'éditeur VS Code / Cursor.';
  if (root()) {
    const files = await listFiles();
    s += `\n\nPROJET OUVERT : ${vscode.workspace.workspaceFolders[0].name} (${files.length} fichiers). Aperçu :\n${files.slice(0, 150).join('\n')}${files.length > 150 ? '\n…' : ''}`;
    s += withTools
      ? '\n\nTU AGIS DIRECTEMENT SUR LES FICHIERS grâce à tes outils. Règles :\n- Quand on te demande d\'ajouter, corriger ou changer du code, fais-le toi-même avec edit_file ou write_file. Ne dis JAMAIS à l\'utilisateur de modifier un fichier lui-même et ne donne pas d\'extraits à copier-coller.\n- Si tu ne sais pas où se trouve le code, utilise search_text ou list_files, puis read_file avant de modifier.\n- Préfère edit_file (petites modifications ciblées) ; write_file pour créer un fichier ou tout réécrire.\n- À la fin, résume en 2 ou 3 phrases ce que tu as changé et dans quels fichiers.'
      : '\n\nTU PEUX LIRE ET MODIFIER CES FICHIERS :\n- Pour LIRE un fichier, écris sur une ligne seule [[LIRE: chemin/relatif]] puis arrête ta réponse.\n- Pour CRÉER ou MODIFIER un fichier, écris son chemin relatif exact seul sur la ligne juste avant le bloc de code, puis le contenu COMPLET du fichier.\n- Ne dis jamais à l\'utilisateur de modifier lui-même : fais-le.';
  } else s += '\nAucun dossier n\'est ouvert : donne le code dans des blocs, l\'utilisateur l\'insérera lui-même. Conseille d\'ouvrir le dossier du projet pour qu\'Agora puisse modifier les fichiers directement.';
  return s;
}

function httpError(P, status, body) {
  let m = `${P.name} : erreur ${status}`; try { const j = JSON.parse(body); m += ' — ' + (j.error?.message || j.message || '') } catch { if (body) m += ' — ' + body.slice(0, 200) }
  if (status === 401 || status === 403) m += '. Vérifie ta clé (commande « Agora : Lier une IA »).';
  if (status === 429) m += '. Limite gratuite atteinte, change d\'IA ou attends un peu.';
  return Object.assign(new Error(m), { status, body });
}
const toolsUnsupported = e => e.status === 400 || e.status === 404 || e.status === 422 ? /tool|function/i.test(e.body || e.message) : false;

// Un appel au modèle (streamé). Renvoie { text, calls:[{id,name,args}] }.
async function callModel(P, pid, model, key, sys, msgs, withTools) {
  let r;
  if (P.kind === 'anthropic') {
    const body = { model, max_tokens: 16000, stream: true, system: sys, messages: msgs };
    if (withTools) body.tools = anTools();
    r = await fetch(P.chat, { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
  } else {
    const headers = { 'Content-Type': 'application/json' }; if (key) headers.Authorization = 'Bearer ' + key;
    if (pid === 'openrouter') { headers['X-Title'] = 'Agora VS Code'; headers['HTTP-Referer'] = 'https://rvm-lua.github.io/Agora/' }
    const body = { model, stream: true, messages: [{ role: 'system', content: sys }, ...msgs] };
    if (withTools) { body.tools = oaTools(); body.tool_choice = 'auto' }
    r = await fetch(P.chat, { method: 'POST', signal: abort.signal, headers, body: JSON.stringify(body) });
  }
  if (!r.ok) throw httpError(P, r.status, await r.text().catch(() => ''));
  let text = ''; const calls = [];
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('event-stream')) {
    const j = await r.json().catch(() => ({}));
    if (P.kind === 'anthropic') for (const b of j.content || []) { if (b.type === 'text') text += b.text; if (b.type === 'tool_use') calls.push({ id: b.id, name: b.name, args: b.input || {} }) }
    else { const m = j.choices?.[0]?.message || {}; text = m.content || ''; for (const c of m.tool_calls || []) calls.push({ id: c.id, name: c.function?.name, args: safeJson(c.function?.arguments) }) }
    if (text) post({ type: 'delta', text });
    return { text, calls };
  }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  const oa = []; const an = {};
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim(); if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim(); if (!data || data === '[DONE]') continue;
      let j; try { j = JSON.parse(data) } catch { continue }
      if (P.kind === 'anthropic') {
        if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') an[j.index] = { id: j.content_block.id, name: j.content_block.name, json: '' };
        if (j.type === 'content_block_delta') {
          if (j.delta?.type === 'text_delta') { text += j.delta.text; post({ type: 'delta', text: j.delta.text }) }
          if (j.delta?.type === 'input_json_delta' && an[j.index]) an[j.index].json += j.delta.partial_json;
        }
      } else {
        const d = j.choices?.[0]?.delta || {};
        if (d.content) { text += d.content; post({ type: 'delta', text: d.content }) }
        for (const tc of d.tool_calls || []) {
          const i = tc.index ?? oa.length; oa[i] ||= { id: '', name: '', args: '' };
          if (tc.id) oa[i].id = tc.id; if (tc.function?.name) oa[i].name += tc.function.name; if (tc.function?.arguments) oa[i].args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        }
      }
    }
  }
  for (const c of oa.filter(Boolean)) calls.push({ id: c.id || 'call_' + Math.random().toString(36).slice(2, 10), name: c.name, args: safeJson(c.args) });
  for (const c of Object.values(an)) calls.push({ id: c.id, name: c.name, args: safeJson(c.json) });
  return { text, calls };
}
function safeJson(s) { if (!s) return {}; if (typeof s === 'object') return s; try { return JSON.parse(s) } catch { return {} } }

async function send(userText, opts = {}) {
  if (!view) return;
  const depth = opts.depth || 0;
  const pid = cfg().get('provider'), P = PROVIDERS[pid];
  const model = cfg().get('model') || P.def;
  const key = await getKey(pid);
  if (P.key !== false && !key) { post({ type: 'error', msg: `${P.name} n'est pas lié. Clique sur « Lier » ou choisis Agora Gratuit.` }); return }
  history.push({ role: 'user', content: userText });
  let withTools = !!root() && !noTools.has(pid + '/' + model);
  post({ type: 'start', model: `${P.name} · ${model}` });
  abort = new AbortController();
  if (!opts.keepPending) pending = new Map();
  let finalText = '', nudged = false, usedTools = false;
  try {
    let sys = await systemPrompt(withTools);
    const baseMsgs = () => P.kind === 'anthropic' ? mergeRoles(history.slice(-24)) : history.slice(-24).map(m => ({ ...m }));
    let msgs = baseMsgs();
    for (let step = 0; step < 14; step++) {
      let res;
      try { res = await callModel(P, pid, model, key, sys, msgs, withTools) }
      catch (e) {
        if (withTools && toolsUnsupported(e)) { noTools.add(pid + '/' + model); withTools = false; sys = await systemPrompt(false); post({ type: 'info', text: 'Ce modèle ne gère pas les outils : mode simplifié.' }); step--; continue }
        throw e;
      }
      if (res.text) finalText += (finalText ? '\n\n' : '') + res.text;
      if (!res.calls.length && !res.text) {
        if (step === 0 && withTools) { noTools.add(pid + '/' + model); withTools = false; sys = await systemPrompt(false); post({ type: 'info', text: 'Ce modèle ne gère pas bien les outils : mode simplifié.' }); step--; continue }
        if (!nudged) { nudged = true; msgs.push({ role: 'user', content: 'Continue la tâche : fais les modifications nécessaires avec tes outils (edit_file / write_file), puis résume en 2 phrases ce que tu as fait.' }); continue }
        if (usedTools && withTools) {
          noTools.add(pid + '/' + model); withTools = false; sys = await systemPrompt(false); msgs = baseMsgs(); finalText = ''; nudged = false;
          post({ type: 'info', text: 'Ce modèle s\'arrête après les outils : je relance en mode simplifié. Groq ou Gemini (gratuits) font mieux ce travail.' });
          step = -1; continue;
        }
        break;
      }
      if (!res.calls.length) break;
      usedTools = true;
      if (P.kind === 'anthropic') {
        msgs.push({ role: 'assistant', content: [...(res.text ? [{ type: 'text', text: res.text }] : []), ...res.calls.map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))] });
        const results = []; for (const c of res.calls) results.push({ type: 'tool_result', tool_use_id: c.id, content: await runTool(c.name, c.args) });
        msgs.push({ role: 'user', content: results });
      } else {
        msgs.push({ role: 'assistant', content: res.text || '', tool_calls: res.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
        for (const c of res.calls) msgs.push({ role: 'tool', tool_call_id: c.id, content: await runTool(c.name, c.args) });
      }
      if (abort.signal.aborted) break;
      post({ type: 'delta', text: '' });
    }
    const changed = [...pending.keys()];
    history.push({ role: 'assistant', content: (finalText || '(modifications effectuées)') + (changed.length ? `\n\n[Fichiers modifiés : ${changed.join(', ')}]` : '') });
    post({ type: 'done' });
  } catch (e) {
    abort = null;
    if (e.name === 'AbortError') { history.push({ role: 'assistant', content: finalText || '(arrêté)' }); post({ type: 'done', stopped: true }) }
    else { history.pop(); post({ type: 'error', msg: e.message || String(e) }) }
    return;
  }
  abort = null;
  if (pending.size) return proposePending();
  if (!withTools) await afterResponse(finalText, depth);
}
async function proposePending() {
  const files = [];
  for (const [rel, v] of pending) { if (v.old === v.content) continue; files.push({ path: rel, content: v.content, old: v.old, isNew: v.old === null, ...diffStat(v.old, v.content) }) }
  pending = new Map();
  if (!files.length) return;
  const id = 'p' + Date.now().toString(36);
  proposals.set(id, { files });
  post({ type: 'proposal', id, files: files.map(f => ({ path: f.path, isNew: f.isNew, add: f.add, del: f.del })) });
}

function mergeRoles(msgs) {
  const out = []; for (const m of msgs) { const l = out.at(-1); if (l && l.role === m.role) l.content += '\n\n' + m.content; else out.push({ ...m }) }
  while (out[0]?.role === 'assistant') out.shift(); return out;
}

/* ---------- Après chaque réponse : lectures puis modifications ---------- */
async function afterResponse(content, depth) {
  if (!root()) return;
  const reads = [...new Set([...content.matchAll(/\[\[LIRE:\s*([^\]\n]+?)\s*\]\]/g)].map(m => safeRel(m[1])).filter(Boolean))].slice(0, 10);
  if (reads.length && depth < 5) {
    const parts = [];
    for (const r of reads) { const t = await readRel(r); parts.push(t === null ? `### ${r}\n(fichier introuvable)` : `### ${r}\n\`\`\`\n${t.slice(0, 40000)}\n\`\`\``) }
    post({ type: 'info', text: 'Fichiers lus : ' + reads.join(', ') });
    return send(`Voici le contenu des fichiers demandés :\n\n${parts.join('\n\n')}\n\nContinue la tâche.`, { depth: depth + 1 });
  }
  const files = parseFiles(content);
  if (!files.length) return;
  for (const f of files) { f.old = await readRel(f.path); f.isNew = f.old === null; Object.assign(f, diffStat(f.old, f.content)) }
  const changed = files.filter(f => f.old !== f.content);
  if (!changed.length) return;
  const id = 'p' + Date.now().toString(36);
  proposals.set(id, { files: changed });
  if (cfg().get('autoApply')) return applyProposal(id, changed.map(f => f.path));
  post({ type: 'proposal', id, files: changed.map(f => ({ path: f.path, isNew: f.isNew, add: f.add, del: f.del })) });
}

async function applyProposal(id, paths) {
  const p = proposals.get(id); if (!p) return;
  const items = [], done = [], errors = [];
  for (const f of p.files.filter(f => paths.includes(f.path) && !f.applied)) {
    try { const old = await writeRel(f.path, f.content); items.push({ path: f.path, old, isNew: old === null }); f.applied = true; done.push(f.path) }
    catch (e) { errors.push(`${f.path} : ${e.message}`) }
  }
  if (items.length) undoStack.push({ label: done.join(', '), items });
  post({ type: 'applied', id, paths: done, errors });
  if (done.length) {
    const first = await vscode.workspace.openTextDocument(uriOf(done[0]));
    vscode.window.showTextDocument(first, { preview: false, preserveFocus: true });
  }
  postState();
}
async function undoLast() {
  const u = undoStack.pop(); if (!u) return vscode.window.showInformationMessage('Rien à annuler.');
  for (const it of u.items.reverse()) { if (it.isNew) await deleteRel(it.path); else await writeRel(it.path, it.old) }
  post({ type: 'info', text: 'Modifications annulées : ' + u.label });
  postState();
}
async function showDiff(id, rel) {
  const p = proposals.get(id); const f = p?.files.find(x => x.path === rel); if (!f) return;
  const right = vscode.Uri.parse(`agora-proposed:/${encodeURIComponent(id)}/${rel}`);
  const left = f.isNew ? vscode.Uri.parse(`agora-proposed:/empty/${rel}`) : uriOf(rel);
  vscode.commands.executeCommand('vscode.diff', left, right, `${rel} · proposition d'Agora`, { preview: true });
}

/* ---------- Insertion manuelle ---------- */
async function insertCode(code, mode, lang) {
  if (mode === 'newfile') {
    const doc = await vscode.workspace.openTextDocument({ content: code, language: lang || undefined });
    return vscode.window.showTextDocument(doc, { preview: false });
  }
  const ed = (lastEditor && !lastEditor.document.isClosed) ? lastEditor : vscode.window.visibleTextEditors[0];
  if (!ed) return vscode.window.showWarningMessage('Ouvre un fichier pour y insérer le code.');
  const shown = await vscode.window.showTextDocument(ed.document, ed.viewColumn);
  const sel = shown.selection;
  const ok = await shown.edit(b => { if (mode === 'replace' && !sel.isEmpty) b.replace(sel, code); else b.insert(sel.active, code) });
  if (!ok) vscode.window.showWarningMessage('L\'éditeur a refusé la modification (fichier en lecture seule ?).');
}

async function linkKey(preset) {
  const items = Object.entries(PROVIDERS).filter(([, p]) => p.key !== false).map(([id, p]) => ({ label: p.name, description: ['anthropic', 'openai', 'xai'].includes(id) ? 'payant' : 'gratuit', id }));
  const pick = preset && PROVIDERS[preset]?.key !== false ? items.find(i => i.id === preset) : await vscode.window.showQuickPick(items, { placeHolder: 'Quelle IA veux-tu lier ?' });
  if (!pick) return;
  const P = PROVIDERS[pick.id];
  const open = 'Créer une clé';
  const choice = await vscode.window.showInformationMessage(`Il faut une clé ${P.name}. Crée-la sur leur site, puis colle-la ici.`, open, 'J\'ai déjà ma clé');
  if (choice === open) vscode.env.openExternal(vscode.Uri.parse(P.keyUrl));
  if (!choice) return;
  const key = await vscode.window.showInputBox({ prompt: `Colle ta clé ${P.name}`, password: true, ignoreFocusOut: true });
  if (!key) return;
  await ctx.secrets.store('agora.key.' + pick.id, key.trim());
  await cfg().update('provider', pick.id, vscode.ConfigurationTarget.Global);
  await cfg().update('model', '', vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`${P.name} est lié à Agora.`);
  postState();
}

async function runAction(kind, question) {
  const c = editorContext();
  if (!c || !c.selection) return vscode.window.showWarningMessage('Sélectionne d\'abord du code.');
  await vscode.commands.executeCommand('agora.chat.focus');
  const block = ctxBlock(c);
  const text = kind === 'ask' ? `${question}\n\n${block}` : ACTIONS[kind](block);
  const label = kind === 'ask' ? question : { explain: 'Expliquer', fix: 'Corriger', refactor: 'Refactoriser', comment: 'Commenter', tests: 'Tests' }[kind] + ` · ${c.name} (${c.range})`;
  setTimeout(() => { post({ type: 'userEcho', text: label }); send(text) }, view ? 0 : 600);
}

class ChatView {
  resolveWebviewView(v) {
    view = v;
    v.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media')] };
    const nonce = Math.random().toString(36).slice(2);
    const icon = v.webview.asWebviewUri(vscode.Uri.joinPath(ctx.extensionUri, 'media', 'icon.png'));
    v.webview.html = require('fs').readFileSync(vscode.Uri.joinPath(ctx.extensionUri, 'media', 'chat.html').fsPath, 'utf8')
      .replace(/%NONCE%/g, nonce).replace(/%CSP%/g, v.webview.cspSource).replace(/%ICON%/g, String(icon));
    v.webview.onDidReceiveMessage(async m => {
      if (m.type === 'ready') postState();
      if (m.type === 'send') { const c = cfg().get('includeFile') ? editorContext() : null; send(c ? `${m.text}\n\n${ctxBlock(c)}` : m.text) }
      if (m.type === 'stop') abort?.abort();
      if (m.type === 'setProvider') { await cfg().update('provider', m.provider, vscode.ConfigurationTarget.Global); await cfg().update('model', '', vscode.ConfigurationTarget.Global); postState() }
      if (m.type === 'setModel') { await cfg().update('model', m.model, vscode.ConfigurationTarget.Global); postState() }
      if (m.type === 'setAuto') { await cfg().update('autoApply', !!m.value, vscode.ConfigurationTarget.Global); postState() }
      if (m.type === 'toggleFile') { await cfg().update('includeFile', !cfg().get('includeFile'), vscode.ConfigurationTarget.Global); postState() }
      if (m.type === 'listModels') { try { post({ type: 'models', list: await listModels(cfg().get('provider')) }) } catch (e) { post({ type: 'models', list: [], error: e.message }) } }
      if (m.type === 'insert') insertCode(m.code, m.mode, m.lang);
      if (m.type === 'apply') applyProposal(m.id, m.paths);
      if (m.type === 'approval') { const r = approvals.get(m.reqId); if (r) { approvals.delete(m.reqId); r(m.decision) } }
      if (m.type === 'showDiff') showDiff(m.reqId, m.path);
      if (m.type === 'diff') showDiff(m.id, m.path);
      if (m.type === 'discard') { proposals.delete(m.id) }
      if (m.type === 'undo') undoLast();
      if (m.type === 'link') linkKey(m.provider);
      if (m.type === 'openFolder') vscode.commands.executeCommand('vscode.openFolder');
      if (m.type === 'newChat') { history = []; sessionAuto = false }
      if (m.type === 'openWeb') vscode.env.openExternal(vscode.Uri.parse('https://rvm-lua.github.io/Agora/'));
    });
  }
}

function activate(context) {
  ctx = context;
  lastEditor = vscode.window.activeTextEditor || null;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('agora-proposed', {
      provideTextDocumentContent(uri) {
        const [, id, ...rest] = uri.path.split('/'); if (id === 'empty') return '';
        const f = proposals.get(decodeURIComponent(id))?.files.find(x => x.path === rest.join('/')); return f ? f.content : '';
      }
    }),
    vscode.window.registerWebviewViewProvider('agora.chat', new ChatView(), { webviewOptions: { retainContextWhenHidden: true } }),
    ...Object.keys(ACTIONS).map(k => vscode.commands.registerCommand('agora.' + k, () => runAction(k))),
    vscode.commands.registerCommand('agora.ask', async () => { const q = await vscode.window.showInputBox({ prompt: 'Ta question sur le code sélectionné' }); if (q) runAction('ask', q) }),
    vscode.commands.registerCommand('agora.linkKey', () => linkKey()),
    vscode.commands.registerCommand('agora.unlinkKey', async () => {
      const pick = await vscode.window.showQuickPick(Object.entries(PROVIDERS).filter(([, p]) => p.key !== false).map(([id, p]) => ({ label: p.name, id })), { placeHolder: 'Quelle IA délier ?' });
      if (pick) { await ctx.secrets.delete('agora.key.' + pick.id); vscode.window.showInformationMessage(`${pick.label} délié.`); postState() }
    }),
    vscode.commands.registerCommand('agora.undo', () => undoLast()),
    vscode.commands.registerCommand('agora.newChat', () => { history = []; sessionAuto = false; post({ type: 'clear' }) }),
    vscode.commands.registerCommand('agora.openWeb', () => vscode.env.openExternal(vscode.Uri.parse('https://rvm-lua.github.io/Agora/'))),
    vscode.window.onDidChangeActiveTextEditor(e => { if (e) lastEditor = e; postStateSoon() }),
    vscode.window.onDidChangeTextEditorSelection(e => { lastEditor = e.textEditor; postStateSoon() }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => postStateSoon()),
  );
}
function deactivate() { abort?.abort() }
module.exports = { activate, deactivate };
