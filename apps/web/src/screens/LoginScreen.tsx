import { useState, type FormEvent } from 'react';
import { loginSchema, type LoginResult } from '@mercearia/contracts';
import { api, session } from '../lib/api';
import { Logo } from '../components/AppShell';
import { ErrorBox, Field } from '../components/ui';

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="flex min-h-full items-center justify-center bg-brand px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-8">
        <div className="mb-2">
          <Logo />
          <p className="mt-2 text-sm text-ink-soft">Caixa, estoque, clube e metas da loja</p>
        </div>
        <Field label="E-mail">
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Senha">
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
