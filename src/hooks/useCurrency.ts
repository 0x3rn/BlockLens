import { CurrencyCode } from '../types/crypto';
import { useAuth } from '../context/AuthContext';
import { usePersistentState } from './usePersistentState';

const isCurrency = (value: unknown): value is CurrencyCode => (
  typeof value === 'string' && ['usd', 'eur', 'gbp', 'ngn'].includes(value)
);

export const useCurrency = () => {
  const { user, loading: authLoading } = useAuth();
  const [currency, setCurrency] = usePersistentState<CurrencyCode>(
    'blocklens_currency',
    'usd',
    isCurrency,
    !authLoading && !user,
  );
  return { currency, setCurrency };
};
