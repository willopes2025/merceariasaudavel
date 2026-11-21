import { BRAND_ORANGE, BRAND_TERRACOTTA, LOGO, LOGO_VIEWBOX, MARK_VIEWBOX } from './logo-paths';

/** Cores da marca (iguais às do arquivo da logo). */
export const BRAND = { orange: BRAND_ORANGE, terracotta: BRAND_TERRACOTTA, cream: '#FBF6EE', ink: '#2B1E18' };

/** Símbolo (as quatro folhas em laranja). `mono` usa a cor do texto. */
export function BrandMark({ className = 'h-8 w-8', mono = false, title }: { className?: string; mono?: boolean; title?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={LOGO.sym} fill={mono ? 'currentColor' : BRAND_ORANGE} fillRule="evenodd" />
    </svg>
  );
}

/**
 * Logo circular completa. `light` deixa letras e parênteses em creme, para
 * fundo escuro (o símbolo continua laranja).
 */
export function BrandLogo({ className = 'h-24', light = false, title = 'Mercearia Saudável' }: { className?: string; light?: boolean; title?: string }) {
  const text = light ? BRAND.cream : BRAND_TERRACOTTA;
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label={title}>
      <path d={LOGO.sym} fill={BRAND_ORANGE} fillRule="evenodd" />
      <path d={LOGO.pl + LOGO.pr} fill={text} fillRule="evenodd" />
      <path d={LOGO.top} fill={text} fillRule="evenodd" />
      <path d={LOGO.bot} fill={text} fillRule="evenodd" />
    </svg>
  );
}

/** Símbolo + nome lado a lado (cabeçalhos estreitos). */
export function BrandLockup({ light = false, className = '', size = 'md' }: { light?: boolean; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const mark = size === 'lg' ? 'h-11 w-11' : size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
  const text = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-base' : 'text-lg';
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark className={`${mark} shrink-0`} />
      <span className={`font-display ${text} font-semibold leading-none tracking-tight ${light ? 'text-cream' : 'text-brand'}`}>
        Mercearia <span className="italic">Saudável</span>
      </span>
    </span>
  );
}
