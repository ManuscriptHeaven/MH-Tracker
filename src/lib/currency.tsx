import React, { createContext, useContext, useState } from 'react';
import type { CurrencyCode } from './types';

export interface CurrencyContextValue {
  displayCurrency: CurrencyCode;
  setDisplayCurrency: (currency: CurrencyCode) => void;
  exchangeRate: number;
  setExchangeRate: (rate: number) => void;
  exchangeRateLastUpdated: string;
  formatMoney: (
    amount: number | null | undefined,
    fromCurrency?: CurrencyCode | string,
    options?: { showCode?: boolean; forceDecimals?: boolean },
  ) => string;
  convertMoney: (
    amount: number | null | undefined,
    fromCurrency: CurrencyCode | string,
    toCurrency: CurrencyCode | string,
    rateOverride?: number,
  ) => number;
  formatOriginal: (amount: number | null | undefined, currency?: CurrencyCode | string) => string;
  formatTransaction: (tx: {
    amount?: number;
    original_amount?: number;
    currency?: CurrencyCode | string;
    exchange_rate?: number;
    amount_pkr?: number;
    base_amount_pkr?: number;
  }) => {
    displayValue: string;
    displayNumeric: number;
    originalValue: string;
    isOriginal: boolean;
  };
}

const DEFAULT_USD_PKR_RATE = 277.5;
const DEFAULT_LAST_UPDATED = '2026-08-18 00:00';

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Global display currency preference (persisted in localStorage)
  const [displayCurrency, setDisplayCurrencyState] = useState<CurrencyCode>(() => {
    const saved = localStorage.getItem('mh_display_currency');
    return saved === 'PKR' || saved === 'USD' ? (saved as CurrencyCode) : 'USD';
  });

  // USD to PKR exchange rate (persisted in localStorage)
  const [exchangeRate, setExchangeRateState] = useState<number>(() => {
    const saved = localStorage.getItem('mh_usd_pkr_rate');
    const parsed = Number(saved);
    return !isNaN(parsed) && parsed > 0 ? parsed : DEFAULT_USD_PKR_RATE;
  });

  const [exchangeRateLastUpdated, setExchangeRateLastUpdated] = useState<string>(() => {
    return localStorage.getItem('mh_usd_pkr_updated') || DEFAULT_LAST_UPDATED;
  });

  function setDisplayCurrency(currency: CurrencyCode) {
    setDisplayCurrencyState(currency);
    localStorage.setItem('mh_display_currency', currency);
  }

  function setExchangeRate(rate: number) {
    if (isNaN(rate) || rate <= 0) return;
    const cleanRate = Number(rate.toFixed(2));
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    setExchangeRateState(cleanRate);
    setExchangeRateLastUpdated(now);
    localStorage.setItem('mh_usd_pkr_rate', String(cleanRate));
    localStorage.setItem('mh_usd_pkr_updated', now);
  }

  // Convert numeric value between currencies
  function convertMoney(
    amount: number | null | undefined,
    fromCurrency: CurrencyCode | string = 'USD',
    toCurrency: CurrencyCode | string = displayCurrency,
    rateOverride?: number,
  ): number {
    const val = Number(amount || 0);
    if (isNaN(val) || val === 0) return 0;

    const from = fromCurrency === 'PKR' ? 'PKR' : 'USD';
    const to = toCurrency === 'PKR' ? 'PKR' : 'USD';
    const rate = rateOverride && rateOverride > 0 ? rateOverride : exchangeRate;

    if (from === to) return val;
    if (from === 'USD' && to === 'PKR') {
      return Math.round(val * rate);
    }
    if (from === 'PKR' && to === 'USD') {
      return Number((val / rate).toFixed(2));
    }
    return val;
  }

  // Format currency value based on target display currency
  function formatMoney(
    amount: number | null | undefined,
    fromCurrency: CurrencyCode | string = 'USD',
    options?: { showCode?: boolean; forceDecimals?: boolean },
  ): string {
    const val = Number(amount || 0);
    const converted = convertMoney(val, fromCurrency, displayCurrency);

    if (displayCurrency === 'PKR') {
      const rounded = Math.round(converted);
      const formatted = rounded.toLocaleString('en-US');
      return options?.showCode ? `Rs. ${formatted} PKR` : `Rs. ${formatted}`;
    }

    // USD format
    const formatted = converted.toLocaleString('en-US', {
      minimumFractionDigits: options?.forceDecimals || converted % 1 !== 0 ? 2 : 0,
      maximumFractionDigits: 2,
    });
    return options?.showCode ? `$${formatted} USD` : `$${formatted}`;
  }

  // Format original amount in its native currency
  function formatOriginal(
    amount: number | null | undefined,
    currency: CurrencyCode | string = 'USD',
  ): string {
    const val = Number(amount || 0);
    const code = currency === 'PKR' ? 'PKR' : 'USD';

    if (code === 'PKR') {
      const formatted = Math.round(val).toLocaleString('en-US');
      return `Rs. ${formatted} PKR`;
    }

    const formatted = val.toLocaleString('en-US', {
      minimumFractionDigits: val % 1 !== 0 ? 2 : 0,
      maximumFractionDigits: 2,
    });
    return `$${formatted} USD`;
  }

  // Helper for Finance Transactions
  function formatTransaction(tx: {
    amount?: number;
    original_amount?: number;
    currency?: CurrencyCode | string;
    exchange_rate?: number;
    amount_pkr?: number;
    base_amount_pkr?: number;
  }) {
    const origAmount = Number(tx.original_amount ?? tx.amount ?? 0);
    const origCurrency: CurrencyCode = tx.currency === 'PKR' ? 'PKR' : 'USD';
    const txRate = Number(tx.exchange_rate) || exchangeRate;

    let displayNumeric: number;
    if (displayCurrency === origCurrency) {
      displayNumeric = origAmount;
    } else if (origCurrency === 'USD' && displayCurrency === 'PKR') {
      // Historical rate preservation
      displayNumeric = tx.base_amount_pkr ?? tx.amount_pkr ?? Math.round(origAmount * txRate);
    } else {
      // origCurrency === 'PKR' && displayCurrency === 'USD'
      displayNumeric = Number((origAmount / txRate).toFixed(2));
    }

    const isOriginal = displayCurrency === origCurrency;
    const displayValue = formatMoney(displayNumeric, displayCurrency);
    const originalValue = formatOriginal(origAmount, origCurrency);

    return {
      displayValue,
      displayNumeric,
      originalValue,
      isOriginal,
    };
  }

  return (
    <CurrencyContext.Provider
      value={{
        displayCurrency,
        setDisplayCurrency,
        exchangeRate,
        setExchangeRate,
        exchangeRateLastUpdated,
        formatMoney,
        convertMoney,
        formatOriginal,
        formatTransaction,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  const context = useContext(CurrencyContext);
  if (!context) {
    // Fallback safe implementation if accessed outside provider
    const fallbackRate = DEFAULT_USD_PKR_RATE;
    return {
      displayCurrency: 'USD',
      setDisplayCurrency: () => {},
      exchangeRate: fallbackRate,
      setExchangeRate: () => {},
      exchangeRateLastUpdated: DEFAULT_LAST_UPDATED,
      formatMoney: (amount, fromCurrency = 'USD') => {
        const val = Number(amount || 0);
        return `$${val.toLocaleString('en-US')}`;
      },
      convertMoney: (amount) => Number(amount || 0),
      formatOriginal: (amount, currency = 'USD') => {
        const val = Number(amount || 0);
        return currency === 'PKR' ? `Rs. ${val.toLocaleString('en-US')} PKR` : `$${val.toLocaleString('en-US')} USD`;
      },
      formatTransaction: (tx) => {
        const val = Number(tx.amount || 0);
        return {
          displayValue: `$${val.toLocaleString('en-US')}`,
          displayNumeric: val,
          originalValue: `$${val.toLocaleString('en-US')} USD`,
          isOriginal: true,
        };
      },
    };
  }
  return context;
}
