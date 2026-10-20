/**
 * 仮名化ユーティリティ。箱舟 lib/anonymizer.ts の写し（直すときは両方そろえる）。
 *
 * - このアプリではブラウザの中だけで動く。tokenMap は画面のメモリだけに持つ（保存しない）
 * - flags[].text には実名が入りうる。ログに出さないこと（件数・reason・index のみ可）
 * - 検出できるのは「登録済みの氏名・愛称・受給者番号・生年月日・保護者名」と、
 *   数字列・電話・郵便番号・住所らしき表記の最善努力のみ。未登録の人名・学校名等は検出できない。
 *   呼び出し側は anonymizedText を確認してから送ること
 */

export type GuardianIdentity = {
  familyName: string;
  givenName: string;
};

/** 復号済みの児童情報（サーバー側でのみ生成する） */
export type StudentIdentity = {
  studentId: string;
  familyName: string;
  givenName: string;
  aliases: string[];
  recipientNumber?: string;
  /** YYYY-MM-DD */
  birthDate?: string;
  guardians?: GuardianIdentity[];
};

/** 児童以外に伏せる名前（園・学校・病院などの施設名、先生などの人名）。事業所ごとに登録する */
export type MaskTerm = { term: string; kind: 'org' | 'person' };

/**
 * 登録がなくても形で見つけて伏せる施設名（最善努力）。
 * 「〇〇保育園」「〇〇小学校」「〇〇病院」「〇〇園」などの語尾を見つけ、その前の名前部分（漢字・カタカナ・英数字・
 * 助詞以外のひらがな）までまとめて伏せる。「近くの保育園」のように名前が付かない言い方は伏せない
 */
const FACILITY_SUFFIXES = [
  '認定こども園', 'こども園', '子ども園', '保育園', '保育所', '保育室', '幼稚園', 'ようちえん', 'ほいくえん',
  '特別支援学校', '支援学校', '小学校', '中学校', '高等学校', '高校', '学園', '学童保育', '学童', '学級', '分校',
  '児童館', '児童発達支援センター', '発達支援センター', '支援センター', '療育センター', 'センター', '公民館', '市役所', '区役所', '役場',
  'クリニック', '病院', '医院', '診療所', '歯科', '小児科', '教室', 'スクール', '塾', '園',
].sort((a, b) => b.length - a.length);
const FACILITY_SUFFIX_RE = new RegExp(FACILITY_SUFFIXES.map((x) => escapeRegExp(x)).join('|'), 'gu');
/** 「園」単体の語尾で、施設名ではない一般的な言葉 */
const GENERIC_EN_PREFIX = ['公', '動物', '植物', '遊', '庭', '菜', '農', '楽', '霊', '田', '入', '退', '登', '降', '通', '来', '当', '本', '同', '他', '前', '保育', '幼稚', '学'];
const NAME_CHAR = /[\p{Script=Han}\p{Script=Katakana}ー・A-Za-z0-9０-９Ａ-Ｚａ-ｚ]/u;
const HIRAGANA = /[ぁ-ゖ]/u;
const PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'や', 'の']);

/** 施設名を見つけて置き換える。置き換え済みの記号（[[...]]）には触れない */
function maskFacilities(text: string, tokenFor: (surface: string) => string): string {
  const spans: [number, number][] = [];
  for (const m of text.matchAll(FACILITY_SUFFIX_RE)) {
    const suffix = m[0];
    const end = (m.index ?? 0) + suffix.length;
    let start = m.index ?? 0;
    // 左へ名前部分を伸ばす（最大12文字）
    let steps = 0;
    let sawHiragana = false;
    while (start > 0 && steps < 12) {
      const c = text[start - 1];
      if (c === ']' || c === '[') break;
      if (HIRAGANA.test(c) && !PARTICLES.has(c)) {
        sawHiragana = true;
      } else if (NAME_CHAR.test(c)) {
        // ひらがなの名前の前の漢字（「本日ひまわり保育園」の「本日」）は名前に含めない
        if (sawHiragana) break;
      } else {
        break;
      }
      start--;
      steps++;
    }
    const prefix = text.slice(start, m.index ?? 0);
    if (prefix.length === 0) continue; // 名前が付いていない（「近くの保育園」など）
    if (suffix === '園' || suffix === 'センター' || suffix === '教室') {
      // 「公園」「園庭」など一般語、「センター」「教室」だけの一般的な言い方は除く
      if (GENERIC_EN_PREFIX.some((g) => prefix.endsWith(g)) || NAME_CHAR.test(text[end] ?? '') && /[\p{Script=Han}]/u.test(text[end] ?? '')) continue;
      if (prefix.length < 2) continue;
    }
    // 直前の範囲と重なる場合は長い方を残す
    const last = spans[spans.length - 1];
    if (last && start < last[1]) {
      if (end - start > last[1] - last[0]) spans[spans.length - 1] = [start, end];
      continue;
    }
    spans.push([start, end]);
  }
  let out = '';
  let pos = 0;
  for (const [a, b] of spans) {
    out += text.slice(pos, a) + tokenFor(text.slice(a, b));
    pos = b;
  }
  return out + text.slice(pos);
}

const PERSON_PATTERN = /([\p{Script=Han}\p{Script=Katakana}ー]{1,4})(?=先生|せんせい|保育士|園長|校長|教頭|主任|指導員|支援員|職員|スタッフ|児発管|療法士|看護師|心理士|相談員)/gu;

/** 肩書きの前に付く一般語（「担当支援員」「常勤職員」「ベテラン職員」など）。名前ではないので伏せない */
const PERSON_GENERIC_PREFIX = [
  '担当', '担任', '常勤', '非常勤', '主任', '専門', '専任', '新人', '男性', '女性', '補助', '介助', '看護', '医療', '保育', '支援', '指導',
  '事務', '送迎', '運転', '当日', '本日', '今日', '昨日', '翌日', '午前', '午後', '複数', '全体', '一部', '代替', '代理', '臨時', '加配',
  '管理', '相談', '園', '学校', '小学校', '中学校', '高校', '訪問', '巡回', '外部', '内部', '他', '各', '全', '同', '当', '本', '元', '前',
  '新', '正', '副', '現', '別', '他の', 'ベテラン', 'パート', 'アルバイト', 'フリー', 'メイン', 'サブ', 'リーダー', 'チーム', 'クラス',
  '当園', '本園', '他園', '同園', '自園', '当校', '本校', '他校', '当所', '本所', '当事業所', '他事業所', '当施設', '他施設',
];

/**
 * 「佐藤担当支援員」→ 伏せるのは「佐藤」だけ。「担当支援員」→ 何も伏せない。
 * 1 文字の一般語（本・元・園・前 など）は、名前の末尾の字と区別できないので、
 * 全体がその 1 文字のとき（「新職員」「他職員」）だけ外す。「山本先生」「秋元支援員」は丸ごと伏せる
 */
function maskPersonTitles(text: string, tokenFor: (surface: string) => string): string {
  return text.replace(PERSON_PATTERN, (m) => {
    let name = m;
    let tail = '';
    for (;;) {
      const g = PERSON_GENERIC_PREFIX.filter((p) => name.endsWith(p) && (p.length >= 2 || name === p)).sort((a, b) => b.length - a.length)[0];
      if (!g) break;
      name = name.slice(0, -g.length);
      tail = g + tail;
    }
    if (name.length === 0) return m;
    return tokenFor(name) + tail;
  });
}

/** 肩書き・敬称（職員の下の名前は、これが続くときだけ伏せる） */
const STAFF_GIVEN_SUFFIXES = ['さん', '先生', '支援員', '職員', 'スタッフ', '児発管', '療法士', '心理士', '看護師', '相談員', '指導員', '保育士', '主任'];

/**
 * 職員名から「伏せる名前」を作る。フルネーム（空白なし・半角空白・全角空白の形）と姓はそのまま伏せる。
 * 下の名前は「希望」「大地」など一般語と重なりやすいので、敬称や肩書きが続くときだけ伏せる
 */
export function staffNameMaskTerms(names: string[]): MaskTerm[] {
  const out = new Map<string, MaskTerm>();
  const add = (term: string) => {
    const t = term.trim();
    if (t.length >= 2 && !out.has(t)) out.set(t, { term: t, kind: 'person' });
  };
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const parts = name.split(/[\s　]+/).filter(Boolean);
    add(name.replace(/[\s　]+/g, ''));
    if (parts.length === 1) continue;
    // 「佐藤 健」「佐藤　健」のように空白つきで書かれても下の名前が残らないよう、空白つきの形も伏せる
    add(parts.join(' '));
    add(parts.join('　'));
    add(parts[0]);
    for (const given of parts.slice(1)) {
      if (given.length < 1) continue;
      for (const sfx of STAFF_GIVEN_SUFFIXES) add(given + sfx);
    }
  }
  return [...out.values()];
}

export type ReviewFlagReason =
  /** 同姓の児童が複数いて、姓のみでは特定できない */
  | 'ambiguous_surname'
  /** 愛称・名・保護者姓などが複数人で共有されていて特定できない */
  | 'ambiguous_surface'
  /** 「伊藤園」のように名前が別の語の一部かもしれない（伏せた上で確認を促す） */
  | 'possible_compound_word';

export type ReviewFlag = {
  reason: ReviewFlagReason;
  /** 元テキスト上の該当文字列（実名を含みうる。ログ禁止） */
  text: string;
  /** 入力テキスト（原文）上の位置 */
  index: number;
};

export type AnonymizeResult = {
  anonymizedText: string;
  /** token -> 元の文字列 */
  tokenMap: Map<string, string>;
  flags: ReviewFlag[];
  /** flags があれば true。確認画面で人が見てから送信すること */
  requiresReview: boolean;
};

type Owner = { key: string; kind: 'child' | 'guardian'; surfaceIsFamilyOnly: boolean };

const HONORIFICS = ['くん', 'ちゃん', 'さん', '君', '様', 'さま'];
const HAN_OR_KATAKANA = /[\p{Script=Han}゠-ヿ]/u;
const DIGIT = '[0-9０-９]';
const HYPHEN = '[-‐－]';
const SEP = '[-‐－ー\\s()（）]';

const TOKEN_RE = /\[\[(?:CHILD_ID|CHILD_AMBIGUOUS|GUARDIAN_ID|ORG_ID|PERSON_ID):[0-9a-f]{8}\]\]/g;
/** 形式が壊れたトークンも拾う緩い検出用 */
const LOOSE_TOKEN_RE = /\[\[\s*(?:CHILD|GUARDIAN|ORG|PERSON)[^\]]*(?:\]\])?/g;

const PREFECTURE =
  '(?:北海道|東京都|(?:京都|大阪)府|(?:青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)県)';
const ADDR_TAIL = '[\\p{Script=Han}0-9０-９ヶー\\-－]';

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function randomId(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function nameForms(family: string, given: string): string[] {
  return [`${family}${given}`, `${family} ${given}`, `${family}　${given}`];
}

function isCompoundContinuation(text: string, end: number): boolean {
  const next = text.charAt(end);
  if (!next || !HAN_OR_KATAKANA.test(next)) return false;
  return !HONORIFICS.some((h) => text.startsWith(h, end));
}

/** 半角・全角どちらの数字でも一致する正規表現片 */
function anyWidthDigits(digits: string): string {
  return Array.from(digits, (d) => `[${d}${String.fromCharCode(0xff10 + Number(d))}]`).join('');
}

function birthDateRegExp(birthDate: string): RegExp | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(birthDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = anyWidthDigits(String(Number(mo)));
  const day = anyWidthDigits(String(Number(d)));
  const sep = '\\s*[年/.／．\\-－]\\s*';
  return new RegExp(
    `${anyWidthDigits(y)}${sep}[0０]?${month}\\s*[月/.／．\\-－]\\s*[0０]?${day}\\s*日?`,
    'g',
  );
}

function countDigits(s: string): number {
  return (s.match(/[0-9０-９]/g) ?? []).length;
}

/** 名前の置換後に行う：受給者番号・生年月日・電話・郵便番号・住所らしき表記のマスク */
function maskSensitive(text: string, students: StudentIdentity[]): string {
  let out = text;
  for (const s of students) {
    if (s.recipientNumber) {
      out = out.replace(new RegExp(escapeRegExp(s.recipientNumber), 'g'), '[[MASKED_NUMBER]]');
    }
    if (s.birthDate) {
      const re = birthDateRegExp(s.birthDate);
      if (re) out = out.replace(re, '[[MASKED_DATE]]');
    }
  }
  // メールアドレス
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[[MASKED_EMAIL]]');
  // 10桁以上の数字列（ハイフン区切り含む）
  out = out.replace(
    new RegExp(`(?<!${DIGIT})${DIGIT}(?:${HYPHEN}?${DIGIT}){9,}(?!${DIGIT})`, 'g'),
    '[[MASKED_NUMBER]]',
  );
  // 電話番号形式（03-1234-5678 / 03(1234)5678 / 090 1234 5678）。数字が9〜11個のものだけ
  out = out.replace(
    new RegExp(`(?<!${DIGIT})0${DIGIT}{1,4}${SEP}{1,3}${DIGIT}{1,4}${SEP}{1,3}${DIGIT}{3,4}(?!${DIGIT})`, 'g'),
    (m) => (countDigits(m) >= 9 && countDigits(m) <= 11 ? '[[MASKED_NUMBER]]' : m),
  );
  // 郵便番号
  out = out.replace(new RegExp(`〒\\s*${DIGIT}{3}${HYPHEN}?${DIGIT}{4}|(?<!${DIGIT})${DIGIT}{3}${HYPHEN}${DIGIT}{4}(?!${DIGIT})`, 'g'), '[[MASKED_ADDRESS]]');
  // 住所らしき表記（最善努力）：都道府県＋続く漢字/数字、市区町村＋丁目/番地、丁目番地
  out = out.replace(new RegExp(`${PREFECTURE}${ADDR_TAIL}{0,30}`, 'gu'), '[[MASKED_ADDRESS]]');
  out = out.replace(
    new RegExp(
      `[\\p{Script=Han}]{1,10}[市区町村郡][\\p{Script=Han}ヶ]{0,12}${DIGIT}+(?:丁目|番地?|号|[-－]${DIGIT}+)[0-9０-９番地号\\-－]*`,
      'gu',
    ),
    '[[MASKED_ADDRESS]]',
  );
  out = out.replace(new RegExp(`${DIGIT}+丁目[0-9０-９番地号\\-－]*`, 'gu'), '[[MASKED_ADDRESS]]');
  return out;
}

export function anonymize(text: string, students: StudentIdentity[], extraTerms: MaskTerm[] = []): AnonymizeResult {
  const tokenMap = new Map<string, string>();
  const flags: ReviewFlag[] = [];

  // surface(表記) -> 所有者一覧
  const surfaces = new Map<string, Owner[]>();
  const register = (surface: string, owner: Owner) => {
    if (!surface) return;
    const list = surfaces.get(surface) ?? [];
    if (!list.some((o) => o.key === owner.key)) list.push(owner);
    surfaces.set(surface, list);
  };

  for (const s of students) {
    const child = (familyOnly: boolean): Owner => ({
      key: `c:${s.studentId}`,
      kind: 'child',
      surfaceIsFamilyOnly: familyOnly,
    });
    for (const f of nameForms(s.familyName, s.givenName)) register(f, child(false));
    register(s.familyName, child(true));
    register(s.givenName, child(false));
    for (const a of s.aliases) register(a, child(false));
  }
  // 保護者：児童と同じ表記（同姓）は児童側に任せる。保護者同士の重複は曖昧（複数所有者）になる
  for (const s of students) {
    (s.guardians ?? []).forEach((g, i) => {
      const owner: Owner = { key: `g:${s.studentId}:${i}`, kind: 'guardian', surfaceIsFamilyOnly: false };
      for (const f of nameForms(g.familyName, g.givenName)) register(f, owner);
      register(g.givenName, owner);
      const existing = surfaces.get(g.familyName);
      if (!existing || existing.every((o) => o.kind === 'guardian')) {
        register(g.familyName, { ...owner, surfaceIsFamilyOnly: true });
      }
    });
  }

  const fullForms = new Set<string>();
  for (const s of students) {
    nameForms(s.familyName, s.givenName).forEach((f) => fullForms.add(f));
    for (const g of s.guardians ?? []) nameForms(g.familyName, g.givenName).forEach((f) => fullForms.add(f));
  }

  const usedIds = new Set<string>();
  const newId = () => {
    let id = randomId();
    while (usedIds.has(id)) id = randomId();
    usedIds.add(id);
    return id;
  };

  let named = text;
  if (surfaces.size > 0) {
    const ownerToken = new Map<string, string>();
    const ambiguousToken = new Map<string, string>();
    const ambiguous = (surface: string) => {
      let token = ambiguousToken.get(surface);
      if (!token) {
        token = `[[CHILD_AMBIGUOUS:${newId()}]]`;
        ambiguousToken.set(surface, token);
        tokenMap.set(token, surface);
      }
      return token;
    };

    // 長い名前から先に（部分一致の誤爆防止）。1回の走査で置換するので置換結果は再走査されない
    const pattern = Array.from(surfaces.keys())
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|');
    const re = new RegExp(pattern, 'gu');

    named = text.replace(re, (match: string, offset: number, whole: string) => {
      const end = offset + match.length;

      // 1文字だけの名前（例：名が「友」「和」、姓が「原」）：敬称が続けば伏せる。
      // 前後に漢字・カタカナが続いて別の語になっている（お友達・和室・原因・樹本人）ときは普通の語とみなして残す
      // （1文字では本人を特定できず、伏せると文章が壊れて AI の読み取りを妨げるため）。単独で現れた場合は伏せる
      if (match.length <= 1 && !fullForms.has(match) && !HONORIFICS.some((h) => whole.startsWith(h, end))) {
        const embedded = HAN_OR_KATAKANA.test(whole.charAt(end)) || HAN_OR_KATAKANA.test(whole.charAt(offset - 1));
        if (embedded) return match;
      }

      // 名前が別の語の一部に見える場合（伊藤園 等）：実名を残さないよう伏せ、要確認にする。
      // トークンのまま restore で元の文字列に戻るので、誤爆しても文章は壊れない
      if (!fullForms.has(match)) {
        const compoundAfter = isCompoundContinuation(whole, end);
        const compoundBefore = match.length <= 1 && HAN_OR_KATAKANA.test(whole.charAt(offset - 1));
        if (compoundAfter || compoundBefore) {
          flags.push({ reason: 'possible_compound_word', text: match, index: offset });
          return ambiguous(match);
        }
      }

      const owners = surfaces.get(match)!;
      if (owners.length > 1) {
        const sameFamily = owners.every((o) => o.kind === 'child' && o.surfaceIsFamilyOnly);
        flags.push({ reason: sameFamily ? 'ambiguous_surname' : 'ambiguous_surface', text: match, index: offset });
        return ambiguous(match);
      }

      const owner = owners[0];
      let token = ownerToken.get(owner.key);
      if (!token) {
        const prefix = owner.kind === 'child' ? 'CHILD_ID' : 'GUARDIAN_ID';
        token = `[[${prefix}:${newId()}]]`;
        ownerToken.set(owner.key, token);
        tokenMap.set(token, match); // 最初に出現した表記に復元する
      }
      return token;
    });
  }

  // 名前の置換を先に行うため、flags.index は常に原文上の位置になる
  // 児童以外の名前（園・学校・先生など）。登録された表記 → 形での自動検出 の順。
  // 児童の置換後に行うので児童のトークンは壊れない。同じ表記は同じトークン
  const termToken = new Map<string, string>();
  const tokenFor = (surface: string, kind: 'org' | 'person') => {
    let token = termToken.get(surface);
    if (!token) {
      token = `[[${kind === 'org' ? 'ORG_ID' : 'PERSON_ID'}:${newId()}]]`;
      termToken.set(surface, token);
      tokenMap.set(token, surface);
    }
    return token;
  };
  const terms = extraTerms
    .map((t) => ({ term: t.term.trim(), kind: t.kind }))
    .filter((t) => t.term.length >= 2)
    .sort((a, b) => b.term.length - a.term.length);
  if (terms.length > 0) {
    const kindOf = new Map(terms.map((t) => [t.term, t.kind] as const));
    const re = new RegExp(terms.map((t) => escapeRegExp(t.term)).join('|'), 'gu');
    named = named.replace(re, (m) => tokenFor(m, kindOf.get(m) ?? 'org'));
  }
  named = maskFacilities(named, (m) => tokenFor(m, 'org'));
  named = maskPersonTitles(named, (m) => tokenFor(m, 'person'));

  const anonymizedText = maskSensitive(named, students);
  return { anonymizedText, tokenMap, flags, requiresReview: flags.length > 0 };
}

export function restore(anonymizedText: string, tokenMap: Map<string, string>): string {
  return anonymizedText.replace(TOKEN_RE, (token) => tokenMap.get(token) ?? token);
}

/** LLM出力に、tokenMap に無い（または形式が壊れた）トークンが含まれていないか調べる */
export function findUnknownTokens(text: string, tokenMap: Map<string, string>): string[] {
  return (text.match(LOOSE_TOKEN_RE) ?? []).filter((t) => !tokenMap.has(t));
}
