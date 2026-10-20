import { registerSW } from 'virtual:pwa-register';
import { ADS, safeAds } from './ads';
import type { ReviewFlag } from './anonymizer';
import { MAX_TEXT_CHARS, readFileText } from './files';
import {
  checkTerm,
  emptyRoster,
  ENTRY_KIND_LABEL,
  KIND_LABEL,
  maskText,
  normalizeTerm,
  registeredSurfaces,
  restoreText,
  sanitizeRoster,
  splitTokens,
  termNotice,
  tokenKind,
  unknownTokens,
  type Entry,
  type EntryKind,
  type Roster,
} from './mask';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- 画面の切り替え ----------
const tabs = document.querySelectorAll<HTMLButtonElement>('[data-tab]');
function showTab(name: string) {
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  for (const id of ['roster', 'mask', 'restore']) $(`tab-${id}`).hidden = id !== name;
  if (name === 'restore') updateRestoreLead();
}
tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab!)));

// ---------- ネットなしで使える準備 ----------
let offlineReady = false;
function updateOfflineStatus() {
  const el = $('offline-status');
  if (!navigator.onLine) el.textContent = '📴 ネットなしで動いています';
  else if (offlineReady) el.textContent = '✅ ネットを切っても使えます';
  else el.textContent = '⏳ ネットなしで使う準備中';
  el.classList.toggle('ok', offlineReady || !navigator.onLine);
}
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      offlineReady = true;
      updateOfflineStatus();
    },
    onRegisteredSW(_url, reg) {
      if (reg?.active) {
        offlineReady = true;
        updateOfflineStatus();
      }
    },
  });
  // 準備の途中で読み込み直したときなど、上の知らせが来ないことがあるので、準備ができたら必ず表示を変える
  void navigator.serviceWorker.ready.then(() => {
    offlineReady = true;
    updateOfflineStatus();
  });
} else {
  $('offline-status').textContent = '（開発中の表示）';
}
window.addEventListener('online', updateOfflineStatus);
window.addEventListener('offline', updateOfflineStatus);
if (import.meta.env.PROD) updateOfflineStatus();

// ---------- かくす言葉の登録 ----------
const STORE_KEY = 'fuseji.roster.v2';
const REMEMBER_KEY = 'fuseji.remember';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 保存できない環境（プライベートウィンドウ等）では覚えない */
  }
}

let remember = storageGet(REMEMBER_KEY) === '1';
let roster: Roster = emptyRoster();
if (remember) {
  try {
    // 保存してあったものも、もう一度チェックを通す
    roster = sanitizeRoster(JSON.parse(storageGet(STORE_KEY) ?? 'null')).roster;
  } catch {
    roster = emptyRoster();
  }
}
// 前の版（子ども用の登録）の保存は使わないので消す
storageSet('fuseji.roster.v1', null);

function saveRoster() {
  storageSet(STORE_KEY, remember ? JSON.stringify(roster) : null);
}

const form = $<HTMLFormElement>('add-form');
const selectedKind = () => (form.querySelector<HTMLInputElement>('input[name="kind"]:checked')?.value ?? 'person') as EntryKind;

function setAddMessage(errors: string[] | null, ok?: string) {
  const err = $('add-error');
  err.hidden = !errors?.length;
  err.replaceChildren();
  if (errors?.length) {
    const ul = document.createElement('ul');
    for (const e of errors) {
      const li = document.createElement('li');
      li.textContent = e;
      ul.append(li);
    }
    err.append('登録できません。直してからもう一度押してください：', ul);
  }
  $('add-ok').hidden = !ok;
  $('add-ok').textContent = ok ?? '';
}

function updateKindFields() {
  const person = selectedKind() === 'person';
  $('person-fields').hidden = !person;
  $('term-fields').hidden = person;
  setAddMessage(null);
}
form.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener('change', updateKindFields));

/** 入力をチェックし、1つでもだめなものがあれば何も登録しない */
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const kind = selectedKind();
  const seen = registeredSurfaces(roster);
  const errors: string[] = [];
  const add: Entry[] = [];
  const take = (raw: string, label: string) => {
    const reason = checkTerm(raw, kind, seen);
    if (reason) {
      errors.push(`${label}「${raw.trim() || '（空）'}」：${reason}`);
      return null;
    }
    const t = normalizeTerm(raw);
    seen.add(t.replace(/ /g, ''));
    return t;
  };
  if (kind === 'person') {
    const name = take($<HTMLInputElement>('person-name').value, '名前');
    const aliases = $<HTMLInputElement>('person-aliases')
      .value.split(/[、,，\n]/)
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => take(a, '呼び方'))
      .filter((a): a is string => !!a);
    if (name && !errors.length) add.push({ id: crypto.randomUUID(), kind, name, aliases });
  } else {
    const terms = $<HTMLTextAreaElement>('terms').value.split(/[\n、,，]+/).map((t) => t.trim()).filter(Boolean);
    if (terms.length === 0) errors.push('言葉を入れてください');
    for (const raw of terms) {
      const t = take(raw, '言葉');
      if (t) add.push({ id: crypto.randomUUID(), kind, term: t });
    }
  }
  if (errors.length) {
    setAddMessage(errors);
    return;
  }
  roster.entries.push(...add);
  saveRoster();
  renderEntries();
  form.reset();
  form.querySelector<HTMLInputElement>(`input[name="kind"][value="${kind}"]`)!.checked = true;
  updateKindFields();
  const notices = add.flatMap((x) => (x.kind === 'person' ? [x.name, ...x.aliases] : [x.term])).map(termNotice).filter(Boolean);
  setAddMessage(null, [`${add.length} 件登録しました`, ...notices].join('\n'));
});

const entryText = (e: Entry) => (e.kind === 'person' ? e.name : e.term);

function renderEntries() {
  const list = $('entries');
  list.replaceChildren();
  $('entry-count').textContent = `${roster.entries.length} 件`;
  if (roster.entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = 'まだ登録はありません。';
    list.append(li);
    return;
  }
  const order: EntryKind[] = ['person', 'org', 'place', 'word'];
  const sorted = [...roster.entries].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || entryText(a).localeCompare(entryText(b), 'ja'));
  for (const entry of sorted) {
    const li = document.createElement('li');
    const badge = document.createElement('span');
    badge.className = `tag t-${entry.kind}`;
    badge.textContent = ENTRY_KIND_LABEL[entry.kind];
    const text = document.createElement('span');
    text.className = 'entry-text';
    text.textContent = entryText(entry);
    if (entry.kind === 'person' && entry.aliases.length) {
      const small = document.createElement('small');
      small.textContent = `（${entry.aliases.join('、')}）`;
      text.append(small);
    }
    // 消すときは2回押す（押しまちがい防止）
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger small';
    del.textContent = '消す';
    del.addEventListener('click', () => {
      if (del.dataset.armed !== '1') {
        del.dataset.armed = '1';
        del.textContent = 'もう一度押すと消えます';
        setTimeout(() => {
          del.dataset.armed = '';
          del.textContent = '消す';
        }, 3000);
        return;
      }
      roster.entries = roster.entries.filter((x) => x !== entry);
      saveRoster();
      renderEntries();
    });
    li.append(badge, text, del);
    list.append(li);
  }
}

function renderRoster() {
  renderEntries();
  updateKindFields();
  $<HTMLInputElement>('remember').checked = remember;
  $('remember-note').textContent = remember
    ? 'この端末のブラウザに保存しています。共用のパソコンでは外してください。'
    : '保存していません。ページを閉じると登録は消えます。「書き出す」でファイルに残せます。';
}

$('remember').addEventListener('change', (e) => {
  remember = (e.target as HTMLInputElement).checked;
  storageSet(REMEMBER_KEY, remember ? '1' : null);
  saveRoster();
  renderRoster();
});
$('clear-roster').addEventListener('click', () => {
  if (!confirm('登録した言葉を全部消します。よろしいですか？')) return;
  roster = emptyRoster();
  saveRoster();
  renderRoster();
});
$('export').addEventListener('click', () => {
  const data = { app: 'fuseji', version: 2, entries: roster.entries.map(({ id: _id, ...rest }) => rest) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ふせじ_登録.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('import').addEventListener('click', () => $('import-file').click());
$<HTMLInputElement>('import-file').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('too large');
    // 読み込んだものも、登録と同じチェックを通す
    const { roster: loaded, rejected } = sanitizeRoster(JSON.parse(await file.text()));
    if (loaded.entries.length === 0) throw new Error('empty');
    roster = loaded;
    saveRoster();
    renderRoster();
    setAddMessage(null, `${loaded.entries.length} 件読み込みました${rejected ? `（登録できないもの ${rejected} 件はとばしました）` : ''}`);
  } catch {
    alert('このファイルは読み込めませんでした。「書き出す」で作ったファイルを選んでください。');
  }
});

renderRoster();

// ---------- 広告（PR） ----------
// ただのリンクだけを出す。広告会社のスクリプトは読み込まない（src/ads.ts の決まりを参照）
{
  const ads = safeAds(ADS);
  const list = $('pr-list');
  for (const ad of ads) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = ad.url;
    a.target = '_blank';
    a.rel = 'sponsored noopener noreferrer';
    if (ad.image) {
      const img = document.createElement('img');
      img.src = ad.image;
      img.alt = '';
      img.loading = 'lazy';
      a.append(img);
    }
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = ad.title;
    text.append(title);
    if (ad.note) {
      const note = document.createElement('small');
      note.textContent = ad.note;
      text.append(note);
    }
    a.append(text);
    li.append(a);
    list.append(li);
  }
  $('pr').hidden = ads.length === 0;
}

// ---------- 使い方・見本 ----------
const GUIDE_KEY = 'fuseji.guideClosed';
const guide = $<HTMLDetailsElement>('guide');
if (storageGet(GUIDE_KEY) === '1') guide.open = false;
guide.addEventListener('toggle', () => storageSet(GUIDE_KEY, guide.open ? null : '1'));

/** 架空の見本（どんな人にも分かる、ふつうのメール） */
const SAMPLE = [
  '件名：来週の打ち合わせについて',
  '',
  '株式会社みどり　鈴木さま',
  '',
  'いつもお世話になっております。山田太郎です。',
  '来週の打ち合わせは、横浜市港北区の弊社（〒222-0033）でお願いできますでしょうか。',
  '当日は、さくら病院の高橋先生もご一緒します。',
  '連絡先は 090-1234-5678、taro.yamada@example.com です。',
  '',
  '差出人：山田 太郎（昭和60年5月12日生まれ）',
].join('\n');

$('try-sample').addEventListener('click', () => {
  inputEl.value = SAMPLE;
  updateCount();
  $('do-mask').click();
});

/** AI に渡す文章の頭につける一文。印を書き換えられると元に戻せないため */
const AI_NOTE =
  '（お願い：この文章の中の [[ ]] で囲まれた印は、個人情報をかくしたものです。返事の中でも、印は書き換えずにそのまま使ってください。）';

// ---------- かくす ----------
/** 対応表は画面のメモリだけに持つ（保存しない） */
let tokenMap: Map<string, string> | null = null;

const inputEl = $<HTMLTextAreaElement>('input');
const updateCount = () => ($('input-count').textContent = inputEl.value ? `${inputEl.value.length.toLocaleString()} 文字` : '');
inputEl.addEventListener('input', updateCount);

function showError(msg: string | null) {
  const el = $('mask-error');
  el.hidden = !msg;
  el.textContent = msg ?? '';
}

async function loadFile(file: File) {
  showError(null);
  const drop = $('drop');
  drop.classList.add('busy');
  try {
    inputEl.value = await readFileText(file);
    updateCount();
    $('mask-result').hidden = true;
  } catch (err) {
    showError(err instanceof Error ? err.message : 'ファイルを読めませんでした');
  } finally {
    drop.classList.remove('busy');
  }
}

$('pick').addEventListener('click', () => $('file').click());
$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void loadFile(file);
});
const drop = $('drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) void loadFile(file);
});
// 画面のほかの場所に落としたとき、ブラウザがファイルを開いてしまわないようにする
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

const FLAG_TEXT: Record<ReviewFlag['reason'], string> = {
  ambiguous_surname: '同じ名字の人が複数登録されているため、どの人か決められませんでした',
  ambiguous_surface: '同じ呼び方の人が複数いるため、どの人か決められませんでした',
  possible_compound_word: '名前が別の言葉の一部かもしれません（念のためかくしました）',
};

function chip(token: string, original: string | undefined): HTMLElement {
  const kind = tokenKind(token);
  const el = document.createElement('mark');
  el.className = `chip k-${kind ?? 'other'}`;
  el.textContent = kind ? KIND_LABEL[kind] : token;
  el.title = original ? `元の言葉：${original}` : '元に戻らない印（番号・住所など）';
  return el;
}

$('do-mask').addEventListener('click', () => {
  showError(null);
  const text = inputEl.value;
  if (text.length > MAX_TEXT_CHARS) {
    showError(`文章が長すぎます（${MAX_TEXT_CHARS.toLocaleString()} 文字まで）。分けてかくしてください`);
    return;
  }
  if (!text.trim()) {
    showError('かくす文章を入れてください');
    return;
  }
  const res = maskText(text, roster, { guessNames: $<HTMLInputElement>('guess').checked });
  tokenMap = res.tokenMap;

  // 数のまとめ
  const counts = new Map<string, number>();
  for (const p of splitTokens(res.anonymizedText)) {
    if (!p.token) continue;
    const kind = tokenKind(p.text);
    const label = kind ? KIND_LABEL[kind] : 'その他';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const summary = $('summary');
  summary.replaceChildren();
  if (counts.size === 0) {
    summary.textContent = 'かくすものは見つかりませんでした。名前が残っていないか読んで確かめてください。';
  } else {
    const strong = document.createElement('strong');
    strong.textContent = `${[...counts.values()].reduce((a, b) => a + b, 0)} か所をかくしました：`;
    summary.append(strong, ` ${[...counts].map(([k, v]) => `${k} ${v}`).join('・')}`);
  }

  // 要確認
  const flags = $('flags');
  flags.replaceChildren();
  flags.hidden = res.flags.length === 0;
  if (res.flags.length) {
    const h = document.createElement('strong');
    h.textContent = '確認してください';
    const ul = document.createElement('ul');
    for (const f of res.flags) {
      const li = document.createElement('li');
      li.textContent = `「${f.text}」— ${FLAG_TEXT[f.reason]}`;
      ul.append(li);
    }
    flags.append(h, ul);
  }

  // 確かめる用の表示
  const preview = $('preview');
  preview.replaceChildren();
  for (const p of splitTokens(res.anonymizedText)) {
    preview.append(p.token ? chip(p.text, tokenMap.get(p.text)) : document.createTextNode(p.text));
  }

  $<HTMLTextAreaElement>('output').value = $<HTMLInputElement>('ai-note').checked ? `${AI_NOTE}\n\n${res.anonymizedText}` : res.anonymizedText;

  // 対応表
  const body = $('map-body');
  body.replaceChildren();
  for (const [token, original] of tokenMap) {
    const tr = document.createElement('tr');
    const a = document.createElement('td');
    a.append(chip(token, original));
    const b = document.createElement('td');
    b.textContent = original;
    const c = document.createElement('td');
    c.className = 'mono';
    c.textContent = token;
    tr.append(a, b, c);
    body.append(tr);
  }

  $('mask-result').hidden = false;
  $('mask-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

async function copy(text: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const label = button.textContent;
  button.textContent = 'コピーしました';
  setTimeout(() => (button.textContent = label), 1500);
}
$('copy-output').addEventListener('click', (e) => void copy($<HTMLTextAreaElement>('output').value, e.currentTarget as HTMLButtonElement));

$('clear-all').addEventListener('click', () => {
  inputEl.value = '';
  updateCount();
  $<HTMLTextAreaElement>('output').value = '';
  $<HTMLTextAreaElement>('reply').value = '';
  $<HTMLTextAreaElement>('restored').value = '';
  $('mask-result').hidden = true;
  $('restore-result').hidden = true;
  $('restore-warn').hidden = true;
  tokenMap = null;
  showError(null);
});

// ---------- もとに戻す ----------
function updateRestoreLead() {
  $('restore-lead').textContent = tokenMap
    ? `「② かくす」で作った対応表（${tokenMap.size} 件）を使って、AI の返事の印を元の言葉に戻します。`
    : 'まだ「② かくす」をしていません。この画面を開いたまま、先に文章をかくしてください（対応表は保存しないので、読み込み直すと戻せません）。';
}

$('do-restore').addEventListener('click', () => {
  const warn = $('restore-warn');
  warn.hidden = true;
  const reply = $<HTMLTextAreaElement>('reply').value;
  if (!tokenMap) {
    warn.hidden = false;
    warn.textContent = '対応表がありません。先に「② かくす」をしてください。';
    return;
  }
  // AI が注意書きをそのまま返してきたら、戻した文章からは外す
  const restored = restoreText(reply.split(AI_NOTE).join('').replace(/^\s+/, ''), tokenMap);
  const unknown = unknownTokens(reply, tokenMap);
  const fixed = (restored.match(/\[\[MASKED_[A-Z]+\]\]/g) ?? []).length;
  const notes: string[] = [];
  if (unknown.length) notes.push(`戻せなかった印が ${unknown.length} か所あります（AI が印を書き換えたかもしれません）：${[...new Set(unknown)].join('、')}`);
  if (fixed) notes.push(`番号・住所などの印（[[MASKED_…]]）は元に戻りません。${fixed} か所あります。必要なら手で書き入れてください。`);
  if (notes.length) {
    warn.hidden = false;
    warn.textContent = notes.join('\n');
  }
  $<HTMLTextAreaElement>('restored').value = restored;
  $('restore-result').hidden = false;
});
$('copy-restored').addEventListener('click', (e) => void copy($<HTMLTextAreaElement>('restored').value, e.currentTarget as HTMLButtonElement));
