import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FISCAL_ENVIRONMENTS, fiscalConfigSchema, type FiscalConfig, type FiscalEnvironment } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { Drawer, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';

/** Configuração fiscal por loja. Nada é emitido enquanto a loja não estiver "Pronta". */
export function FiscalSettingsScreen() {
  const client = useQueryClient();
  const configs = useQuery({ queryKey: ['fiscal-config'], queryFn: () => api<FiscalConfig[]>('/fiscal/config') });
  const [editing, setEditing] = useState<FiscalConfig | null>(null);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Configuração fiscal" subtitle="NFC-e pela Focus NFe. Cada loja (CNPJ) tem a sua configuração; enquanto não estiver pronta, nada é emitido." />
      <div className="card mb-4 p-5 text-sm">
        <h2 className="mb-2 font-semibold">O que fazer antes, no painel da Focus NFe</h2>
        <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
          <li>Cadastrar a empresa (CNPJ, inscrição estadual, regime tributário e endereço).</li>
          <li>Enviar o certificado digital A1 da empresa (arquivo .pfx e a senha).</li>
          <li>Informar o CSC e o ID do CSC da NFC-e, que a SEFAZ do estado fornece.</li>
          <li>Copiar os dois tokens da empresa (homologação e produção) e colar aqui, na loja certa.</li>
        </ol>
        <p className="mt-2 text-ink-soft">Certificado e CSC ficam só na Focus NFe; o Mercearia guarda apenas os tokens, cifrados.</p>
      </div>
      {configs.isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {configs.data?.map((c) => (
            <div key={c.storeId} className="card flex flex-wrap items-start justify-between gap-3 p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{c.storeName}</h2>
                  <StateBadge c={c} />
                </div>
                <div className="mt-1 text-sm text-ink-soft">CNPJ {c.cnpj ?? 'não informado'}</div>
                {!c.ready && (
                  <ul className="mt-2 list-disc pl-5 text-sm text-ink-soft">
                    {c.missing.map((m) => (
                      <li key={m}>Falta {m}.</li>
                    ))}
                  </ul>
                )}
                {!c.cnpj && (
                  <Link to="/configuracoes/lojas" className="mt-1 inline-block text-sm text-brand">
                    Abrir cadastro de lojas
                  </Link>
                )}
              </div>
              <button className="btn-ghost" onClick={() => setEditing(c)}>
                Configurar
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <ConfigDrawer
          config={editing}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            void client.invalidateQueries({ queryKey: ['fiscal-config'] });
            void client.invalidateQueries({ queryKey: ['order-fiscal'] });
            setEditing(c);
          }}
        />
      )}
    </div>
  );
}

function StateBadge({ c }: { c: FiscalConfig }) {
  if (!c.enabled) return <span className="badge bg-slate-100 text-slate-500">Desligada</span>;
  if (!c.ready) return <span className="badge bg-amber-50 text-amber-700">Faltam dados</span>;
  return c.environment === 'producao' ? <span className="badge bg-emerald-50 text-emerald-700">Pronta · produção</span> : <span className="badge bg-sky-50 text-sky-700">Pronta · teste</span>;
}

function ConfigDrawer({ config, onClose, onSaved }: { config: FiscalConfig; onClose: () => void; onSaved: (c: FiscalConfig) => void }) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [autoEmit, setAutoEmit] = useState(config.autoEmit);
  const [environment, setEnvironment] = useState<FiscalEnvironment>(config.environment);
  const [tokenHomologacao, setTokenH] = useState('');
  const [tokenProducao, setTokenP] = useState('');
  const [cfop, setCfop] = useState(config.cfop);
  const [icmsOrigin, setOrigin] = useState(config.icmsOrigin);
  const [icmsCst, setCst] = useState(config.icmsCst);
  const [defaultNcm, setNcm] = useState(config.defaultNcm ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: unknown) => api<FiscalConfig>(`/fiscal/config/${config.storeId}`, { method: 'PUT', json: body }),
    onSuccess: (c) => {
      setTokenH('');
      setTokenP('');
      setSaved(true);
      onSaved(c);
    },
    onError: setError,
  });
  const check = useMutation({ mutationFn: () => api<{ ok: boolean; message: string }>(`/fiscal/config/${config.storeId}/test`, { method: 'POST' }), onSuccess: setTest, onError: setError });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setTest(null);
    // Campo de token em branco = não mexe no que está gravado.
    const parsed = fiscalConfigSchema.safeParse({ enabled, autoEmit, environment, cfop, icmsOrigin, icmsCst, defaultNcm, ...(tokenHomologacao.trim() ? { tokenHomologacao } : {}), ...(tokenProducao.trim() ? { tokenProducao } : {}) });
    if (!parsed.success) return setError(new Error(parsed.error.issues[0]?.message));
    setError(null);
    save.mutate(parsed.data);
  }

  return (
    <Drawer title={`Fiscal · ${config.storeName}`} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4" autoComplete="off">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            Emitir nota fiscal nesta loja
            <span className="block text-xs text-ink-soft">Desmarcado, nenhuma venda desta loja gera nota.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={autoEmit} onChange={(e) => setAutoEmit(e.target.checked)} />
          <span>
            Emitir a NFC-e sozinha ao finalizar a venda no caixa
            <span className="block text-xs text-ink-soft">Desmarcado, a nota é emitida pela tela da venda.</span>
          </span>
        </label>
        <Field label="Ambiente" hint="Comece em homologação: as notas são de teste. Só mude para produção depois de uma nota de teste autorizada.">
          <select className="input" value={environment} onChange={(e) => setEnvironment(e.target.value as FiscalEnvironment)}>
            {Object.entries(FISCAL_ENVIRONMENTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Token de homologação" hint={config.tokenHomologacaoSet ? 'Já gravado. Deixe em branco para manter; cole outro para trocar.' : 'Ainda não gravado. Cole o token da empresa no painel da Focus NFe.'}>
          <input className="input" type="password" autoComplete="off" value={tokenHomologacao} onChange={(e) => setTokenH(e.target.value)} placeholder={config.tokenHomologacaoSet ? '••••••••  (gravado)' : ''} />
        </Field>
        <Field label="Token de produção" hint={config.tokenProducaoSet ? 'Já gravado. Deixe em branco para manter; cole outro para trocar.' : 'Ainda não gravado.'}>
          <input className="input" type="password" autoComplete="off" value={tokenProducao} onChange={(e) => setTokenP(e.target.value)} placeholder={config.tokenProducaoSet ? '••••••••  (gravado)' : ''} />
        </Field>
        <div className="rounded-lg bg-slate-50 p-3">
          <h3 className="mb-2 text-sm font-semibold">Tributação dos itens</h3>
          <p className="mb-3 text-xs text-ink-soft">O padrão serve para comércio no Simples Nacional vendendo dentro do estado. Confirme com a contabilidade antes de ir para produção.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CFOP" hint="5102 = venda de mercadoria">
              <input className="input tabular-nums" inputMode="numeric" value={cfop} onChange={(e) => setCfop(e.target.value)} />
            </Field>
            <Field label="CSOSN / CST" hint="102 = Simples, sem crédito">
              <input className="input tabular-nums" inputMode="numeric" value={icmsCst} onChange={(e) => setCst(e.target.value)} />
            </Field>
            <Field label="Origem da mercadoria" hint="0 = nacional">
              <input className="input tabular-nums" inputMode="numeric" value={icmsOrigin} onChange={(e) => setOrigin(e.target.value)} />
            </Field>
            <Field label="NCM padrão" hint="Usado em item sem NCM no cadastro. Opcional.">
              <input className="input tabular-nums" inputMode="numeric" value={defaultNcm} onChange={(e) => setNcm(e.target.value)} />
            </Field>
          </div>
        </div>
        <ErrorBox error={error} />
        {saved && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Configuração salva.</div>}
        {test && <div className={`rounded-lg p-3 text-sm ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{test.message}</div>}
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn-ghost" disabled={check.isPending} onClick={() => check.mutate()} title="Confere com a Focus NFe o token já salvo. Não emite nota.">
            {check.isPending ? 'Testando…' : 'Testar token salvo'}
          </button>
        </div>
      </form>
    </Drawer>
  );
}
