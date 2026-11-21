import { useCallback, useEffect, useState } from 'react';
import type { SaleLineInput, ShopProduct } from '@mercearia/contracts';
import type { PickedOptions } from '../components/OptionPicker';
import { effectivePrice } from './parts';

export interface CartLine {
  key: string;
  product: ShopProduct;
  quantity: number;
  options: string[];
  optionNames: string[];
  /** Soma dos adicionais por unidade. */
  extras: number;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Carrinho do app/totem, guardado no aparelho (some ao fazer o pedido). */
export function useCart(storageKey: string) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as CartLine[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      /* sem armazenamento: carrinho só na memória */
    }
  }, [lines, storageKey]);

  const add = useCallback((product: ShopProduct, quantity = 1, picked?: PickedOptions) => {
    const options = picked?.ids ?? [];
    const key = `${product.id}|${[...options].sort().join(',')}`;
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      if (i >= 0) return ls.map((l, n) => (n === i ? { ...l, quantity: Math.min(50, l.quantity + quantity) } : l));
      return [...ls, { key, product, quantity, options, optionNames: picked?.names ?? [], extras: picked?.extras ?? 0 }];
    });
  }, []);
  const setQty = useCallback((key: string, quantity: number) => setLines((ls) => (quantity <= 0 ? ls.filter((l) => l.key !== key) : ls.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, quantity) } : l)))), []);
  const clear = useCallback(() => setLines([]), []);

  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = (member: boolean) => round(lines.reduce((s, l) => s + (effectivePrice(l.product, member) + l.extras) * l.quantity, 0));
  const items: SaleLineInput[] = lines.map((l) => ({ productId: l.product.id, quantity: l.quantity, options: l.options }));
  return { lines, add, setQty, clear, count, total, items };
}
