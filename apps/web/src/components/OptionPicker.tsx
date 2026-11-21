import { useEffect, useMemo, useState } from 'react';
import { formatMoney, type OptionGroupView } from '@mercearia/contracts';

export interface PickedOptions {
  ids: string[];
  names: string[];
  /** Soma dos adicionais (por unidade). */
  extras: number;
}

/** Confere as escolhas contra os grupos (mesma regra do servidor). */
export function optionProblem(groups: OptionGroupView[], ids: string[]): string | null {
  for (const g of groups) {
    const n = g.options.filter((o) => ids.includes(o.id)).length;
    if (n < g.minSelect) return g.minSelect === 1 ? `Escolha ${g.name.toLowerCase()}` : `Escolha ${g.minSelect} em ${g.name.toLowerCase()}`;
    if (n > g.maxSelect) return `No máximo ${g.maxSelect} em ${g.name.toLowerCase()}`;
  }
  return null;
}

export function pickedFrom(groups: OptionGroupView[], ids: string[]): PickedOptions {
  const all = groups.flatMap((g) => g.options);
  const chosen = ids.map((id) => all.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => Boolean(o));
  return { ids, names: chosen.map((o) => o.name), extras: Math.round(chosen.reduce((s, o) => s + o.price, 0) * 100) / 100 };
}

/**
 * Montagem do item (sabor, adicionais). Grupo de escolha única vira botão de
 * rádio; com máximo maior que 1, caixinhas até o limite. Mostra o preço final.
 */
export function OptionPicker({
  title,
  groups,
  basePrice,
  memberPrice,
  initial = [],
  big,
  confirmLabel = 'Adicionar',
  onClose,
  onConfirm,
}: {
  title: string;
  groups: OptionGroupView[];
  basePrice: number;
  /** Preço de membro do item base (mostra os dois quando diferente). */
  memberPrice?: number | null;
  initial?: string[];
  big?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (picked: PickedOptions, quantity: number) => void;
}) {
  const [ids, setIds] = useState<string[]>(() => {
    if (initial.length) return initial;
    // Grupo obrigatório de escolha única com uma opção só: já vem marcado.
    return groups.filter((g) => g.minSelect === 1 && g.maxSelect === 1 && g.options.length === 1).map((g) => g.options[0]!.id);
  });
  const [qty, setQty] = useState(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const picked = useMemo(() => pickedFrom(groups, ids), [groups, ids]);
  const problem = optionProblem(groups, ids);
  const toggle = (g: OptionGroupView, id: string) => {
    setIds((cur) => {
      const inGroup = g.options.map((o) => o.id);
      if (g.maxSelect === 1) {
        if (cur.includes(id)) return g.minSelect === 0 ? cur.filter((x) => x !== id) : cur;
        return [...cur.filter((x) => !inGroup.includes(x)), id];
      }
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.filter((x) => inGroup.includes(x)).length >= g.maxSelect) return cur;
      return [...cur, id];
    });
  };
  const text = big ? 'text-lg' : 'text-sm';
  const unit = (p: number) => Math.round((p + picked.extras) * 100) / 100;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl ${big ? 'max-w-2xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className={`${big ? 'text-2xl' : 'text-lg'} font-bold text-ink`}>{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="px-2 text-2xl leading-none text-ink-soft">
            ×
          </button>
        </div>
        <div className="space-y-4">
          {groups.map((g) => {
            const n = g.options.filter((o) => ids.includes(o.id)).length;
            return (
              <fieldset key={g.id}>
                <legend className={`mb-2 flex w-full items-baseline justify-between ${text} font-semibold text-ink`}>
                  <span>{g.name}</span>
                  <span className="text-xs font-normal text-ink-soft">
                    {g.minSelect > 0 ? (g.maxSelect === 1 ? 'obrigatório' : `escolha de ${g.minSelect} a ${g.maxSelect}`) : g.maxSelect === 1 ? 'opcional' : `até ${g.maxSelect}`}
                    {g.maxSelect > 1 ? ` · ${n}/${g.maxSelect}` : ''}
                  </span>
                </legend>
                <div className="grid gap-2">
                  {g.options.map((o) => {
                    const on = ids.includes(o.id);
                    const full = !on && g.maxSelect > 1 && n >= g.maxSelect;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={full}
                        onClick={() => toggle(g, o.id)}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-4 ${big ? 'py-4' : 'py-3'} text-left ${text} transition ${on ? 'border-brand bg-brand-soft font-semibold text-brand-dark' : 'border-slate-200 text-ink'} ${full ? 'opacity-40' : ''}`}
                      >
                        <span className="flex items-center gap-3">
                          <span className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 ${g.maxSelect === 1 ? 'rounded-full' : 'rounded'} ${on ? 'border-brand bg-brand text-white' : 'border-slate-300'}`}>{on ? '✓' : ''}</span>
                          {o.name}
                        </span>
                        {o.price > 0 && <span className="text-ink-soft">+ {formatMoney(o.price)}</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <div className="flex items-center rounded-xl border border-slate-300">
            <button type="button" className={`px-3 ${big ? 'py-3 text-xl' : 'py-2'}`} onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">
              −
            </button>
            <span className={`w-8 text-center tabular-nums ${text}`}>{qty}</span>
            <button type="button" className={`px-3 ${big ? 'py-3 text-xl' : 'py-2'}`} onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Mais">
              +
            </button>
          </div>
          <button
            type="button"
            disabled={Boolean(problem)}
            onClick={() => onConfirm(picked, qty)}
            className={`flex-1 rounded-xl bg-brand px-4 ${big ? 'py-4 text-lg' : 'py-3'} font-semibold text-white disabled:opacity-50`}
          >
            {problem ?? (
              <>
                {confirmLabel} · {formatMoney(unit(memberPrice != null && memberPrice < basePrice ? memberPrice : basePrice) * qty)}
              </>
            )}
          </button>
        </div>
        {!problem && memberPrice != null && memberPrice < basePrice && <p className="mt-2 text-center text-xs text-ink-soft">Preço de membro. Não membro: {formatMoney(unit(basePrice) * qty)}</p>}
      </div>
    </div>
  );
}
