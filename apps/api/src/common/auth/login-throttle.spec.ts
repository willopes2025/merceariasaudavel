import { describe, expect, it } from 'vitest';
import { LoginThrottle } from './login-throttle';

describe('freio de login', () => {
  it('cinco erros seguidos param o e-mail por 15 minutos; acerto zera', () => {
    const t = new LoginThrottle();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) t.fail('Ana@Soul.demo', now + i);
    expect(t.lockedFor('ana@soul.demo', now + 10)).toBe(0);
    t.fail('ana@soul.demo', now + 20);
    expect(t.lockedFor('ana@soul.demo', now + 30)).toBe(15);
    expect(t.lockedFor('ana@soul.demo', now + 15 * 60_000 + 21)).toBe(0);
    t.succeed('ana@soul.demo');
    expect(t.lockedFor('ana@soul.demo', now + 40)).toBe(0);
  });

  it('erros espaçados além da janela não somam', () => {
    const t = new LoginThrottle(3, 1000, 5000);
    t.fail('a@b.c', 0);
    t.fail('a@b.c', 500);
    t.fail('a@b.c', 2000); // janela nova
    expect(t.lockedFor('a@b.c', 2001)).toBe(0);
  });
});
