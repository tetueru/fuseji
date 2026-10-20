/**
 * 広告（PR）のリンク。もしもアフィリエイト・Amazon アソシエイトなどで作ったリンクをここに足す。
 *
 * 決まり（「入れた文章を外に送らない」約束を守るため）：
 * - 広告会社のスクリプトや画像タグ（<script>・<img src="https://…">）は貼らない。ただのリンク（url）だけにする。
 *   画像を出すなら、画像を public/ に保存して image に 'ads/xxx.png' のように書く
 * - 押したときだけお店のページに移る。押さなければどこにも通信しない
 * - 一覧が空なら、広告の枠ごと表示しない
 */
export type Ad = {
  /** 商品名・サービス名 */
  title: string;
  /** ひとこと説明（なくてもよい） */
  note?: string;
  /** アフィリエイトのリンク（https:// で始まるもの） */
  url: string;
  /** public/ に置いた画像（なくてもよい） */
  image?: string;
};

/** 楽天アフィリエイトのテキストリンク（商品リンク作成ページの href と同じ形） */
const RAKUTEN_ID = '58a5c3c1.0ace62ef.58a5c3c2.3720c868';
const rakuten = (itemUrl: string) => `https://hb.afl.rakuten.co.jp/ichiba/${RAKUTEN_ID}/?pc=${encodeURIComponent(itemUrl)}&link_type=text`;

export const ADS: Ad[] = [
  {
    title: 'のぞき見防止フィルター',
    note: 'ノートパソコンの画面を横から見えにくくする（楽天市場）',
    url: rakuten('https://item.rakuten.co.jp/casemania55/free-private-two/'),
  },
  {
    title: '家庭用シュレッダー',
    note: '名前や住所の入った紙を細かく切る（楽天市場）',
    url: rakuten('https://item.rakuten.co.jp/sanwadirect/400-psd030/'),
  },
  {
    title: '本『生成AI最速仕事術』',
    note: 'AI を仕事に使うコツ（楽天ブックス）',
    url: rakuten('https://item.rakuten.co.jp/book/18239273/'),
  },
];

/** 応援（投げ銭）のページ（OFUSE など）。空なら「応援する」は表示しない */
export const SUPPORT_URL = '';

/** https のリンクだけを使う */
export function safeUrl(url: string): string | null {
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** 安全なリンクだけにする（https 以外や、変な書き方は表示しない） */
export function safeAds(ads: Ad[]): Ad[] {
  return ads.filter((ad) => {
    try {
      const u = new URL(ad.url);
      const imageOk = !ad.image || /^[\w\-/.]+\.(png|jpe?g|webp|svg)$/i.test(ad.image) && !ad.image.includes('..');
      return u.protocol === 'https:' && ad.title.trim() !== '' && imageOk;
    } catch {
      return false;
    }
  });
}
