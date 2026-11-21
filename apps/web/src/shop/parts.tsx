import { useEffect, useMemo, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { formatMoney, type ShopCatalog, type ShopProduct } from '@mercearia/contracts';

/** Folha da marca (mesma do logo). */
export function Leaf({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M6 18C6 10 11 6 18 6c0 7-4 12-12 12z" fill="#B8E06A" />
      <path d="M6 18l6-6" stroke="#2F6B3A" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Qr({ value, size = 168, className }: { value: string; size?: number; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14232B', light: '#FFFFFF' } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(''));
    return () => {
      alive = false;
    };
  }, [value]);
  return <div className={className} style={{ width: size, height: size }} aria-label={`QR code ${value}`} role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Preço que a cliente paga (membro ou não), com a oferta da vez. */
export function effectivePrice(p: ShopProduct, member: boolean): number {
  let v = member ? p.memberPrice : p.price;
  if (p.offer && (member || !p.offer.membersOnly)) v = Math.min(v, p.offer.price);
  return v;
}

/** Quanto o membro economiza neste produto (preço de membro e oferta). */
export const saving = (p: ShopProduct) => Math.max(0, Math.round((p.price - effectivePrice(p, true)) * 100) / 100);

function unitLabel(p: ShopProduct) {
  return p.soldByWeight ? '/kg' : p.unit !== 'UN' ? `/${p.unit.toLowerCase()}` : '';
}

export function ProductCard({ p, big, onAdd }: { p: ShopProduct; big?: boolean; onAdd?: (p: ShopProduct) => void }) {
  const off = saving(p);
  const pctOff = off > 0 ? Math.round((off / p.price) * 100) : 0;
  const [broken, setBroken] = useState(false);
  return (
    <article className={`relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white ${p.available ? '' : 'opacity-60'}`}>
      <div className="relative aspect-square bg-brand-soft">
        {p.imageUrl && !broken ? (
          <img src={p.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Leaf className="h-12 w-12 opacity-70" />
          </div>
        )}
        {p.offer ? (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">Oferta{p.offer.membersOnly ? ' membro' : ''}</span>
        ) : (
          pctOff > 0 && <span className="absolute left-2 top-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">-{pctOff}% membro</span>
        )}
        {!p.available && <span className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-xs font-medium text-white">Esgotado</span>}
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className={`${big ? 'text-base' : 'text-sm'} font-semibold leading-snug text-ink`}>{p.name}</h3>
        {p.brand && <p className="text-xs text-ink-soft">{p.brand}</p>}
        {p.description && big && <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{p.description}</p>}
        {p.optionGroups.length > 0 && <p className="mt-1 text-[11px] font-medium text-brand">Monte do seu jeito</p>}
        <div className="mt-auto pt-2">
          {p.offer ? (
            <>
              <p className="text-xs text-ink-soft">
                Normal <span className="line-through">{formatMoney(p.price)}</span>
                {!p.offer.membersOnly && p.memberPrice < p.price && p.memberPrice < p.offer.price && <span> · membro {formatMoney(p.memberPrice)}</span>}
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Oferta{p.offer.membersOnly ? ' para membro' : ''} até {p.offer.until.split('-').reverse().slice(0, 2).join('/')}</p>
              <p className={`${big ? 'text-xl' : 'text-lg'} -mt-0.5 font-bold leading-tight text-amber-700`}>
                {formatMoney(Math.min(p.offer.price, p.offer.membersOnly ? p.offer.price : p.memberPrice))}
                <span className="text-xs font-medium">{unitLabel(p)}</span>
              </p>
            </>
          ) : off > 0 ? (
            <>
              <p className="text-xs text-ink-soft">
                Normal <span className="line-through">{formatMoney(p.price)}</span>
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">Membro</p>
              <p className={`${big ? 'text-xl' : 'text-lg'} -mt-0.5 font-bold leading-tight text-brand`}>
                {formatMoney(p.memberPrice)}
                <span className="text-xs font-medium">{unitLabel(p)}</span>
              </p>
            </>
          ) : (
            <p className={`${big ? 'text-xl' : 'text-lg'} font-bold text-ink`}>
              {formatMoney(p.price)}
              <span className="text-xs font-medium text-ink-soft">{unitLabel(p)}</span>
            </p>
          )}
        </div>
        {onAdd && p.available && (
          <button onClick={() => onAdd(p)} className={`mt-2 w-full rounded-xl bg-brand ${big ? 'py-3 text-base' : 'py-2 text-sm'} font-semibold text-white active:scale-[0.98]`}>
            {p.optionGroups.length ? 'Escolher' : 'Adicionar'}
          </button>
        )}
      </div>
    </article>
  );
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Busca + categorias + grade de produtos (usada no app e no cardápio). */
export function Catalog({ data, big, header, onAdd }: { data: ShopCatalog; big?: boolean; header?: ReactNode; onAdd?: (p: ShopProduct) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [onlyOffers, setOnlyOffers] = useState(false);
  const list = useMemo(() => {
    const terms = fold(q).split(/\s+/).filter(Boolean);
    return data.products
      .filter((p) => (!cat || p.categoryId === cat) && (!onlyOffers || saving(p) > 0))
      .filter((p) => terms.every((t) => fold(`${p.name} ${p.brand ?? ''} ${p.description ?? ''}`).includes(t)))
      .sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [data, q, cat, onlyOffers]);
  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition ${active ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-ink hover:border-brand'}`;
  return (
    <div>
      {header}
      <div className="sticky top-0 z-10 -mx-4 bg-[#F6F8F4]/95 px-4 pb-2 pt-2 backdrop-blur">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar whey, granola, shake…"
          className={`w-full rounded-xl border border-slate-300 bg-white px-4 ${big ? 'py-4 text-lg' : 'py-3'} outline-none focus:border-brand`}
          type="search"
          inputMode="search"
        />
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          <button className={chip(!cat && !onlyOffers)} onClick={() => (setCat(null), setOnlyOffers(false))}>
            Tudo
          </button>
          <button className={chip(onlyOffers)} onClick={() => setOnlyOffers((v) => !v)}>
            Ofertas
          </button>
          {data.categories.map((c) => (
            <button key={c.id} className={chip(cat === c.id)} onClick={() => setCat(cat === c.id ? null : c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="py-16 text-center text-ink-soft">Nada encontrado. Tente outra palavra.</p>
      ) : (
        <div className={`mt-2 grid gap-3 ${big ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'}`}>
          {list.map((p) => (
            <ProductCard key={p.id} p={p} big={big} onAdd={onAdd} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-soft border-t-brand" />
    </div>
  );
}
