import { CurrencyCode } from '../types/crypto';

const currencyLocales: Record<CurrencyCode, string> = {
  usd: 'en-US',
  eur: 'de-DE',
  gbp: 'en-GB',
  ngn: 'en-NG',
};

export const currencySymbols: Record<CurrencyCode, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
  ngn: '₦',
};

export const formatCurrency = (
  value: number | null | undefined,
  currency: CurrencyCode = 'usd',
): string => {
  if (value == null || !Number.isFinite(value)) return 'N/A';

  const absolute = Math.abs(value);
  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency: currency.toUpperCase(),
  };

  if (absolute === 0) {
    options.minimumFractionDigits = 2;
    options.maximumFractionDigits = 2;
  } else if (absolute >= 1_000) {
    options.maximumFractionDigits = 2;
  } else if (absolute >= 1) {
    options.minimumFractionDigits = 2;
    options.maximumFractionDigits = 4;
  } else {
    options.maximumSignificantDigits = 5;
  }

  return new Intl.NumberFormat(currencyLocales[currency], options).format(value);
};

export const formatCompactCurrency = (
  value: number | null | undefined,
  currency: CurrencyCode = 'usd',
): string => {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  const absolute = Math.abs(value);
  if (absolute < 1_000_000) return formatCurrency(value, currency);

  return new Intl.NumberFormat(currencyLocales[currency], {
    style: 'currency',
    currency: currency.toUpperCase(),
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
};

/** Price labels for chart axes: preserve locale and precision without a currency symbol. */
export const formatPriceAxis = (
  value: number | null | undefined,
  currency: CurrencyCode = 'usd',
): string => {
  if (value == null || !Number.isFinite(value)) return 'N/A';

  const absolute = Math.abs(value);
  const options: Intl.NumberFormatOptions = { useGrouping: true };
  if (absolute >= 1_000_000) {
    options.notation = 'compact';
    options.maximumFractionDigits = 2;
  } else if (absolute >= 1_000) {
    options.maximumFractionDigits = 2;
  } else if (absolute >= 1) {
    options.minimumFractionDigits = 2;
    options.maximumFractionDigits = 4;
  } else {
    options.maximumSignificantDigits = 5;
  }

  return new Intl.NumberFormat(currencyLocales[currency], options).format(value);
};

export const formatPercent = (
  value: number | null | undefined,
  includeSign = true,
): string => {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  const sign = includeSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

export const formatNumber = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
};

export const formatDate = (value: string | number | null | undefined): string => {
  if (value == null) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatDateTime = (value: string | number | null | undefined): string => {
  if (value == null) return 'Unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
