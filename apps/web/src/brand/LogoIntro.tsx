import { useLayoutEffect, useRef, useState } from 'react';
import { BRAND_ORANGE, BRAND_TERRACOTTA, LOGO, LOGO_VIEWBOX } from './logo-paths';

/** A abertura toca uma vez por aba (recarregar a página não repete). */
const SEEN_KEY = 'mercearia.abertura';
const seen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Piece = { id: keyof typeof LOGO; from: Keyframe; to?: Keyframe; at: number; dur: number; easing?: string };
const BACK = 'cubic-bezier(.34,1.56,.64,1)';
const OUT = 'cubic-bezier(.16,1,.3,1)';

/** Roteiro (ms): folhas giram e se encaixam, parênteses fecham, nome se escreve. */
const PIECES: Piece[] = [
  { id: 'tl', from: { transform: 'translate(-520px,-520px) rotate(-200deg) scale(.2)', opacity: 0 }, at: 0, dur: 760, easing: BACK },
  { id: 'tr', from: { transform: 'translate(520px,-520px) rotate(200deg) scale(.2)', opacity: 0 }, at: 90, dur: 760, easing: BACK },
  { id: 'br', from: { transform: 'translate(520px,520px) rotate(-200deg) scale(.2)', opacity: 0 }, at: 180, dur: 760, easing: BACK },
  { id: 'bl', from: { transform: 'translate(-520px,520px) rotate(200deg) scale(.2)', opacity: 0 }, at: 270, dur: 760, easing: BACK },
  { id: 'pl', from: { transform: 'translate(420px,0) scaleY(.3)', opacity: 0 }, at: 780, dur: 520, easing: BACK },
  { id: 'pr', from: { transform: 'translate(-420px,0) scaleY(.3)', opacity: 0 }, at: 780, dur: 520, easing: BACK },
];
const TOTAL = 2350;

/**
 * Abertura da tela de entrada: a logo se monta (folhas, parênteses e o nome
 * escrito) e depois sobe para o topo, abrindo o formulário (`onDone`).
 * Toque ou tecla pula. Quem pediu menos movimento no aparelho vê a logo pronta.
 */
export function LogoIntro({ onDone, className = '' }: { onDone: () => void; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [skip] = useState(() => seen() || reduced());
  const done = useRef(false);

  // Antes de pintar: as peças já começam fora do lugar (sem piscar a logo pronta).
  useLayoutEffect(() => {
    const finish = () => {
      if (done.current) return;
      done.current = true;
      try {
        sessionStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* sem armazenamento */
      }
      onDone();
    };
    if (skip || !svg.current) return finish();
    const root = svg.current;
    const q = (id: string) => root.querySelector<SVGElement>(`[data-part="${id}"]`)!;
    const anims: Animation[] = [];
    const play = (el: Element, frames: Keyframe[], o: KeyframeAnimationOptions) => anims.push(el.animate(frames, { fill: 'both', ...o }));

    for (const p of PIECES) play(q(p.id), [p.from, p.to ?? { transform: 'none', opacity: 1 }], { delay: p.at, duration: p.dur, easing: p.easing ?? OUT });
    // Junta: as folhas viram o símbolo inteiro (sem emenda) com um brilho.
    play(q('quads'), [{ opacity: 1 }, { opacity: 0 }], { delay: 1080, duration: 120 });
    play(q('sym'), [{ opacity: 0 }, { opacity: 1 }], { delay: 1060, duration: 120 });
    play(q('sym'), [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { delay: 1150, duration: 420, easing: 'ease-in-out', composite: 'add' });
    play(q('glow'), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 0.55, transform: 'scale(1.05)' }, { opacity: 0, transform: 'scale(1.35)' }], { delay: 1100, duration: 700, easing: OUT });
    // O nome se escreve da esquerda para a direita.
    play(q('top-clip'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { delay: 1150, duration: 560, easing: 'cubic-bezier(.65,0,.35,1)' });
    play(q('bot-clip'), [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { delay: 1420, duration: 560, easing: 'cubic-bezier(.65,0,.35,1)' });
    play(q('top'), [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }], { delay: 1150, duration: 480, easing: OUT });
    play(q('bot'), [{ opacity: 0, transform: 'translateY(-40px)' }, { opacity: 1, transform: 'none' }], { delay: 1420, duration: 480, easing: OUT });

    const timer = window.setTimeout(finish, TOTAL);
    const skipNow = () => {
      anims.forEach((a) => a.finish());
      window.clearTimeout(timer);
      finish();
    };
    window.addEventListener('keydown', skipNow, { once: true });
    window.addEventListener('pointerdown', skipNow, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skipNow);
      window.removeEventListener('pointerdown', skipNow);
      anims.forEach((a) => a.cancel());
    };
  }, [skip, onDone]);

  const part = (id: keyof typeof LOGO, fill: string) => <path data-part={id} d={LOGO[id]} fill={fill} fillRule="evenodd" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />;
  return (
    <svg ref={svg} viewBox={LOGO_VIEWBOX} className={className} role="img" aria-label="Mercearia Saudável" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id="intro-glow">
          <stop offset="0" stopColor={BRAND_ORANGE} stopOpacity=".55" />
          <stop offset="1" stopColor={BRAND_ORANGE} stopOpacity="0" />
        </radialGradient>
        {/* Máscaras que "escrevem" as palavras: crescem da esquerda para a direita. */}
        <clipPath id="intro-top">
          <rect data-part="top-clip" x="180" y="0" width="1640" height="420" style={{ transformBox: 'fill-box', transformOrigin: 'left center', transform: skip ? undefined : 'scaleX(0)' }} />
        </clipPath>
        <clipPath id="intro-bot">
          <rect data-part="bot-clip" x="260" y="1560" width="1500" height="582" style={{ transformBox: 'fill-box', transformOrigin: 'left center', transform: skip ? undefined : 'scaleX(0)' }} />
        </clipPath>
      </defs>
      <circle data-part="glow" cx="1000" cy="1050" r="640" fill="url(#intro-glow)" opacity="0" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      <g data-part="quads" opacity={skip ? 0 : 1}>
        {part('tl', BRAND_ORANGE)}
        {part('tr', BRAND_ORANGE)}
        {part('bl', BRAND_ORANGE)}
        {part('br', BRAND_ORANGE)}
      </g>
      <path data-part="sym" d={LOGO.sym} fill={BRAND_ORANGE} fillRule="evenodd" opacity={skip ? 1 : 0} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      {part('pl', BRAND_TERRACOTTA)}
      {part('pr', BRAND_TERRACOTTA)}
      <g clipPath="url(#intro-top)">{part('top', BRAND_TERRACOTTA)}</g>
      <g clipPath="url(#intro-bot)">{part('bot', BRAND_TERRACOTTA)}</g>
    </svg>
  );
}
