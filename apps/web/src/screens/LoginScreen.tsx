import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { loginSchema, type LoginResult } from '@mercearia/contracts';
import { api, session } from '../lib/api';
import { BrandMark } from '../brand/Brand';
import { LogoIntro } from '../brand/LogoIntro';
import { ErrorBox, Field } from '../components/ui';

/**
 * Entrada da equipe: a logo se monta no centro (motion) e sobe, abrindo o
 * campo de e-mail e senha.
 */
export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const onDone = useCallback(() => setReady(true), []);
  const emailRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ready) window.setTimeout(() => emailRef.current?.focus({ preventScroll: true }), 450);
  }, [ready]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(new Error(parsed.error.issues[0]?.message ?? 'Confira os dados'));
      return;
    }
    setBusy(true);
    try {
      const result = await api<LoginResult>('/auth/login', { method: 'POST', json: parsed.data });
      session.save(result.accessToken, result.user);
      onSignedIn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-cream px-4 py-10">
      {/* Folhas da marca, grandes e bem claras, ao fundo. */}
      <BrandMark className="pointer-events-none absolute -left-40 -top-40 h-[30rem] w-[30rem] opacity-[0.07]" />
      <BrandMark className="pointer-events-none absolute -bottom-48 -right-40 h-[34rem] w-[34rem] opacity-[0.07]" />
      <div className="relative flex w-full max-w-sm flex-col items-center">
        <LogoIntro onDone={onDone} className={`transition-all duration-700 ease-out ${ready ? 'w-36' : 'w-[min(78vw,22rem)]'}`} />
        <div className={`grid w-full transition-all duration-700 ease-out ${ready ? 'mt-6 grid-rows-[1fr] opacity-100' : 'mt-0 grid-rows-[0fr] opacity-0'}`} aria-hidden={!ready}>
          <div className="-mx-4 overflow-hidden px-4 pb-8">
            <form onSubmit={submit} className="card space-y-4 p-7 shadow-xl shadow-brand/10">
              <div className="text-center">
                <h1 className="font-display text-2xl font-semibold text-ink">Boas-vindas</h1>
                <p className="mt-1 text-sm text-ink-soft">Caixa, estoque, clube e metas da loja</p>
              </div>
              <Field label="E-mail">
                <input className="input" type="email" autoComplete="username" ref={emailRef} value={email} onChange={(e) => setEmail(e.target.value)} tabIndex={ready ? 0 : -1} />
              </Field>
              <Field label="Senha">
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} tabIndex={ready ? 0 : -1} />
              </Field>
              <ErrorBox error={error} />
              <button className="btn-primary w-full py-2.5 text-base" disabled={busy} tabIndex={ready ? 0 : -1}>
                {busy ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          </div>
        </div>
        {!ready && <p className="absolute -bottom-10 text-xs text-ink-soft/70">toque para pular</p>}
      </div>
    </div>
  );
}
