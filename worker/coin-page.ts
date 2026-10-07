import { CoinProfileError, fetchCoinProfile } from '../api/_coin.ts';
import type { ServerEnvironment } from '../api/_env.ts';
import type { CoinDetail } from '../src/types/crypto.ts';

type Environment = ServerEnvironment & { ASSETS: { fetch: (request: Request) => Promise<Response> } };
const origin = 'https://blocklens.corstack.dev';
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const plainText = (value = '') => value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const dollars = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value < 1 ? 8 : 2 }).format(value) : 'Unavailable';

export function coinOverview(coin: CoinDetail): string {
  const market = coin.market_data;
  return '<main class="app-container page-stack coin-detail-container">' +
    '<a class="back-link" href="/markets">Back to markets</a>' +
    '<header class="coin-detail-header"><div class="coin-detail-identity"><img class="coin-detail-img" src="' + escapeHtml(coin.image.large) + '" alt="" /><div><h1>' + escapeHtml(coin.name) + ' <span class="coin-detail-symbol">' + escapeHtml(coin.symbol.toUpperCase()) + '</span></h1></div></div>' +
    '<div class="coin-detail-price"><span class="detail-current-price">' + escapeHtml(dollars(market.current_price.usd)) + '</span></div></header>' +
    '<section class="coin-detail-section"><h2>Market statistics</h2><dl>' +
    '<dt>Market cap</dt><dd>' + escapeHtml(dollars(market.market_cap.usd)) + '</dd>' +
    '<dt>24-hour trading volume</dt><dd>' + escapeHtml(dollars(market.total_volume.usd)) + '</dd>' +
    '<dt>Circulating supply</dt><dd>' + escapeHtml(market.circulating_supply == null ? 'Unavailable' : new Intl.NumberFormat('en-US').format(market.circulating_supply)) + '</dd></dl></section>' +
    (coin.description?.en ? '<section class="coin-detail-section"><h2>About ' + escapeHtml(coin.name) + '</h2><p>' + escapeHtml(plainText(coin.description.en)) + '</p></section>' : '') +
    '<p class="data-source-label">Market data by ' + (coin.dataSource === 'coinpaprika' ? 'CoinPaprika' : 'CoinGecko') + '. Data may be delayed.</p></main>';
}

export async function handleCoinPage(request: Request, environment: Environment, id: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  let coin: CoinDetail;
  try { coin = await fetchCoinProfile(id, environment); }
  catch (error) {
    const status = error instanceof CoinProfileError ? error.status : 503;
    const message = status === 404 ? 'Asset not found' : 'Asset data temporarily unavailable';
    return new Response(request.method === 'HEAD' ? null : '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>' + message + ' · BlockLens</title></head><body><main><h1>' + message + '</h1><p>' + (status === 404 ? 'This asset could not be found.' : 'Please try again in a moment.') + '</p><a href="/markets">Back to markets</a></main></body></html>', {
      status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '60' } : {}), 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' },
    });
  }
  const shell = await environment.ASSETS.fetch(new Request(new URL('/index.html', request.url), { method: 'GET' }));
  const source = await shell.text();
  if (!shell.ok || !source.includes('<div id="root"></div>')) return new Response('Page temporarily unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  const title = escapeHtml(coin.name + ' Price & Market Data · BlockLens');
  const description = escapeHtml('Inspect ' + coin.name + ' price history, market statistics, supply, and scenario-based research tools.');
  const canonical = origin + '/coin/' + encodeURIComponent(id);
  const seed = JSON.stringify(coin).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = source.replace(/<title>[^<]*<\/title>/, () => '<title>' + title + '</title>')
    .replace(/(<meta\s+(?:name|property)="(?:description|og:description|twitter:description)"\s+content=")[^"]*("\s*\/?>)/g, (_, start, end) => start + description + end)
    .replace(/(<meta\s+(?:name|property)="(?:og:title|twitter:title)"\s+content=")[^"]*("\s*\/?>)/g, (_, start, end) => start + title + end)
    .replace('<div id="root"></div>', () => '<div id="root">' + coinOverview(coin) + '</div><script id="coin-profile-data" type="application/json" data-fetched-at="' + Date.now() + '">' + seed + '</script>')
    .replace(/<noscript>.*?<\/noscript>/s, '')
    .replace('</head>', () => '<link rel="canonical" href="' + canonical + '"><meta property="og:url" content="' + canonical + '"></head>');
  const headers = new Headers(shell.headers);
  headers.delete('content-length'); headers.delete('etag');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers });
}

export async function handleCoinApi(request: Request, environment: Environment): Promise<Response> {
  if (request.method !== 'GET') return Response.json({ error: 'Only GET requests are accepted.' }, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
  try {
    const coin = await fetchCoinProfile(new URL(request.url).searchParams.get('coinId') ?? '', environment);
    return Response.json(coin, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
  } catch (error) {
    const status = error instanceof CoinProfileError ? error.status : 503;
    return Response.json({ error: status === 404 ? 'This asset could not be found.' : 'Asset data is temporarily unavailable. Please try again.' }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 503 ? { 'Retry-After': '60' } : {}) } });
  }
}
