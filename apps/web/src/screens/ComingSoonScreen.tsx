import type { NavItem } from '../lib/nav';

/** Tela que ainda não existe: diz o que vai ter e em que fase entra. */
export function ComingSoonScreen({ item }: { item: NavItem }) {
  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold">{item.label}</h1>
      <div className="card mt-6 p-6">
        <span className="badge bg-brand-soft text-brand">Entra na Fase {item.phase}</span>
        <p className="mt-3 text-sm text-ink">{item.description}</p>
      </div>
    </div>
  );
}
