import { CurrencyCode } from '../types/crypto';
import { usePersistentState } from './usePersistentState';

const isCurrency = (value: unknown): value is CurrencyCode => (
  typeof value === 'string' && ['usd', 'eur', 'gbp', 'ngn'].includes(value)
);

export const useCurrency = () => {
  const [currency, setCurrency] = usePersistentState<CurrencyCode>(
    'blocklens_currency',
    'usd',
    isCurrency,
  );
  return { currency, setCurrency };
};
