/**
 * ファイルから文字を取り出す（ブラウザの中だけで行う。ファイルはどこにも送らない）。
 * 読み込む部品は、使うときに初めて読み込む
 */
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
/** 取り出す文字の上限（これを超えるとかくす処理が重くなりすぎる） */
export const MAX_TEXT_CHARS = 1_000_000;
/** Word（中身は圧縮ファイル）を広げたときの大きさの上限 */
const MAX_DOCX_UNZIPPED = 100 * 1024 * 1024;

const tooLong = () => new Error(`文字が多すぎます（${MAX_TEXT_CHARS.toLocaleString()} 文字まで）。ファイルを分けてください`);

function limitText(text: string): string {
  if (text.length > MAX_TEXT_CHARS) throw tooLong();
  return text;
}

export async function readFileText(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('ファイルが大きすぎます（30MBまで）');
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.pdf')) return readPdf(buf);
  if (name.endsWith('.docx')) return readDocx(buf);
  if (name.endsWith('.doc')) throw new Error('古い形式の Word（.doc）は読めません。Word で「.docx」に保存し直してください');
  if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.md') || file.type.startsWith('text/')) return limitText(decodeText(buf));
  throw new Error('読めるのは 文字（.txt）・PDF・Word（.docx）です');
}

/** UTF-8 で読めなければ Shift_JIS（Windows のメモ帳の古い保存形式）で読む */
function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(buf);
  }
}

async function readDocx(buf: ArrayBuffer): Promise<string> {
  // 小さなファイルでも、広げると巨大になるよう細工されたものがあるので、先に広げたあとの大きさを調べる
  const JSZip = (await import('jszip')).default;
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('この Word ファイルは壊れているか、Word（.docx）ではありません');
  }
  let total = 0;
  zip.forEach((_path, entry) => {
    total += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_DOCX_UNZIPPED) throw new Error('この Word ファイルは中身が大きすぎて読めません');
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return limitText(value.replace(/\n{3,}/g, '\n\n').trim());
}

/** PDF の文字を、同じ高さのものを1行にまとめて読む（箱舟 scripts/mask-pdf.mjs と同じ考え方） */
async function readPdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    // 日本語の PDF の文字の対応表。アプリに同梱したものを使う（ネットに取りに行かない）
    // 読み込み係（worker）からも同じ場所を指せるよう、完全な URL にする
    cMapUrl: new URL(`${import.meta.env.BASE_URL}cmaps/`, document.baseURI).href,
    cMapPacked: true,
  });
  try {
    // PDF の中身の解析は pdf.js の読み込み係（worker）で行うので、画面は固まらない。
    // ページは1枚ずつ読み、上限を超えたらそこで止める
    const doc = await task.promise;
    if (doc.numPages > MAX_PDF_PAGES) throw new Error(`ページが多すぎます（${MAX_PDF_PAGES}ページまで）`);
    const pages: string[] = [];
    let chars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: { x: number; y: number; w: number; str: string }[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const t = it.transform as number[];
        items.push({ x: t[4], y: -t[5], w: it.width ?? 0, str: it.str });
      }
      items.sort((a, b) => a.y - b.y || a.x - b.x);
      const rows: { y: number; parts: typeof items }[] = [];
      for (const it of items) {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.y - it.y) <= 3) last.parts.push(it);
        else rows.push({ y: it.y, parts: [it] });
      }
      const pageText = rows
        .map((r) => {
          r.parts.sort((a, b) => a.x - b.x);
          let s = '';
          let prevEnd = -Infinity;
          for (const part of r.parts) {
            // 横の間が広ければ（表の別の欄など）空白をはさむ
            if (s && part.x - prevEnd > 12) s += ' ';
            s += part.str;
            prevEnd = part.x + part.w;
          }
          return s.trim();
        })
        .join('\n');
      page.cleanup();
      chars += pageText.length;
      if (chars > MAX_TEXT_CHARS) throw tooLong();
      pages.push(pageText);
    }
    const text = pages.join('\n\n----- ページ区切り -----\n\n').trim();
    if (!text) throw new Error('この PDF からは文字を取り出せませんでした（写真やスキャンの PDF かもしれません）');
    return text;
  } finally {
    await task.destroy();
  }
}
