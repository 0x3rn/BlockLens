import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFuturesMarketPrice } from './useFuturesMarketPrice';
import type { Coin } from '../types/crypto';
class Socket {
  static instances: Socket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { Socket.instances.push(this); }
  close() { this.onclose?.(); }
  tick(p = '101', s = 'BTCUSDT', E = Date.now()) { this.onmessage?.({ data: JSON.stringify({ e: 'markPriceUpdate', s, p, E, r: '0.0001' }) }); }
}
const coin = { id: 'bitcoin', symbol: 'btc', current_price: 100 } as Coin;
const fetchMock = vi.fn();
beforeEach(() => { vi.useFakeTimers(); Socket.instances = []; vi.stubGlobal('WebSocket', Socket); vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ symbol: 'BTCUSDT', markPrice: '102', time: Date.now(), lastFundingRate: '0.0002' }) }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('futures feed lifecycle', () => {
  it('requires a valid tick before saying Live and uses the current market route', () => {
    const { result } = renderHook(() => useFuturesMarketPrice(coin));
    const socket = Socket.instances[0];
    expect(socket.url).toContain('/market/ws/btcusdt@markPrice@1s');
    act(() => socket.onopen?.());
    expect(result.current.status).toBe('connecting');
    act(() => socket.tick());
    expect(result.current).toMatchObject({ status: 'live', price: 101, fundingRate: .0001 });
  });
  it.each(['wrong symbol', 'stale', 'invalid'])('ignores %s messages without marking the feed live', kind => {
    const { result } = renderHook(() => useFuturesMarketPrice(coin));
    act(() => Socket.instances[0].tick(kind === 'invalid' ? 'NaN' : '101', kind === 'wrong symbol' ? 'ETHUSDT' : 'BTCUSDT', kind === 'stale' ? Date.now() - 20_000 : Date.now()));
    expect(result.current.status).toBe('connecting');
    expect(result.current.price).toBe(100);
  });
  it('does not reconnect when the market snapshot updates', () => {
    const { result, rerender } = renderHook(({ selected }) => useFuturesMarketPrice(selected), { initialProps: { selected: coin } });
    act(() => Socket.instances[0].tick());
    rerender({ selected: { ...coin, current_price: 99 } });
    expect(Socket.instances).toHaveLength(1);
    expect(result.current.price).toBe(101);
  });
  it('falls back to polling after ten seconds without messages', async () => {
    const { result } = renderHook(() => useFuturesMarketPrice(coin));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('symbol=BTCUSDT'), expect.any(Object));
    expect(result.current).toMatchObject({ status: 'polling', price: 102 });
  });
  it('clears stale funding and freshness on failed fallback', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFuturesMarketPrice(coin));
    act(() => Socket.instances[0].tick());
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current).toMatchObject({ status: 'fallback', price: 100, lastUpdated: null, fundingRate: null });
  });
  it('uses per-token prices for bundled SHIB contracts', () => {
    const { result } = renderHook(() => useFuturesMarketPrice({ ...coin, id: 'shiba-inu', symbol: 'shib', current_price: .00001 }));
    expect(Socket.instances[0].url).toContain('1000shibusdt');
    act(() => Socket.instances[0].tick('.012', '1000SHIBUSDT'));
    expect(result.current.price).toBeCloseTo(.000012);
  });
  it('ignores late messages from the previously selected asset', () => {
    const { result, rerender } = renderHook(({ selected }) => useFuturesMarketPrice(selected), { initialProps: { selected: coin } });
    const old = Socket.instances[0];
    rerender({ selected: { ...coin, id: 'ethereum', symbol: 'eth', current_price: 200 } });
    act(() => old.tick('999'));
    expect(result.current).toMatchObject({ price: 200, priceCoinId: 'ethereum', status: 'connecting' });
  });
  it('stops reconnecting and polling unsupported contracts', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ code: -1121 }) });
    const { result } = renderHook(() => useFuturesMarketPrice(coin));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.status).toBe('fallback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Socket.instances).toHaveLength(1);
  });
});
