/**
 * 画面から使う伏せ字処理（子ども・福祉に限らず、どんな文章にも使う）。
 * - 登録した言葉（人の名前・あだ名、施設、地域、その他）を必ずかくす
 * - 登録がなくても、生年月日・住んでいる地域・住所・電話・メールなどは形から見つけてかくす
 * - 登録していない「〇〇さん」「氏名：〇〇」も形から拾う（最善努力）
 * かくした印は、番号・住所の一部（[[MASKED_…]]）を除いて元に戻せる
 */
import { anonymize, escapeRegExp, type AnonymizeResult, type MaskTerm, type ReviewFlag, type StudentIdentity } from './anonymizer';

export type EntryKind = 'person' | 'org' | 'place' | 'word';

export type Entry =
  | { id: string; kind: 'person'; /** 「山田 太郎」のように姓と名の間を空ける。名字だけ・名前だけでもよい */ name: string; aliases: string[] }
  | { id: string; kind: 'org' | 'place' | 'word'; term: string };

export type Roster = { entries: Entry[] };

export const emptyRoster = (): Roster => ({ entries: [] });

export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  person: '人の名前',
  org: '施設・会社・学校など',
  place: '地域・場所',
  word: 'その他の言葉',
};

export type MaskOptions = {
  /** 登録していない「〇〇さん」「氏名：〇〇」もかくす */
  guessNames: boolean;
};

// ---------- 登録する言葉のチェック ----------

/** 敬称の前に来ても人の名前ではない言葉 */
const NOT_NAMES = new Set([
  '母', '父', '兄', '姉', '弟', '妹', '皆', '奥', '娘', '息子', '赤', '爺', '婆', '叔父', '叔母', '伯父', '伯母', '祖父', '祖母',
  '客', '保護者', '利用者', '職員', '先生', '担任', '児童', '生徒', '友達', '本人', '相手', '隣', '近所', '業者', '運転手', '担当',
  '各位', '患者', '王', '神', '仏', '様', '殿', '新人', '主任', '園長', '校長', '社長', '店長', '部長', '課長', '係長', '院長', '館長',
  '医者', '先輩', '後輩', '同級生', '上級生', '下級生', '大人', '子', '子供', '子ども', '家族', '親', '両親', '親御', '皆様', '皆さま',
  'ママ', 'パパ', 'スタッフ', 'ヘルパー', 'ドライバー', 'ボランティア', 'リーダー', 'ケアマネ', 'ケアマネジャー', 'ケアマネージャー',
  'お客', '王子', '姫', '神様', '仏様', '主', '方', '某', '社員', '会員', '組合員', '担当者', '新入生', '卒業生', '店員', '駅員',
]);

/** 登録すると文章のあちこちがかくれてしまう、ふつうの言葉 */
const COMMON_WORDS = new Set([
  ...NOT_NAMES,
  'さん', 'くん', 'ちゃん', 'さま', '今日', '明日', '昨日', '今年', '来年', '去年', '午前', '午後', '学校', '会社', '病院', '施設', '事業所',
  '保育園', '幼稚園', '小学校', '中学校', '高校', '大学', '自宅', '家', '地域', '住所', '名前', '氏名', '電話', '番号', '日本', '場所',
  '時間', '支援', '計画', '記録', '報告', '会議', '面談', 'これ', 'それ', 'あれ', 'こと', 'もの', 'ため', 'よう', 'とき',
]);

const ALLOWED = /^[\p{L}\p{N}ー・々〆ヶ&＆.．'’\-－()（） ]+$/u;

/** 空白をそろえる（全角・連続した空白 → 半角1つ） */
export function normalizeTerm(s: string): string {
  return s.normalize('NFC').replace(/[\s　]+/g, ' ').trim();
}

/** 登録できない理由を返す。登録できるときは null */
export function checkTerm(raw: string, kind: EntryKind, existing: Set<string>): string | null {
  const t = normalizeTerm(raw);
  const compact = t.replace(/ /g, '');
  if (!t) return '空です';
  if (t.length > 30) return '長すぎます（30文字まで）';
  if (/\[|\]/.test(t)) return '「[」「]」は使えません（かくした印と区別できなくなるため）';
  if (!ALLOWED.test(t)) return '使えない記号が入っています（使えるのは文字・数字と「ー・&.-()」など）';
  if (!/[\p{L}\p{N}]/u.test(t)) return '文字か数字を入れてください（記号だけは登録できません）';
  if (kind === 'person' && !/\p{L}/u.test(t)) return '名前には文字を入れてください';
  if (/^[0-9０-９\-－. ．]+$/.test(t)) return '数字だけは登録できません（電話・番号などは自動でかくします）';
  // 「林」「李」のような1文字の名字・名前は、人の名前のときだけ（漢字かカタカナ1文字）登録できる
  if (compact.length < 2 && !(kind === 'person' && /^[\p{Script=Han}\p{Script=Katakana}]$/u.test(compact))) {
    return '2文字以上にしてください（1文字だと関係ない言葉までかくしてしまうため。人の名前なら漢字・カタカナ1文字は登録できます）';
  }
  if (/^[ぁ-ゖー]{1,2}$/.test(compact) && kind !== 'person') return 'ひらがな2文字までの言葉は、ほかの言葉とまちがえやすいので登録できません';
  if (COMMON_WORDS.has(compact)) return 'ふつうの言葉なので登録できません（文章のあちこちがかくれてしまうため）';
  if (existing.has(compact)) return 'すでに登録されています';
  return null;
}

/** 登録はできるが、気をつけてほしいこと（なければ null） */
export function termNotice(raw: string): string | null {
  const compact = normalizeTerm(raw).replace(/ /g, '');
  if (compact.length === 1) {
    return `1文字の名前「${compact}」は、「${compact}さん」のように敬称が付くか、前後が漢字でないときだけかくします（「${compact}業」などの言葉はそのまま残ります）`;
  }
  return null;
}

/** 登録済みの言葉（くっつけた形）をすべて集める。重なりのチェック用 */
export function registeredSurfaces(roster: Roster): Set<string> {
  const out = new Set<string>();
  for (const e of roster.entries) {
    if (e.kind === 'person') {
      out.add(e.name.replace(/ /g, ''));
      e.aliases.forEach((a) => out.add(a.replace(/ /g, '')));
    } else out.add(e.term.replace(/ /g, ''));
  }
  return out;
}

/** 読み込んだファイルなどを、チェックを通ったものだけにする */
export function sanitizeRoster(raw: unknown): { roster: Roster; rejected: number } {
  const roster = emptyRoster();
  let rejected = 0;
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Roster).entries) ? (raw as Roster).entries : [];
  for (const e of list as unknown[]) {
    if (!e || typeof e !== 'object') {
      rejected++;
      continue;
    }
    const o = e as Record<string, unknown>;
    const seen = registeredSurfaces(roster);
    if (o.kind === 'person' && typeof o.name === 'string') {
      if (checkTerm(o.name, 'person', seen)) {
        rejected++;
        continue;
      }
      const aliases: string[] = [];
      for (const a of Array.isArray(o.aliases) ? o.aliases : []) {
        if (typeof a !== 'string') continue;
        const both = new Set([...seen, normalizeTerm(o.name).replace(/ /g, ''), ...aliases]);
        if (checkTerm(a, 'person', both)) rejected++;
        else aliases.push(normalizeTerm(a));
      }
      roster.entries.push({ id: crypto.randomUUID(), kind: 'person', name: normalizeTerm(o.name), aliases });
    } else if ((o.kind === 'org' || o.kind === 'place' || o.kind === 'word') && typeof o.term === 'string') {
      if (checkTerm(o.term, o.kind, seen)) rejected++;
      else roster.entries.push({ id: crypto.randomUUID(), kind: o.kind, term: normalizeTerm(o.term) });
    } else rejected++;
  }
  return { roster, rejected };
}

// ---------- 名簿 → anonymizer の形 ----------

/** 登録した人の名前の書き方（くっつけた形・半角空白・全角空白）。3語以上の名前は、各語（2文字以上）も */
function fullNameForms(name: string): string[] {
  const parts = name.split(' ').filter(Boolean);
  const forms = new Set([parts.join(''), parts.join(' '), parts.join('　')]);
  if (parts.length >= 3) parts.filter((p) => p.length >= 2).forEach((p) => forms.add(p));
  return [...forms];
}

/** 1文字だけの名前・呼び方（「林」など）。anonymize には渡さず、maskSingleChars で別に扱う */
const isSingle = (s: string) => s.replace(/ /g, '').length === 1;

function personIdentity(e: Extract<Entry, { kind: 'person' }>): StudentIdentity | null {
  if (isSingle(e.name) && e.aliases.every(isSingle)) return null;
  const parts = e.name.split(' ').filter(Boolean);
  const multi = !isSingle(e.name);
  return {
    studentId: e.id,
    familyName: multi ? (parts[0] ?? '') : '',
    givenName: multi ? parts.slice(1).join('') : '',
    // 「John Paul Smith」のような3語以上の名前でも、書いたとおりの形を丸ごとかくす
    aliases: [...new Set([...(multi ? fullNameForms(e.name) : []), ...e.aliases.filter((a) => !isSingle(a))])],
  };
}

const KANJI_KANA = '[\\p{Script=Han}々\\p{Script=Katakana}ー]';

/**
 * 1文字の名前は、敬称が続くか、前後が漢字・カタカナでないとき（ほかの言葉の一部でないとき）だけかくす。
 * 「林さん」「担当：林」はかくし、「林業」「森林」は残す
 */
function maskSingleChars(res: MaskResult, people: Extract<Entry, { kind: 'person' }>[]): MaskResult {
  let text = res.anonymizedText;
  for (const p of people) {
    const singles = [p.name, ...p.aliases].filter(isSingle).map((s) => s.replace(/ /g, ''));
    if (singles.length === 0) continue;
    // 同じ人の印がすでにあればそれを使う
    let token = [...res.tokenMap].find(([t, v]) => t.startsWith('[[PERSON_ID:') && (v === p.name || fullNameForms(p.name).includes(v) || p.aliases.includes(v)))?.[0];
    for (const ch of singles) {
      const c = escapeRegExp(ch);
      const re = new RegExp(`${c}(?=さん|くん|ちゃん|様|さま|君|氏)|(?<!${KANJI_KANA})${c}(?!${KANJI_KANA})`, 'gu');
      text = text.replace(re, () => {
        if (!token) {
          token = `[[PERSON_ID:${newId(res.tokenMap)}]]`;
          res.tokenMap.set(token, p.name.replace(/ /g, ''));
        }
        return token;
      });
    }
  }
  return { ...res, anonymizedText: text };
}

/** 「姓 名」から、くっつけた形・半角空白・全角空白の形と、2文字以上の姓・名を作る */
function personForms(name: string): string[] {
  const parts = name.split(/[\s　]+/).filter(Boolean);
  if (parts.length < 2) return [parts.join('')];
  return [parts.join(''), parts.join(' '), parts.join('　'), ...parts.filter((p) => p.length >= 2)];
}

// ---------- 形から見つけるもの ----------

const HONORIFIC_NAME = /(?<![\p{Script=Han}々\p{Script=Katakana}ー])([\p{Script=Han}々\p{Script=Katakana}ー]{1,6})(?=さん|くん|ちゃん|君|様|さま|氏)/gu;
/** ひらがなの名前 +「さん」など（「みきさん」「さくらちゃん」） */
const HIRAGANA_HONORIFIC = /[ぁ-ゖ]{2,8}(?=さん|くん|ちゃん|君|様|さま)/gu;
/** 名前の前にくっついている助詞（「友だちのみきさん」の「の」）を切る目印 */
const PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'や', 'の', 'も']);
/** 「さん」などが付いても名前ではない、ひらがなの言葉 */
const NOT_HIRAGANA_NAMES = new Set([
  'おかあ', 'おとう', 'おにい', 'おねえ', 'おじい', 'おばあ', 'おじ', 'おば', 'かあ', 'とう', 'にい', 'ねえ', 'じい', 'ばあ',
  'みな', 'みんな', 'あか', 'おく', 'おきゃく', 'きゃく', 'おいしゃ', 'おまわり', 'おひめ', 'おうじ', 'かみ', 'ほとけ',
  'おつかれ', 'ごくろう', 'おせわ', 'おたがい', 'おかげ', 'ごちそう', 'おそまつ', 'おきのどく', 'ごしゅうしょう', 'おまちどお',
  'おまちどう', 'わん', 'にゃん', 'おこさ', 'おこ', 'ごかぞく', 'ごりょうしん', 'ほごしゃ', 'りようしゃ', 'せんせい',
]);

/** ひらがなのかたまりから、名前の部分だけを取り出す（前にくっついた言葉・助詞を切る）。名前でなければ null */
function hiraganaNamePart(run: string): string | null {
  let name = run;
  // 先頭の1文字は名前の一部かもしれない（「のぞみ」「ともみ」）ので、2文字目以降の助詞で切る
  for (let i = run.length - 1; i >= 1; i--) {
    if (PARTICLES.has(run[i]) && run.length - i - 1 >= 2) {
      name = run.slice(i + 1);
      break;
    }
  }
  return NOT_HIRAGANA_NAMES.has(name) ? null : name;
}

/** 見出し語のあとの名前（書類の「氏名：山田 太郎」など）。ひらがなの名前も拾う */
const LABEL_NAME = new RegExp(
  // 書類・メール・申込書などでよく使う見出し語。「担当者に連絡」のような文はとばすため、「：」か空白で区切られたものだけ
  String.raw`(利用者氏名|患者氏名|保護者氏名|児童氏名|お子様のお名前|お名前|氏名|名前|患者名|お客様名|顧客名|契約者名?|申込者名?|依頼者名?|社員名|従業員名|` +
    String.raw`宛名|宛先|差出人|送信者|受信者|受取人|送り主|署名|担当スタッフ|ご担当者様?|担当者|担当|作成者|記入者|承認者|申請者|代表者|責任者)([：:][\s　]*|[\s　]+)` +
    String.raw`([\p{Script=Han}々\p{Script=Katakana}ーぁ-ゖ]{1,6}(?:[ 　][\p{Script=Han}々\p{Script=Katakana}ーぁ-ゖ]{1,6})?)`,
  'gu',
);

/** 書類の見出し語のあと（「氏名：やまだ はると」など）にある名前を拾う */
export function labeledNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(LABEL_NAME)) {
    // 後ろに付いた敬称とそれより後ろ（「はるとくんは」の「くんは」）は名前に含めない。
    // 敬称がないときは何も削らない（「いろは」の「は」を助詞とまちがえて残さないため）
    const name = m[3].replace(/(?:さん|くん|ちゃん|さま|様|君|氏).*$/u, '').trim();
    if (name && !NOT_NAMES.has(name.replace(/[ 　]/g, ''))) out.add(name);
  }
  return [...out];
}

const D = '[0-9０-９]';
const ERA_YEAR = `(?:(?:令和|平成|昭和|大正|[RHSTrhst])\\s*(?:${D}{1,2}|元))`;
const YEAR = `(?:${ERA_YEAR}|${D}{4})`;
/** 年月日（日は省略可）：2015年4月3日 / 平成27年4月 / 2015/4/3 / H27.4.3 */
const DATE = `${YEAR}\\s*[年./／\\-－]\\s*${D}{1,2}\\s*(?:月\\s*${D}{1,2}\\s*日|[./／\\-－]\\s*${D}{1,2}(?!${D})|月)`;
const BIRTH_LABELED = new RegExp(`(生年月日|誕生日|出生日|生まれ|生年)([：:\\t 　(（]*)(${DATE})`, 'gu');
const BIRTH_SUFFIXED = new RegExp(`(${DATE})(?=\\s*(?:生まれ|産まれ|出生|生(?!\\p{Script=Han})))`, 'gu');

/** 生年月日らしき日付を拾う（「生年月日：…」「…生まれ」の形のものだけ。ふつうの日付はかくさない） */
export function birthDates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(BIRTH_LABELED)) out.add(m[3].trim());
  for (const m of text.matchAll(BIRTH_SUFFIXED)) out.add(m[1].trim());
  return [...out];
}

const HAN = '[\\p{Script=Han}々ヶ]';
/** 都道府県・市区町村の連なり（「神奈川県横浜市港北区」「港区」「横浜市」）。続く字が漢字のもの（市場・区別・町内会）は除く */
const AREA = new RegExp(
  `(?<!${HAN})(?:北海道|${HAN}{1,4}?[都府県])?(?:${HAN}{1,5}?[市区町村郡]){0,3}${HAN}{1,5}?[都府県市区町村郡](?=$|[^\\p{Script=Han}々ヶ\\p{Script=Katakana}]|[内在民立外出])`,
  'gu',
);
/** 地域の名前ではない「〇〇市」「〇〇区」など（最後の部分で判断する） */
const NOT_AREAS = new Set([
  '都市', '首都', '古都', '政府', '幕府', '朝市', '闇市', '見本市', '同市', '本市', '当市', '各市', '全市', '他市', '市', '区', '町', '村', '県', '府', '都', '郡',
  '地区', '学区', '校区', '選挙区', '同区', '各区', '特区', '管区', '本区', '当区', '下町', '城下町', '門前町', '同町', '本町', '当町', '各町',
  '農村', '山村', '漁村', '寒村', '選手村', '同村', '本村', '当村', '各県', '同県', '本県', '当県', '他県', '全県', '府県', '都府県', '道府県',
  '都道府県', '市区町村', '市町村', '区市町村', '市区', '町村', '同府', '大都市', '中都市', '小都市', '政令市', '中核市',
]);
const STATION = /(?<![\p{Script=Han}々\p{Script=Katakana}ー])([\p{Script=Han}々\p{Script=Katakana}ー]{1,8})駅(?![\p{Script=Han}])/gu;
const NOT_STATIONS = new Set(['最寄', '最寄り', '各', '同', '前', '次', '当', '始発', '終着', '終点', '途中', '主要', '乗換', '乗り換え']);
const LIVES_IN = /(?<![\p{Script=Han}々\p{Script=Katakana}ー])([\p{Script=Han}々\p{Script=Katakana}ー]{2,8})(?=在住|出身|育ち|に住|に住ん|に引っ越)/gu;
const NOT_LIVES = new Set(['海外', '国内', '県内', '県外', '市内', '市外', '都内', '都外', '地元', '近所', '近く', '同じ', '日本国内']);
/** ひらがな・カタカナの地名（「つくば市」「ニセコ町」）、「〇〇在住」「〇〇出身」 */
const KANA_AREA = /[ぁ-ゖァ-ヺー]{2,7}(?=[市区町村郡](?:$|[^\p{Script=Han}々ヶ\p{Script=Katakana}]|[内在民立外出]))[市区町村郡]/gu;
const KANA_LIVES_IN = /[ぁ-ゖァ-ヺー]{2,8}(?=在住|出身)/gu;
/** 地名の前にくっついた助詞（「私はつくば市」の「は」）を1文字だけ外す */
function trimLeadingParticle(s: string): string {
  return 'はがをにでへものや'.includes(s[0]) && /^[ぁ-ゖ]/.test(s) && s.length - 1 >= 3 ? s.slice(1) : s;
}

/** 「住所：…」の形（区切りの「：」か空白があるものだけ。「住所変更」などはとばす） */
const RESIDENCE_LABELED = /(現住所|住所|お住まい|住まい|居住地|所在地|住居)([：:][\s　]*|[\s　]+)([^\n。]{2,60})/gu;

/** 住んでいる場所・地域らしき言葉を拾う */
export function placeNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(RESIDENCE_LABELED)) {
    // 同じ行の「電話…」など、住所のあとに続く別の欄は含めない
    const addr = m[3].split(/[ 　]*(?:電話|TEL|Tel|tel|℡|携帯|FAX|Fax|メール|E-?mail)|　|[ ]{2,}/)[0].trim();
    if (addr) out.add(addr);
  }
  for (const m of text.matchAll(AREA)) {
    const area = m[0];
    // 最後の部分（「港北区」など）がふつうの言葉なら全体をとばす
    const parts = area.match(new RegExp(`${HAN}+?[都府県市区町村郡]`, 'gu')) ?? [area];
    const last = parts[parts.length - 1];
    if (NOT_AREAS.has(area) || NOT_AREAS.has(last) || area.length < 2) continue;
    out.add(area);
  }
  for (const m of text.matchAll(STATION)) if (!NOT_STATIONS.has(m[1])) out.add(`${m[1]}駅`);
  for (const m of text.matchAll(LIVES_IN)) if (!NOT_LIVES.has(m[1])) out.add(m[1]);
  for (const m of text.matchAll(KANA_AREA)) out.add(trimLeadingParticle(m[0]));
  for (const m of text.matchAll(KANA_LIVES_IN)) {
    const p = trimLeadingParticle(m[0]);
    if (!NOT_LIVES.has(p) && p.length >= 2) out.add(p);
  }
  return [...out].filter((p) => p.replace(/\s/g, '').length >= 2);
}

const CORP = '株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人社団|医療法人|学校法人|宗教法人|特定非営利活動法人|NPO法人';
const CORP_NAME_CHAR = '[\\p{Script=Han}々\\p{Script=Katakana}ーA-Za-z0-9＆&・．.]';
/** 「株式会社みどり」「（株）みどり」：会社の種類が前 */
const CORP_BEFORE = new RegExp(`(?:${CORP}|[（(]株[）)]|[（(]有[）)])[ 　]?((?:${CORP_NAME_CHAR}|[ぁ-ゖ]){1,15})`, 'gu');
/** 「トヨタ自動車株式会社」：会社の種類が後ろ（ひらがなは助詞とまぎれるので含めない） */
const CORP_AFTER = new RegExp(`(?<!${CORP_NAME_CHAR})(${CORP_NAME_CHAR}{1,15}?)[ 　]?(?:${CORP}|[（(]株[）)])`, 'gu');

/** 会社・法人の名前を拾う（会社の種類の言葉も含めて丸ごと） */
export function corporateNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CORP_BEFORE)) {
    // 名前のあとにくっついた助詞（「株式会社みどりの鈴木」の「の鈴木」）を切る。先頭の1文字は名前の一部とみなす
    const name = m[1];
    let cut = name.length;
    for (let i = 1; i < name.length; i++) {
      if (PARTICLES.has(name[i]) && /[ぁ-ゖ]/.test(name[i])) {
        cut = i;
        break;
      }
    }
    const kept = name.slice(0, cut);
    if (kept) out.add(m[0].slice(0, m[0].length - name.length + kept.length));
  }
  for (const m of text.matchAll(CORP_AFTER)) out.add(m[0]);
  return [...out].filter((c) => c.length >= 3);
}

/**
 * 電話・メール・郵便番号・長い番号。anonymize でも伏せるが、そちらは元に戻せない印（[[MASKED_…]]）になるので、
 * 先に見つけて元に戻せる印にする（形は anonymizer.ts の maskSensitive と同じ）
 */
const DIG = '[0-9０-９]';
const HYP = '[-‐－]';
const SEPS = '[-‐－ー\\s()（）]';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_NUMBER_RE = new RegExp(`(?<!${DIG})${DIG}(?:${HYP}?${DIG}){9,}(?!${DIG})`, 'g');
const PHONE_RE = new RegExp(`(?<!${DIG})0${DIG}{1,4}${SEPS}{1,3}${DIG}{1,4}${SEPS}{1,3}${DIG}{3,4}(?!${DIG})`, 'g');
const POSTAL_RE = new RegExp(`〒\\s*${DIG}{3}${HYP}?${DIG}{4}|(?<!${DIG})${DIG}{3}${HYP}${DIG}{4}(?!${DIG})`, 'g');

export function contactDetails(text: string): { surface: string; prefix: 'EMAIL_ID' | 'NUMBER_ID' | 'ADDRESS_ID' }[] {
  const out = new Map<string, 'EMAIL_ID' | 'NUMBER_ID' | 'ADDRESS_ID'>();
  const digits = (s: string) => (s.match(/[0-9０-９]/g) ?? []).length;
  for (const m of text.matchAll(EMAIL_RE)) out.set(m[0], 'EMAIL_ID');
  for (const m of text.matchAll(LONG_NUMBER_RE)) out.set(m[0], 'NUMBER_ID');
  for (const m of text.matchAll(PHONE_RE)) if (digits(m[0]) >= 9 && digits(m[0]) <= 11) out.set(m[0].trim(), 'NUMBER_ID');
  for (const m of text.matchAll(POSTAL_RE)) out.set(m[0], 'ADDRESS_ID');
  return [...out].map(([surface, prefix]) => ({ surface, prefix }));
}

// ---------- かくす・戻す ----------

export type MaskResult = {
  anonymizedText: string;
  /** 印 -> 元の言葉（画面のメモリだけに持つ） */
  tokenMap: Map<string, string>;
  flags: ReviewFlag[];
};

function newId(used: Map<string, string>): string {
  for (;;) {
    const b = new Uint8Array(4);
    globalThis.crypto.getRandomValues(b);
    const id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    if (![...used.keys()].some((k) => k.includes(id))) return id;
  }
}

/**
 * 同じ人の印は、最初に出た呼び方（あだ名かもしれない）で戻ってしまう。
 * 文章の中にその人の正式な名前（登録した氏名の形）があれば、それで戻すようにする
 */
function preferFullNames(res: AnonymizeResult, text: string, people: Extract<Entry, { kind: 'person' }>[]) {
  const owners = new Map<string, Set<string>>();
  for (const p of people) {
    const parts = p.name.split(' ').filter(Boolean);
    for (const s of [...fullNameForms(p.name), ...parts, ...p.aliases]) {
      const set = owners.get(s) ?? new Set<string>();
      set.add(p.id);
      owners.set(s, set);
    }
  }
  for (const [token, surface] of res.tokenMap) {
    if (!token.startsWith('[[CHILD_ID:')) continue;
    const ids = owners.get(surface);
    if (!ids || ids.size !== 1) continue;
    const person = people.find((p) => ids.has(p.id))!;
    let best: { at: number; form: string } | null = null;
    for (const form of fullNameForms(person.name).filter((f) => f.replace(/[ 　]/g, '').length >= person.name.replace(/ /g, '').length)) {
      const at = text.indexOf(form);
      if (at >= 0 && (!best || at < best.at)) best = { at, form };
    }
    if (best) res.tokenMap.set(token, best.form);
  }
}

/** anonymize の印の名前を、このアプリ用（子ども向けではない名前）に付け替える */
function retag(res: AnonymizeResult, kindOf: (surface: string, token: string) => string | null): MaskResult {
  let text = res.anonymizedText;
  const tokenMap = new Map<string, string>();
  for (const [token, surface] of res.tokenMap) {
    const prefix = kindOf(surface, token);
    if (!prefix) {
      tokenMap.set(token, surface);
      continue;
    }
    const next = token.replace(/^\[\[[A-Z_]+:/, `[[${prefix}:`);
    text = text.split(token).join(next);
    tokenMap.set(next, surface);
  }
  return { anonymizedText: text, tokenMap, flags: res.flags };
}

/** anonymize のあとに、登録していない「〇〇さん」を形で見つけて PERSON_ID に置き換える */
function maskHonorificNames(res: MaskResult): MaskResult {
  const bySurface = new Map<string, string>();
  for (const [token, surface] of res.tokenMap) if (token.startsWith('[[PERSON_ID:')) bySurface.set(surface, token);
  const tokenFor = (m: string) => {
    let token = bySurface.get(m);
    if (!token) {
      token = `[[PERSON_ID:${newId(res.tokenMap)}]]`;
      bySurface.set(m, token);
      res.tokenMap.set(token, m);
    }
    return token;
  };
  const text = res.anonymizedText.replace(HONORIFIC_NAME, (m: string) => {
    // 「お母さん」の「母」のような語は一覧で外す。先頭の「お」「ご」はひらがななので対象外
    if (NOT_NAMES.has(m) || /^ー/.test(m)) return m;
    return tokenFor(m);
  });
  const withHiragana = text.replace(HIRAGANA_HONORIFIC, (run: string) => {
    const name = hiraganaNamePart(run);
    if (!name) return run;
    return run.slice(0, run.length - name.length) + tokenFor(name);
  });
  return { ...res, anonymizedText: withHiragana };
}

export function maskText(text: string, roster: Roster, opts: MaskOptions): MaskResult {
  const people = roster.entries.filter((e): e is Extract<Entry, { kind: 'person' }> => e.kind === 'person');
  const surfaceKind = new Map<string, string>();
  const terms: MaskTerm[] = [];
  const add = (term: string, prefix: string, kind: MaskTerm['kind']) => {
    if (term.replace(/\s/g, '').length < 2 || surfaceKind.has(term)) return;
    surfaceKind.set(term, prefix);
    terms.push({ term, kind });
  };
  for (const e of roster.entries) {
    if (e.kind === 'org') add(e.term, 'ORG_ID', 'org');
    if (e.kind === 'place') add(e.term, 'PLACE_ID', 'org');
    if (e.kind === 'word') add(e.term, 'WORD_ID', 'org');
  }
  // 登録がなくても、生年月日と住んでいる地域はかならずかくす
  for (const b of birthDates(text)) add(b, 'BIRTHDATE_ID', 'org');
  for (const p of placeNames(text)) add(p, 'PLACE_ID', 'org');
  for (const c of corporateNames(text)) add(c, 'ORG_ID', 'org');
  for (const c of contactDetails(text)) add(c.surface, c.prefix, 'org');
  if (opts.guessNames) for (const n of labeledNames(text)) for (const f of personForms(n)) add(f, 'PERSON_ID', 'person');

  const res = anonymize(text, people.map(personIdentity).filter((x): x is StudentIdentity => !!x), terms);
  preferFullNames(res, text, people);
  const out = retag(res, (surface, token) => {
    if (token.startsWith('[[CHILD_ID:') || token.startsWith('[[CHILD_AMBIGUOUS:') || token.startsWith('[[GUARDIAN_ID:')) return 'PERSON_ID';
    return surfaceKind.get(surface) ?? null;
  });
  const withSingles = maskSingleChars(out, people);
  return opts.guessNames ? maskHonorificNames(withSingles) : withSingles;
}

const TOKEN_RE = /\[\[[A-Z_]+:[0-9a-f]{8}\]\]/g;

/** 元に戻らない（番号などの）印。これ以外の MASKED_* は崩れた印として知らせる */
const KNOWN_FIXED = /^\[\[MASKED_(?:NUMBER|ADDRESS|DATE|EMAIL)\]\]$/;

export function restoreText(text: string, tokenMap: Map<string, string>): string {
  return text.replace(TOKEN_RE, (t) => tokenMap.get(t) ?? t);
}

/** AI の返事にある、対応表にない（または形が崩れた）印 */
export function unknownTokens(text: string, tokenMap: Map<string, string>): string[] {
  const found = text.match(/[\[［]{1,2}\s*(?:PERSON|ORG|PLACE|WORD|BIRTHDATE|NUMBER|EMAIL|ADDRESS|MASKED|CHILD|GUARDIAN)[A-Za-z_]*(?:\s*[:：]\s*[0-9A-Za-z]{0,12})?\s*[\]］]{0,2}/gi) ?? [];
  return found.map((t) => t.trim()).filter((t) => !tokenMap.has(t) && !KNOWN_FIXED.test(t));
}

export type TokenKind = 'person' | 'org' | 'place' | 'word' | 'birth' | 'number' | 'date' | 'email' | 'address';

export const KIND_LABEL: Record<TokenKind, string> = {
  person: '人の名前',
  org: '施設など',
  place: '地域・場所',
  word: 'その他',
  birth: '生年月日',
  number: '番号',
  date: '日付',
  email: 'メール',
  address: '住所',
};

export function tokenKind(token: string): TokenKind | null {
  const m = /^\[\[([A-Z_]+)/.exec(token);
  switch (m?.[1]) {
    case 'PERSON_ID': return 'person';
    case 'ORG_ID': return 'org';
    case 'PLACE_ID': return 'place';
    case 'WORD_ID': return 'word';
    case 'BIRTHDATE_ID': return 'birth';
    case 'NUMBER_ID':
    case 'MASKED_NUMBER': return 'number';
    case 'MASKED_DATE': return 'date';
    case 'EMAIL_ID':
    case 'MASKED_EMAIL': return 'email';
    case 'ADDRESS_ID':
    case 'MASKED_ADDRESS': return 'address';
    default: return null;
  }
}

/** 表示用：文章を「ふつうの文字」と「かくした印」に分ける */
export function splitTokens(text: string): { text: string; token: boolean }[] {
  const out: { text: string; token: boolean }[] = [];
  const re = /\[\[[A-Z_]+(?::[0-9a-f]{8})?\]\]/g;
  let pos = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > pos) out.push({ text: text.slice(pos, i), token: false });
    out.push({ text: m[0], token: true });
    pos = i + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), token: false });
  return out;
}
