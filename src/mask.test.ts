import { describe, expect, it } from 'vitest';
import {
  birthDates,
  checkTerm,
  termNotice,
  emptyRoster,
  maskText,
  placeNames,
  registeredSurfaces,
  restoreText,
  sanitizeRoster,
  splitTokens,
  tokenKind,
  unknownTokens,
  type Roster,
} from './mask';

// テスト用の架空の登録
const roster: Roster = {
  entries: [
    { id: 'p1', kind: 'person', name: '山田 太郎', aliases: ['たろちゃん'] },
    { id: 'p2', kind: 'person', name: '佐藤 健', aliases: [] },
    { id: 'o1', kind: 'org', term: 'ひまわり会' },
    { id: 'l1', kind: 'place', term: 'みどり台' },
    { id: 'w1', kind: 'word', term: 'プロジェクトX' },
  ],
};

const kinds = (text: string) => splitTokens(text).filter((p) => p.token).map((p) => tokenKind(p.text));

describe('maskText（登録したもの）', () => {
  it('人・あだ名・施設・地域・その他の言葉をかくし、元に戻せる', () => {
    const text = '山田太郎さん（たろちゃん）は佐藤 健さんと、ひまわり会のプロジェクトXでみどり台に行った。';
    const res = maskText(text, roster, { guessNames: false });
    for (const w of ['山田', '太郎', 'たろちゃん', '佐藤', '健', 'ひまわり会', 'プロジェクトX', 'みどり台']) {
      expect(res.anonymizedText).not.toContain(w);
    }
    // 同じ人は1つの印にまとめるので、あだ名は最初に出た呼び方で戻る
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe(text.replace('たろちゃん', '山田太郎'));
  });

  it('子ども向けの印（CHILD_ID など）は使わない', () => {
    const res = maskText('山田太郎と佐藤健', roster, { guessNames: false });
    expect(res.anonymizedText).not.toMatch(/CHILD|GUARDIAN/);
    expect(kinds(res.anonymizedText)).toEqual(['person', 'person']);
  });
});

describe('レビューで見つかったかくし忘れ', () => {
  it('3語以上の名前も丸ごとかくす', () => {
    const r: Roster = { entries: [{ id: 'j', kind: 'person', name: 'John Paul Smith', aliases: [] }] };
    const res = maskText('John Paul Smithさん、Paulさん、JohnPaulSmith', r, { guessNames: false });
    for (const w of ['John', 'Paul', 'Smith']) expect(res.anonymizedText).not.toContain(w);
  });

  it('ひらがなの「〇〇さん」「〇〇ちゃん」もかくす。家族の呼び方などは残す', () => {
    const text = 'みきさんに連絡。友だちのさくらちゃんと、のぞみさん。おかあさんとおばあちゃん、みなさん、おつかれさまでした';
    const res = maskText(text, emptyRoster(), { guessNames: true });
    for (const w of ['みき', 'さくら', 'のぞみ']) expect(res.anonymizedText).not.toContain(w);
    for (const w of ['友だちの', 'おかあさん', 'おばあちゃん', 'みなさん', 'おつかれさま']) expect(res.anonymizedText).toContain(w);
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe(text);
  });

  it('見出しのあとの名前の最後の文字（「いろは」の「は」）を残さない', () => {
    const res = maskText('氏名：いろは\n氏名：はるとくんは元気', emptyRoster(), { guessNames: true });
    expect(res.anonymizedText).not.toMatch(/いろ|はると/);
    expect(res.anonymizedText).toMatch(/氏名：\[\[PERSON_ID:[0-9a-f]{8}\]\]\n/);
    expect(res.anonymizedText).toContain('くんは元気');
  });

  it('メールや申込書の見出し語のあとの名前もかくす。「担当者に連絡」のような文はかくさない', () => {
    const text = '宛名：高橋 一郎\n差出人: さとう\nお客様名　ミラー\n担当者に連絡して、名前を書く。';
    const res = maskText(text, emptyRoster(), { guessNames: true });
    for (const w of ['高橋', '一郎', 'さとう', 'ミラー']) expect(res.anonymizedText).not.toContain(w);
    expect(res.anonymizedText).toContain('担当者に連絡して、名前を書く。');
  });

  it('ひらがな・カタカナの地名もかくす', () => {
    const text = '私はつくば市在住です。ニセコ町に行き、さいたま出身の人に会った。';
    const res = maskText(text, emptyRoster(), { guessNames: false });
    for (const w of ['つくば', 'ニセコ', 'さいたま']) expect(res.anonymizedText).not.toContain(w);
    expect(res.anonymizedText).toContain('私は');
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe(text);
  });

  it('あだ名が先に出ても、文章にある正式な名前で戻す', () => {
    const res = maskText('たろちゃんこと山田太郎です', roster, { guessNames: false });
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe('山田太郎こと山田太郎です');
  });
});

describe('登録しなくてもかくすもの', () => {
  it('生年月日（見出し・「生まれ」の形）。ふつうの日付は残す', () => {
    const text = '生年月日：平成27年4月3日\n1990/12/1生まれ\n2026年10月20日に面談、4月3日生活が変わった';
    expect(birthDates(text)).toEqual(['平成27年4月3日', '1990/12/1']);
    const res = maskText(text, emptyRoster(), { guessNames: false });
    expect(res.anonymizedText).not.toMatch(/平成27年4月3日|1990\/12\/1/);
    expect(res.anonymizedText).toContain('2026年10月20日に面談');
    expect(kinds(res.anonymizedText)).toEqual(['birth', 'birth']);
  });

  it('住んでいる地域・住所', () => {
    const text = '住所：神奈川県横浜市港北区みどり1-2-3\n横浜市在住で、大阪出身。最寄りは新横浜駅。港区にも行く。';
    const res = maskText(text, emptyRoster(), { guessNames: false });
    for (const w of ['神奈川', '横浜', '港北', '大阪', '新横浜', '港区']) expect(res.anonymizedText).not.toContain(w);
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe(text);
  });

  it('住所の行にある電話は、住所に含めず電話としてかくす', () => {
    expect(placeNames('住所：横浜市港北区みどり1-2-3　電話 090-1234-5678')).toContain('横浜市港北区みどり1-2-3');
    const res = maskText('住所：横浜市港北区みどり1-2-3　電話 090-1234-5678', emptyRoster(), { guessNames: false });
    expect(res.anonymizedText).toMatch(/電話 \[\[NUMBER_ID:[0-9a-f]{8}\]\]$/);
  });

  it('地域ではない「〇〇市」「〇〇区」などはかくさない', () => {
    expect(placeNames('都市の地区で選挙区と学区、市場と区別、町内会、全国の都道府県、市区町村、最寄駅')).toEqual([]);
  });

  it('電話・メール・郵便番号', () => {
    const res = maskText('電話090-1234-5678 a@example.com 〒123-4567', emptyRoster(), { guessNames: false });
    expect(res.anonymizedText).not.toMatch(/090|example|123-4567/);
  });

  it('電話・メール・郵便番号・長い番号も、元に戻せる', () => {
    const text = '電話090-1234-5678、03(1234)5678、a@example.com、〒123-4567、番号1234567890';
    const res = maskText(text, emptyRoster(), { guessNames: false });
    expect(res.anonymizedText).not.toMatch(/MASKED|090|03\(|example|123-4567|1234567890/);
    expect(kinds(res.anonymizedText)).toEqual(['number', 'number', 'email', 'address', 'number']);
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe(text);
  });

  it('会社・法人の名前', () => {
    const text = '株式会社みどりの鈴木さま、（株）さくら、トヨタ自動車株式会社、医療法人社団あおぞら会と、会社に行った。';
    const res = maskText(text, emptyRoster(), { guessNames: false });
    for (const w of ['みどり', 'さくら', 'トヨタ', 'あおぞら']) expect(res.anonymizedText).not.toContain(w);
    expect(res.anonymizedText).toContain('の鈴木さま');
    expect(res.anonymizedText).toContain('会社に行った');
    expect(restoreText(res.anonymizedText, res.tokenMap)).toBe(text);
  });

  it('登録していない「〇〇さん」「氏名：〇〇」は、guessNames のときだけかくす', () => {
    const text = '氏名：やまだ はるとくんは元気\n担当の鈴木さんとお母さんが話した。皆さんありがとう。';
    expect(maskText(text, emptyRoster(), { guessNames: false }).anonymizedText).toContain('鈴木');
    const on = maskText(text, emptyRoster(), { guessNames: true });
    for (const w of ['鈴木', 'やまだ', 'はると']) expect(on.anonymizedText).not.toContain(w);
    for (const w of ['くんは元気', 'お母さん', '皆さん']) expect(on.anonymizedText).toContain(w);
    expect(restoreText(on.anonymizedText, on.tokenMap)).toBe(text);
  });
});

describe('restore', () => {
  it('対応表にない印・崩れた印を知らせる（番号の印は知らせない）', () => {
    const map = new Map([['[[PERSON_ID:0a1b2c3d]]', '山田']]);
    expect(unknownTokens('[[PERSON_ID:0a1b2c3d]] [[PERSON_ID:ffffffff]] [[PLACE_ID:12 [[MASKED_NUMBER]]', map)).toEqual([
      '[[PERSON_ID:ffffffff]]',
      '[[PLACE_ID:12',
    ]);
  });

  it('知らない MASKED_* や、括弧が1つ欠けた印・全角の括弧も知らせる', () => {
    const map = new Map([['[[PERSON_ID:0a1b2c3d]]', '山田']]);
    expect(unknownTokens('[[MASKED_SECRET]] [PERSON_ID:11111111] ［［PLACE_ID:22222222］］ [[MASKED_EMAIL]]', map)).toEqual([
      '[[MASKED_SECRET]]',
      '[PERSON_ID:11111111]',
      '［［PLACE_ID:22222222］］',
    ]);
  });
});

describe('checkTerm（登録のチェック）', () => {
  const none = new Set<string>();
  it.each([
    ['', 'org', '空'],
    ['あ', 'person', '2文字以上'],
    ['あ', 'word', '2文字以上'],
    ['()', 'word', '文字か数字'],
    ['&.', 'org', '文字か数字'],
    ['12 34', 'person', '名前には文字'],
    ['1234567', 'word', '数字だけ'],
    ['[[PERSON_ID]]', 'word', '「[」'],
    ['<script>', 'word', '記号'],
    ['あい', 'org', 'ひらがな2文字'],
    ['今日', 'word', 'ふつうの言葉'],
    ['母', 'person', 'ふつうの言葉'],
    ['ぁ', 'person', '2文字以上'],
    ['先生', 'person', 'ふつうの言葉'],
    ['あ'.repeat(31), 'word', '長すぎ'],
  ] as const)('「%s」（%s）は登録できない', (term, kind, reason) => {
    expect(checkTerm(term, kind, none)).toContain(reason);
  });

  it('人の名前なら、漢字・カタカナ1文字も登録できる（注意つき）', () => {
    expect(checkTerm('林', 'person', none)).toBeNull();
    expect(checkTerm('李', 'person', none)).toBeNull();
    expect(termNotice('林')).toContain('敬称');
    expect(checkTerm('林', 'org', none)).toContain('2文字以上');
    const res = maskText('林さんは林業の話をした。担当：林', { entries: [{ id: 'h', kind: 'person', name: '林', aliases: [] }] }, { guessNames: false });
    expect(res.anonymizedText).toMatch(/^\[\[PERSON_ID:[0-9a-f]{8}\]\]さんは林業の話をした。担当：\[\[PERSON_ID/);
  });

  it('ふつうの名前・施設名は登録できる', () => {
    expect(checkTerm('山田 太郎', 'person', none)).toBeNull();
    expect(checkTerm('みき', 'person', none)).toBeNull();
    expect(checkTerm('ABC株式会社（本社）', 'org', none)).toBeNull();
    expect(checkTerm('みどり台', 'place', none)).toBeNull();
  });

  it('同じものは2回登録できない（空白の違いも同じとみなす）', () => {
    expect(checkTerm('山田　太郎', 'person', registeredSurfaces(roster))).toContain('すでに');
  });

  it('読み込んだファイルは、チェックを通ったものだけ残す', () => {
    const { roster: r, rejected } = sanitizeRoster({
      entries: [
        { kind: 'person', name: '高橋  一郎', aliases: ['いっちゃん', 'x'] },
        { kind: 'org', term: '今日' },
        { kind: 'place', term: 'みどり台' },
        { kind: 'evil', term: 'abc' },
        'junk',
      ],
    });
    expect(r.entries.map((e) => (e.kind === 'person' ? `${e.name}/${e.aliases.join(',')}` : e.term))).toEqual(['高橋 一郎/いっちゃん', 'みどり台']);
    expect(rejected).toBe(4);
  });
});
