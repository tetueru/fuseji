import { describe, expect, it } from 'vitest';
import { safeAds } from './ads';

describe('safeAds', () => {
  it('https のリンクだけ通し、変な画像の指定ははじく', () => {
    const ok = { title: '本', url: 'https://example.com/a?tag=x' };
    expect(
      safeAds([
        ok,
        { title: 'js', url: 'javascript:alert(1)' },
        { title: 'http', url: 'http://example.com' },
        { title: '', url: 'https://example.com' },
        { title: '外の画像', url: 'https://example.com', image: 'https://tracker.example/p.gif' },
        { title: '上のフォルダ', url: 'https://example.com', image: '../secret.png' },
        { title: '画像あり', url: 'https://example.com', image: 'ads/book.png' },
      ]).map((a) => a.title),
    ).toEqual(['本', '画像あり']);
  });
});
