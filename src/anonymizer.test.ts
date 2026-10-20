import { describe, expect, it } from 'vitest';
import {
  anonymize,
  escapeRegExp,
  findUnknownTokens,
  restore,
  staffNameMaskTerms,
  type StudentIdentity,
} from './anonymizer';

// テスト用の架空名簿
const ito: StudentIdentity = {
  studentId: 's-ito',
  familyName: '伊藤',
  givenName: '樹',
  aliases: ['いっくん'],
  recipientNumber: '1234567890',
  birthDate: '2015-04-03',
  guardians: [{ familyName: '伊藤', givenName: '花子' }],
};
const yamada: StudentIdentity = {
  studentId: 's-yamada',
  familyName: '山田',
  givenName: 'さとし',
  aliases: [],
};
const tanakaTaro: StudentIdentity = {
  studentId: 's-tanaka-taro',
  familyName: '田中',
  givenName: '太郎',
  aliases: ['たろちゃん'],
};
const tanakaJiro: StudentIdentity = {
  studentId: 's-tanaka-jiro',
  familyName: '田中',
  givenName: '次郎',
  aliases: [],
};
const roster = [ito, yamada, tanakaTaro, tanakaJiro];

const tokenOf = (text: string) => text.match(/\[\[(?:CHILD_ID|GUARDIAN_ID|CHILD_AMBIGUOUS):[0-9a-f]{8}\]\]/g) ?? [];

describe('anonymize: 名前の置換', () => {
  it('姓のみをトークン化する', () => {
    const { anonymizedText, tokenMap } = anonymize('伊藤が積み木をした', roster);
    expect(anonymizedText).not.toContain('伊藤');
    expect(anonymizedText).toMatch(/^\[\[CHILD_ID:[0-9a-f]{8}\]\]が積み木をした$/);
    expect(tokenMap.size).toBe(1);
  });

  it('名のみ・愛称をトークン化する', () => {
    const r1 = anonymize('樹が走った', roster);
    expect(r1.anonymizedText).not.toContain('樹');
    const r2 = anonymize('いっくんが笑った', roster);
    expect(r2.anonymizedText).not.toContain('いっくん');
    expect(r2.anonymizedText).toMatch(/^\[\[CHILD_ID:[0-9a-f]{8}\]\]が笑った$/);
  });

  it('敬称付きでも名前部分が消える（敬称は残る）', () => {
    const a = anonymize('伊藤くんは元気だった', roster).anonymizedText;
    expect(a).not.toContain('伊藤');
    expect(a).toMatch(/\]\]くんは元気だった$/);
    const b = anonymize('さとしちゃんと遊んだ', roster).anonymizedText;
    expect(b).not.toContain('さとし');
    expect(b).toMatch(/^\[\[CHILD_ID:[0-9a-f]{8}\]\]ちゃんと遊んだ$/);
    const c = anonymize('山田君が来た', roster).anonymizedText;
    expect(c).not.toContain('山田');
  });

  it('フルネーム（空白なし・半角空白・全角空白）をトークン化する', () => {
    for (const name of ['山田さとし', '山田 さとし', '山田　さとし']) {
      const { anonymizedText } = anonymize(`${name}が発表した`, roster);
      expect(anonymizedText).not.toContain('山田');
      expect(anonymizedText).not.toContain('さとし');
    }
  });

  it('同一リクエスト内で同一児童は同一トークン、別児童は別トークン', () => {
    const { anonymizedText } = anonymize('伊藤が来た。山田も来た。伊藤は座った。', roster);
    const tokens = tokenOf(anonymizedText);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toBe(tokens[2]);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('同一児童の別表記（姓・愛称）も同一トークンになる', () => {
    const { anonymizedText } = anonymize('伊藤が来た。いっくんは座った。', roster);
    const tokens = tokenOf(anonymizedText);
    expect(tokens[0]).toBe(tokens[1]);
  });

  it('リクエストごとにトークンが変わる（長期的な紐付け防止）', () => {
    const a = anonymize('伊藤が来た', roster).anonymizedText;
    const b = anonymize('伊藤が来た', roster).anonymizedText;
    expect(a).not.toBe(b);
  });

  it('保護者名は GUARDIAN_ID になる', () => {
    const { anonymizedText } = anonymize('保護者の伊藤 花子さんと面談した', roster);
    expect(anonymizedText).not.toContain('花子');
    expect(anonymizedText).toMatch(/\[\[GUARDIAN_ID:[0-9a-f]{8}\]\]/);
  });
});

describe('anonymize: 誤爆防止・要確認フラグ', () => {
  it('同姓の児童が2人いる場合、姓のみは特定せず要確認フラグを返す', () => {
    const { anonymizedText, tokenMap, flags } = anonymize('田中が泣いた', roster);
    expect(anonymizedText).not.toContain('田中');
    expect(anonymizedText).toMatch(/\[\[CHILD_AMBIGUOUS:[0-9a-f]{8}\]\]/);
    expect(flags.map((f) => f.reason)).toEqual(['ambiguous_surname']);
    // どちらの児童のトークンにもなっていない
    expect(anonymizedText).not.toMatch(/CHILD_ID/);
    expect(restore(anonymizedText, tokenMap)).toBe('田中が泣いた');
  });

  it('同姓でもフルネーム・愛称なら個別に特定できる', () => {
    const { anonymizedText, flags } = anonymize('田中太郎と田中次郎とたろちゃん', roster);
    const tokens = tokenOf(anonymizedText);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toBe(tokens[2]);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(flags).toHaveLength(0);
  });

  it('複数人で共有される愛称は要確認（ambiguous_surface）', () => {
    const a: StudentIdentity = { studentId: 'a', familyName: '青木', givenName: '大', aliases: ['ゆうちゃん'] };
    const b: StudentIdentity = { studentId: 'b', familyName: '森', givenName: '悠', aliases: ['ゆうちゃん'] };
    const { flags, anonymizedText } = anonymize('ゆうちゃんが笑った', [a, b]);
    expect(anonymizedText).not.toContain('ゆうちゃん');
    expect(flags.map((f) => f.reason)).toEqual(['ambiguous_surface']);
  });

  it('「伊藤園」のような複合語は伏せた上で要確認にし、restoreで元に戻る', () => {
    const { anonymizedText, tokenMap, flags } = anonymize('伊藤園のお茶を飲んだ', roster);
    expect(anonymizedText).not.toContain('伊藤');
    expect(anonymizedText).toMatch(/^\[\[CHILD_AMBIGUOUS:[0-9a-f]{8}\]\]園のお茶を飲んだ$/);
    expect(flags.map((f) => f.reason)).toEqual(['possible_compound_word']);
    expect(restore(anonymizedText, tokenMap)).toBe('伊藤園のお茶を飲んだ');
  });

  it('「伊藤保護者」のように2文字以上の名前に漢字が続いても実名は残らない。1文字の名前は語の一部（樹木・樹本人）なら残す', () => {
    const { anonymizedText, requiresReview } = anonymize('伊藤保護者と樹本人が来た。樹木を見た', roster);
    expect(anonymizedText).not.toContain('伊藤');
    expect(anonymizedText).toContain('樹本人');
    expect(anonymizedText).toContain('樹木');
    expect(requiresReview).toBe(true);
  });

  it('複合語と本人の言及が混在しても、本人は CHILD_ID になる', () => {
    const { anonymizedText } = anonymize('伊藤くんが伊藤園のお茶を飲んだ', roster);
    expect(anonymizedText).not.toContain('伊藤');
    expect(anonymizedText).toMatch(/^\[\[CHILD_ID:[0-9a-f]{8}\]\]くんが\[\[CHILD_AMBIGUOUS:/);
  });

  it('1文字の名前は敬称が続くときだけ伏せ、普通の語（お友達・原因）は残す', () => {
    const tomo: StudentIdentity = { studentId: 't', familyName: '斉藤', givenName: '友', aliases: [] };
    const hara: StudentIdentity = { studentId: 'h', familyName: '原', givenName: '虎太朗', aliases: [] };
    const r = anonymize('お友達と遊んだ。原因は不明。友くんと原さんが来た。斉藤友は休み', [tomo, hara]);
    expect(r.anonymizedText).toMatch(/^お友達と遊んだ。原因は不明。\[\[CHILD_ID:[0-9a-f]{8}\]\]くんと\[\[CHILD_ID:[0-9a-f]{8}\]\]さんが来た。\[\[CHILD_ID:[0-9a-f]{8}\]\]は休み$/);
    expect(r.flags).toEqual([]);
  });

  it('1文字の保護者名も伏せる', () => {
    const s: StudentIdentity = {
      studentId: 'k', familyName: '伊藤', givenName: '樹', aliases: [],
      guardians: [{ familyName: '伊藤', givenName: '恵' }],
    };
    const { anonymizedText } = anonymize('母の恵さんと面談した', [s]);
    expect(anonymizedText).not.toContain('恵');
    expect(anonymizedText).toMatch(/GUARDIAN_ID/);
  });

  it('同姓の保護者が2人いる場合、姓のみは曖昧として伏せる', () => {
    const s: StudentIdentity = {
      studentId: 'k', familyName: '青木', givenName: '大', aliases: [],
      guardians: [
        { familyName: '佐藤', givenName: '花子' },
        { familyName: '佐藤', givenName: '明子' },
      ],
    };
    const { anonymizedText, flags } = anonymize('佐藤さんが迎えに来た', [s]);
    expect(anonymizedText).not.toContain('佐藤');
    expect(anonymizedText).toMatch(/CHILD_AMBIGUOUS/);
    expect(flags.map((f) => f.reason)).toEqual(['ambiguous_surface']);
  });

  it('flags.index は数字マスク等の影響を受けず原文上の位置を指す', () => {
    const original = '1234567890 伊藤園';
    const { flags } = anonymize(original, roster);
    expect(flags).toHaveLength(1);
    expect(original.slice(flags[0].index, flags[0].index + 2)).toBe('伊藤');
  });

  it('正規表現のメタ文字を含む愛称でも例外にならず置換される', () => {
    const s: StudentIdentity = { studentId: 'x', familyName: '佐藤', givenName: '匠', aliases: ['たく(仮)', 'a.b'] };
    const r = anonymize('たく(仮)がa.bと言った。axbは対象外', [s]);
    expect(r.anonymizedText).not.toContain('たく(仮)');
    expect(r.anonymizedText).toContain('axb');
    expect(escapeRegExp('a.b(c)')).toBe('a\\.b\\(c\\)');
  });

  it('名簿が空でも壊れない', () => {
    expect(anonymize('こんにちは', []).anonymizedText).toBe('こんにちは');
  });
});

describe('anonymize: 番号・日付のマスク', () => {
  it('受給者番号（10桁）をマスクする', () => {
    const { anonymizedText } = anonymize('受給者番号は1234567890です', roster);
    expect(anonymizedText).not.toContain('1234567890');
    expect(anonymizedText).toContain('[[MASKED_NUMBER]]');
  });

  it('名簿にない10桁以上の数字列・ハイフン区切り電話番号もマスクする', () => {
    const { anonymizedText } = anonymize('連絡先 090-1234-5678 / 03-1234-5678 / 0912345678901', []);
    expect(anonymizedText).not.toMatch(/\d{4}/);
    expect(anonymizedText.match(/\[\[MASKED_NUMBER\]\]/g)).toHaveLength(3);
  });

  it('全角数字の受給者番号もマスクする', () => {
    const { anonymizedText } = anonymize('番号１２３４５６７８９０', []);
    expect(anonymizedText).toBe('番号[[MASKED_NUMBER]]');
  });

  it('括弧・空白区切りの電話番号もマスクする', () => {
    for (const t of ['03(1234)5678', '090 1234 5678', '０９０－１２３４－５６７８']) {
      const { anonymizedText } = anonymize(`電話は${t}です`, []);
      expect(anonymizedText).toBe('電話は[[MASKED_NUMBER]]です');
    }
  });

  it('住所・郵便番号らしき表記をマスクする', () => {
    const cases = ['東京都世田谷区上馬1-2-3', '神奈川県横浜市港北区新横浜二丁目', '〒154-0011', '横浜市港北区綱島東3-4-5', '3丁目5番地'];
    for (const a of cases) {
      const { anonymizedText } = anonymize(`住所は${a}です`, []);
      expect(anonymizedText, a).toContain('[[MASKED_ADDRESS]]');
      expect(anonymizedText, a).not.toMatch(/世田谷|横浜|港北|154|丁目|番地/);
    }
  });

  it('住所と無関係な普通の文は壊さない', () => {
    const t = '東京での活動は楽しかった。3時に帰宅し、5回跳んだ。';
    expect(anonymize(t, []).anonymizedText).toBe(t);
  });

  it('日付や短い数字は壊さない', () => {
    const t = '2026-09-25に30分、3回実施。訪問は10時';
    expect(anonymize(t, []).anonymizedText).toBe(t);
  });

  it('生年月日（登録済みの児童）をマスクする', () => {
    for (const d of ['2015年4月3日', '2015/04/03', '2015-04-03', '２０１５年４月３日']) {
      const { anonymizedText } = anonymize(`生年月日は${d}`, roster);
      expect(anonymizedText).toBe('生年月日は[[MASKED_DATE]]');
    }
  });
});

describe('restore', () => {
  it('往復すると元の文章に戻る', () => {
    const original =
      '伊藤くんは積み木をした。山田さとしと遊んだ。保護者の伊藤 花子さんと面談。受給者番号は対象外の文。';
    const { anonymizedText, tokenMap } = anonymize(original, roster);
    expect(anonymizedText).not.toBe(original);
    expect(restore(anonymizedText, tokenMap)).toBe(original);
  });

  it('同姓（要確認）の文も往復で戻る', () => {
    const original = '田中が泣いたが、田中太郎は笑った。';
    const { anonymizedText, tokenMap } = anonymize(original, roster);
    expect(restore(anonymizedText, tokenMap)).toBe(original);
  });

  it('表記ゆれは「最初に出現した表記」に統一して復元される（仕様）', () => {
    const { anonymizedText, tokenMap } = anonymize('伊藤が来た。いっくんは座った。', roster);
    expect(restore(anonymizedText, tokenMap)).toBe('伊藤が来た。伊藤は座った。');
  });

  it('LLMが文中でトークンを使い回しても復元される', () => {
    const { anonymizedText, tokenMap } = anonymize('伊藤が来た', roster);
    const [token] = tokenOf(anonymizedText);
    expect(restore(`${token}は落ち着いて過ごしました。${token}は…`, tokenMap)).toBe(
      '伊藤は落ち着いて過ごしました。伊藤は…',
    );
  });

  it('tokenMap に無いトークンは復元せず検出できる', () => {
    const { tokenMap } = anonymize('伊藤が来た', roster);
    const fake = '[[CHILD_ID:deadbeef]]が来た';
    expect(restore(fake, tokenMap)).toBe(fake);
    expect(findUnknownTokens(fake, tokenMap)).toEqual(['[[CHILD_ID:deadbeef]]']);
  });

  it('形式が壊れたトークンも検出する', () => {
    const { tokenMap } = anonymize('伊藤が来た', roster);
    expect(findUnknownTokens('[[CHILD_ID:broken]]が来た', tokenMap)).toEqual(['[[CHILD_ID:broken]]']);
    expect(findUnknownTokens('[[CHILD_ID:abc', tokenMap)).toHaveLength(1);
  });

  it('正しいトークンは未知扱いにならない', () => {
    const { anonymizedText, tokenMap } = anonymize('伊藤が来た', roster);
    expect(findUnknownTokens(anonymizedText, tokenMap)).toEqual([]);
  });
});

describe('置換漏れゼロの検証（名簿全件）', () => {
  const surfaces = new Set<string>();
  for (const s of roster) {
    surfaces.add(s.familyName);
    surfaces.add(s.givenName);
    surfaces.add(`${s.familyName}${s.givenName}`);
    surfaces.add(`${s.familyName} ${s.givenName}`);
    surfaces.add(`${s.familyName}　${s.givenName}`);
    s.aliases.forEach((a) => surfaces.add(a));
    (s.guardians ?? []).forEach((g) => {
      surfaces.add(`${g.familyName}${g.givenName}`);
      surfaces.add(g.givenName);
    });
  }
  const numbers = ['1234567890', '090-1234-5678'];

  it('あらゆる名前表記×敬称×位置で、出力に元の表記が残らない', () => {
    const honorifics = ['', 'くん', 'ちゃん', 'さん', '君'];
    const leaks: string[] = [];
    for (const surface of surfaces) {
      for (const h of honorifics) {
        for (const wrap of [(x: string) => `${x}が来た。`, (x: string) => `今日は${x}と遊んだ`, (x: string) => `「${x}」`]) {
          const text = wrap(`${surface}${h}`);
          const { anonymizedText } = anonymize(text, roster);
          if (anonymizedText.includes(surface)) leaks.push(`${text} -> ${anonymizedText}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('全員・全表記・番号を1つの長文に入れても、出力に1件も残らない', () => {
    const text = [...surfaces].map((s) => `${s}が参加した`).join('。') + '。' + numbers.join(' ');
    const { anonymizedText } = anonymize(text, roster);
    const remaining = [...surfaces, ...numbers].filter((s) => anonymizedText.includes(s));
    expect(remaining).toEqual([]);
  });
});

describe('園・学校・先生など（児童以外の名前）', () => {
  const kids: StudentIdentity[] = [{ studentId: 's1', familyName: '伊藤', givenName: '樹', aliases: ['いっくん'] }];

  it('登録した園名・先生名は、ひらがなでも記号になり、往復で戻る', () => {
    const text = 'ひまわり保育園を訪問し、みき先生と伊藤くんの様子を共有した。';
    const { anonymizedText, tokenMap } = anonymize(text, kids, [
      { term: 'ひまわり保育園', kind: 'org' },
      { term: 'みき', kind: 'person' },
    ]);
    expect(anonymizedText).not.toMatch(/ひまわり|みき|伊藤/);
    expect(anonymizedText).toMatch(/\[\[ORG_ID:[0-9a-f]{8}\]\]を訪問し、\[\[PERSON_ID:[0-9a-f]{8}\]\]先生と\[\[CHILD_ID:/);
    expect(restore(anonymizedText, tokenMap)).toBe(text);
  });

  it('登録がなくても「漢字・カタカナ＋保育園/小学校」「漢字＋先生」は自動で伏せる', () => {
    const text = '青空幼稚園の山本先生から連絡。来年は桜ヶ丘小学校へ進学予定。サクラ保育園にも見学。';
    const { anonymizedText, tokenMap } = anonymize(text, kids);
    expect(anonymizedText).not.toMatch(/青空|山本|桜ヶ丘|サクラ/);
    expect(anonymizedText).toContain('先生から連絡');
    expect(restore(anonymizedText, tokenMap)).toBe(text);
  });

  it('同じ名前は同じ記号、別の名前は別の記号', () => {
    const { anonymizedText } = anonymize('山本先生と田村先生。山本先生が説明。', []);
    const t = anonymizedText.match(/\[\[PERSON_ID:[0-9a-f]{8}\]\]/g)!;
    expect(t).toHaveLength(3);
    expect(t[0]).toBe(t[2]);
    expect(t[0]).not.toBe(t[1]);
  });

  it('「担任の先生」「近くの保育園」のような普通の言い方は壊さない', () => {
    const text = '担任の先生と話した。近くの保育園に通っている。';
    expect(anonymize(text, []).anonymizedText).toBe(text);
  });

  it('児童の名前と先生の名前が同じ字でも、実名は残らない（児童側の記号が優先）', () => {
    const { anonymizedText, flags } = anonymize('伊藤くんと伊藤先生', kids);
    expect(anonymizedText).not.toContain('伊藤');
    expect(anonymizedText).toMatch(/^\[\[CHILD_ID:[0-9a-f]{8}\]\]くんと\[\[CHILD_(?:ID|AMBIGUOUS):/);
    expect(flags.length).toBeGreaterThan(0);
  });

  it('新しい記号も壊れたら検出できる', () => {
    expect(findUnknownTokens('[[ORG_ID:broken]]', new Map())).toHaveLength(1);
  });
});

describe('施設名（訪問先・通園・通学・通院先）を自動で伏せる', () => {
  const cases: [string, string[]][] = [
    ['本日ひまわり保育園を訪問した。', ['ひまわり']],
    ['さくらんぼこども園の担任と面談。', ['さくらんぼ']],
    ['わかば園での様子を確認した。', ['わかば']],
    ['あおぞら幼稚園に通っている。', ['あおぞら']],
    ['市立桜ヶ丘小学校の特別支援学級へ。', ['桜ヶ丘']],
    ['みどり台中学校', ['みどり台']],
    ['〇〇市こども発達支援センターで評価を受けた。', ['こども発達']],
    ['たなかこどもクリニックに通院中。', ['たなか']],
    ['山田小児科を受診。', ['山田']],
    ['ABCスクールに週1回通っている。', ['ABC']],
    ['すまいる教室（療育）にも通所。', ['すまいる']],
  ];
  for (const [text, secrets] of cases) {
    it(`「${text}」から施設名が消え、往復で戻る`, () => {
      const { anonymizedText, tokenMap } = anonymize(text, []);
      for (const sec of secrets) expect(anonymizedText, anonymizedText).not.toContain(sec);
      expect(anonymizedText).toMatch(/\[\[ORG_ID:[0-9a-f]{8}\]\]/);
      expect(restore(anonymizedText, tokenMap)).toBe(text);
    });
  }

  it('名前の付かない一般的な言い方は壊さない', () => {
    const t = '近くの保育園や公園で遊んだ。園庭で走り、動物園の話をした。病院の待合室で待つ練習。担任の先生と話した。';
    expect(anonymize(t, []).anonymizedText).toBe(t);
  });

  it('児童の記号は壊さない', () => {
    const kids: StudentIdentity[] = [{ studentId: 's1', familyName: '伊藤', givenName: '樹', aliases: ['いっくん'] }];
    const { anonymizedText } = anonymize('いっくんはひまわり保育園に通う。', kids);
    expect(anonymizedText).toMatch(/^\[\[CHILD_ID:[0-9a-f]{8}\]\]は\[\[ORG_ID:[0-9a-f]{8}\]\]に通う。$/);
  });
});

describe('anonymize: メールアドレスと職員の肩書き（Codex レビュー対応）', () => {
  it('メールアドレスは記号に置き換わる', () => {
    const r = anonymize('連絡先は parent.01@example.co.jp です。', []);
    expect(r.anonymizedText).toBe('連絡先は [[MASKED_EMAIL]] です。');
  });
  it('「〇〇支援員」「〇〇スタッフ」の名前部分は人物の記号になる', () => {
    const r = anonymize('山田支援員が対応し、佐藤スタッフと鈴木児発管に報告した。', []);
    expect(r.anonymizedText).not.toContain('山田');
    expect(r.anonymizedText).not.toContain('佐藤');
    expect(r.anonymizedText).not.toContain('鈴木');
    expect(r.anonymizedText).toContain('支援員');
  });
});

describe('anonymize: 肩書きの前の一般語と職員名（Codex 再レビュー対応）', () => {
  it('「担当支援員」「常勤職員」「ベテラン職員」の一般語は伏せない', () => {
    const text = '担当支援員が付き添い、常勤職員と女性職員、ベテラン職員が見守った。本日支援員は2名。';
    const r = anonymize(text, []);
    expect(r.anonymizedText).toBe(text);
  });
  it('「山本先生」「秋元支援員」「松本正先生」のように、末尾が一般語と同じ字の名前も丸ごと伏せる（セキュリティ監査対応）', () => {
    const r = anonymize('山本先生と秋元支援員、松本正先生に連絡した。', []);
    expect(r.anonymizedText).toMatch(/^\[\[PERSON_ID:[0-9a-f]{8}\]\]先生と\[\[PERSON_ID:[0-9a-f]{8}\]\]支援員、\[\[PERSON_ID:[0-9a-f]{8}\]\]先生に連絡した。$/);
    expect(restore(r.anonymizedText, r.tokenMap)).toBe('山本先生と秋元支援員、松本正先生に連絡した。');
  });
  it('「新職員」「他職員」「当園職員」「本日支援員」の一般語は伏せない', () => {
    const text = '新職員と他職員が当園職員に挨拶した。本日支援員は休み。';
    expect(anonymize(text, []).anonymizedText).toBe(text);
  });
  it('「佐藤担当支援員」は名前だけ伏せて、一般語は残す', () => {
    const r = anonymize('佐藤担当支援員が対応した。', []);
    expect(r.anonymizedText).not.toContain('佐藤');
    expect(r.anonymizedText).toMatch(/\[\[PERSON_ID:[0-9a-f]{8}\]\]担当支援員が対応した。/);
  });
  it('職員名は姓とフルネームを伏せ、下の名前は敬称・肩書きが続くときだけ伏せる', () => {
    const terms = staffNameMaskTerms(['山田 希望', '佐藤']);
    const surfaces = terms.map((t) => t.term);
    expect(surfaces).toContain('山田希望');
    expect(surfaces).toContain('山田');
    expect(surfaces).toContain('希望さん');
    expect(surfaces).toContain('希望先生');
    expect(surfaces).toContain('佐藤');
    expect(surfaces).not.toContain('希望');
    const r = anonymize('本人が希望する活動に、山田が付き添い、希望さんも同席した。', [], terms);
    expect(r.anonymizedText).toContain('本人が希望する活動');
    expect(r.anonymizedText).not.toContain('山田');
    expect(r.anonymizedText).not.toContain('希望さん');
  });
});
