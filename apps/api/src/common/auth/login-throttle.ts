/**
 * Freio contra tentativa de senha em sequência: depois de `max` erros para o
 * mesmo e-mail dentro da janela, o login fica parado por `lockMs`. Acertar a
 * senha zera a conta. Em memória: a API roda num processo só; reiniciar
 * libera todo mundo, o que é aceitável para um freio (não é a única defesa).
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; first: number; lockedUntil: number }>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
  ) {}

  private key(email: string) {
    return email.trim().toLowerCase();
  }

  /** Minutos que faltam para poder tentar de novo; 0 = pode tentar. */
  lockedFor(email: string, now = Date.now()): number {
    const row = this.failures.get(this.key(email));
    if (!row || row.lockedUntil <= now) return 0;
    return Math.ceil((row.lockedUntil - now) / 60_000);
  }

  fail(email: string, now = Date.now()): void {
    const k = this.key(email);
    const row = this.failures.get(k);
    const fresh = !row || now - row.first > this.windowMs;
    const next = fresh ? { count: 1, first: now, lockedUntil: 0 } : { ...row, count: row.count + 1 };
    if (next.count >= this.max) next.lockedUntil = now + this.lockMs;
    this.failures.set(k, next);
    // Não deixa o mapa crescer sem fim com e-mails inventados.
    if (this.failures.size > 10_000) for (const [key, v] of this.failures) if (now - v.first > this.windowMs && v.lockedUntil <= now) this.failures.delete(key);
  }

  succeed(email: string): void {
    this.failures.delete(this.key(email));
  }
}
