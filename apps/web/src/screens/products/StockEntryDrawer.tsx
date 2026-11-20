import { useEffect, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PRODUCT_KINDS, formatMoney, stockEntrySchema, stockStores, type ProductKind, type ProductOption, type StockEntryItem, type StockEntryPreview, type StockEntryResult, type Store } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Drawer, ErrorBox, Field } from '../../components/ui';
import { formatDay } from '../../components/os';

type Choice = { action: 'skip' } | { action: 'link'; productId: string; productName: string } | { action: 'create'; name: string; kind: ProductKind; price: string };

function initial(i: StockEntryItem): Choice {
  if (i.problem) return { action: 'skip' };
  if (i.match) return { action: 'link', productId: i.match.productId, productName: i.match.name };
  return { action: 'create', name: i.description, kind: i.suggestedKind, price: '' };
}

/** Entrada de mercadoria pelo XML da nota do fornecedor. */
export function StockEntryDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const options = stockStores((stores.data ?? []).filter((s) => s.active));
  const [xml, setXml] = useState('');
  const [note, setNote] = useState<StockEntryPreview | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [storeId, setStoreId] = useState('');
  const [createPayables, setPayables] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<StockEntryResult | null>(null);
  useEffect(() => {
    if (!storeId && options.length) setStoreId(options[0]!.id);
  }, [options, storeId]);

  const read = useMutation({
    mutationFn: (text: string) => api<StockEntryPreview>('/stock-entries/preview', { method: 'POST', json: { xml: text } }),
    onSuccess: (p) => {
      setNote(p);
      setChoices(p.items.map(initial));
    },
    onError: (e) => {
      setNote(null);
      setError(e);
    },
  });
  const confirm = useMutation({
    mutationFn: (body: unknown) => api<StockEntryResult>('/stock-entries', { method: 'POST', json: body }),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: setError,
  });

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    const text = await file.text();
    setXml(text);
    read.mutate(text);
  }
  const set = (index: number, c: Choice) => setChoices((all) => all.map((old, i) => (i === index ? c : old)));

  function submit() {
    if (!note) return;
    const lines = choices.map((c, index) => (c.action === 'link' ? { index, action: c.action, productId: c.productId } : c.action === 'create' ? { index, action: c.action, name: c.name, kind: c.kind, price: c.price } : { index, action: c.action }));
    const parsed = stockEntrySchema.safeParse({ xml, storeId, lines, createPayables });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const at = typeof issue?.path[1] === 'number' ? `Item ${issue.path[1] + 1}: ` : '';
      return setError(new Error(`${at}${issue?.message}`));
    }
    setError(null);
    confirm.mutate(parsed.data);
  }

  const entering = choices.filter((c) => c.action !== 'skip').length;
  return (
    <Drawer title="Entrada de mercadoria por XML" onClose={onClose} wide>
      <div className="space-y-4">
        {!result && (
          <>
            <p className="text-sm text-ink-soft">Escolha o arquivo XML da nota do fornecedor (o mesmo que chega por e-mail junto com o PDF). Nada é gravado antes de você confirmar.</p>
            <input type="file" accept=".xml,text/xml" onChange={pick} className="text-sm" aria-label="XML da nota" />
          </>
        )}
        {read.isPending && <p className="text-sm text-ink-soft">Lendo a nota…</p>}
        <ErrorBox error={error} />
        {note && !result && (
          <>
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <div className="font-semibold">{note.supplier.name}</div>
              <div className="text-ink-soft">
                NF {note.number}
                {note.series ? ` · série ${note.series}` : ''} · {formatDay(note.issuedAt)} · {formatMoney(note.total)}
              </div>
            </div>
            {note.alreadyImported ? (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Essa nota já deu entrada no estoque. Não dá para lançar de novo.
              </div>
            ) : (
              <>
                {options.length > 1 && (
                  <Field label="Estoque que recebe a mercadoria">
                    <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                      {options.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="space-y-3">
                  {note.items.map((i) => (
                    <ItemCard key={i.index} item={i} choice={choices[i.index] ?? { action: 'skip' }} onChange={(c) => set(i.index, c)} />
                  ))}
                </div>
                {note.installments.length > 0 && (
                  <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={createPayables} onChange={(e) => setPayables(e.target.checked)} />
                    <span>
                      Lançar as duplicatas em contas a pagar
                      <span className="block text-xs text-ink-soft">{note.installments.map((d) => `${formatDay(d.dueDate)} ${formatMoney(d.amount)}`).join(' · ')}</span>
                    </span>
                  </label>
                )}
                <button className="btn-primary w-full" disabled={confirm.isPending || !entering || !storeId} onClick={submit}>
                  {confirm.isPending ? 'Dando entrada…' : `Dar entrada em ${entering} ${entering === 1 ? 'item' : 'itens'}`}
                </button>
              </>
            )}
          </>
        )}
        {result && (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Entrada concluída.</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Num label="Peças no estoque" value={result.units} />
              <Num label="Produtos novos" value={result.created} />
              <Num label="Já cadastrados" value={result.linked} />
              <Num label="Contas a pagar" value={result.payables} />
            </div>
            {result.skipped > 0 && <p className="text-sm text-ink-soft">{result.skipped} item(ns) da nota ficaram de fora.</p>}
            <button className="btn-primary w-full" onClick={onClose}>
              Fechar
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function ItemCard({ item, choice, onChange }: { item: StockEntryItem; choice: Choice; onChange: (c: Choice) => void }) {
  function setAction(action: Choice['action']) {
    if (action === 'skip') onChange({ action });
    else if (action === 'create') onChange({ action, name: item.description, kind: item.suggestedKind, price: '' });
    else onChange({ action, productId: item.match?.productId ?? '', productName: item.match?.name ?? '' });
  }
  return (
    <div className={`rounded-lg border p-3 ${choice.action === 'skip' ? 'border-slate-200 opacity-70' : 'border-slate-300'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">{item.description}</div>
          <div className="text-xs text-ink-soft">
            {item.quantity} × {formatMoney(item.unitCost)} · cód. {item.code}
            {item.ncm ? ` · NCM ${item.ncm}` : ''}
          </div>
        </div>
        <select className="input w-auto" value={choice.action} disabled={Boolean(item.problem)} onChange={(e) => setAction(e.target.value as Choice['action'])} aria-label={`O que fazer com ${item.description}`}>
          <option value="create">Cadastrar produto novo</option>
          <option value="link">Já tenho esse produto</option>
          <option value="skip">Ignorar</option>
        </select>
      </div>
      {item.problem && <p className="mt-2 text-xs text-red-600">{item.problem}</p>}
      {choice.action === 'create' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input className="input" value={choice.name} onChange={(e) => onChange({ ...choice, name: e.target.value })} aria-label="Nome do produto" />
          <select className="input w-auto" value={choice.kind} onChange={(e) => onChange({ ...choice, kind: e.target.value as ProductKind })} aria-label="Tipo">
            {Object.entries(PRODUCT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input className="input w-32 tabular-nums" inputMode="decimal" placeholder="Preço de venda" value={choice.price} onChange={(e) => onChange({ ...choice, price: e.target.value })} aria-label="Preço de venda" />
        </div>
      )}
      {choice.action === 'link' && (
        <div className="mt-3">
          {choice.productId ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="badge bg-emerald-50 text-emerald-700">{choice.productName}</span>
              {item.match?.productId === choice.productId && <span className="text-xs text-ink-soft">{item.match.via === 'memoria' ? 'ligado na última nota deste fornecedor' : 'mesmo código de barras'}</span>}
              <button className="text-xs text-brand" onClick={() => onChange({ ...choice, productId: '', productName: '' })}>
                Trocar
              </button>
            </div>
          ) : (
            <ProductSearch onPick={(p) => onChange({ action: 'link', productId: p.id, productName: p.name })} />
          )}
        </div>
      )}
    </div>
  );
}

function ProductSearch({ onPick }: { onPick: (p: ProductOption) => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const found = useQuery({ queryKey: ['product-lookup', debounced], queryFn: () => api<ProductOption[]>(`/products/lookup?q=${encodeURIComponent(debounced)}`), enabled: debounced.length >= 2 });
  return (
    <div>
      <input className="input" placeholder="Buscar o produto pelo nome ou código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
      {found.data && (
        <div className="mt-1 rounded-lg border border-slate-200">
          {found.data.length === 0 && <div className="p-2 text-sm text-ink-soft">Nenhum produto encontrado.</div>}
          {found.data.map((p) => (
            <button key={p.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => onPick(p)}>
              {p.name}
              <span className="ml-2 text-xs text-ink-soft">{[p.brand, p.sku].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Num({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
