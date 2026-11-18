export type VideoLink = { url: string; canon: string; platform: 'TikTok' | 'Instagram' };

export function videoCanon(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m)\./, '') + url.pathname.replace(/\/+$/, '');
}

export function parseVideoLink(input: string): VideoLink | null {
  const raw = input.trim();
  if (!raw || raw.length > 2048 || /[\s\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : 'https://' + raw);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;

  const host = url.hostname.replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const [first = '', second = '', third = ''] = parts;
  let platform: VideoLink['platform'];
  if (host === 'instagram.com') {
    if (['explore', 'accounts', 'direct', 'stories', 'share'].includes(first)) return null;
    const kinds = ['reel', 'reels', 'p', 'tv'];
    const code = kinds.includes(first) ? second : kinds.includes(second) ? third : '';
    if (!/^[A-Za-z0-9_-]{10,}$/.test(code)) return null;
    platform = 'Instagram';
  } else if (['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(host)) {
    const valid = host === 'tiktok.com'
      ? (first.startsWith('@') && second === 'video' && /^[0-9]{19,20}$/.test(third))
        || (first === 't' && /^[A-Za-z0-9]{9,}$/.test(second))
      : /^[A-Za-z0-9]{9,}$/.test(first);
    if (!valid) return null;
    platform = 'TikTok';
  } else return null;

  url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  return { url: url.href, canon: videoCanon(url), platform };
}
