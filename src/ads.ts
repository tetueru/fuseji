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

export const ADS: Ad[] = [];

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
