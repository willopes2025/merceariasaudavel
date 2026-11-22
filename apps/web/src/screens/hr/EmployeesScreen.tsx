import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CONTRACT_TYPES, formatMoney, todayBR, type ContractType, type Employee, type HrConfig, type Shift, type Store, type WorkSchedule } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
type Aba = 'pessoas' | 'escalas' | 'ponto';
type Form = { id: string | null; name: string; cpf: string; role: string; phone: string; email: string; birthDate: string; admission: string; dismissal: string; contract: ContractType; salary: string; payDay: string; pixKey: string; storeId: string; userId: string; scheduleId: string; clocks: boolean; pin: string; notes: string; active: boolean; hasPin: boolean };
const vazio: Form = { id: null, name: '', cpf: '', role: '', phone: '', email: '', birthDate: '', admission: todayBR(), dismissal: '', contract: 'clt', salary: '', payDay: '5', pixKey: '', storeId: '', userId: '', scheduleId: '', clocks: true, pin: '', notes: '', active: true, hasPin: false };

/** Funcionários: cadastro, escalas de trabalho e as regras do ponto. */
export function EmployeesScreen() {
  const [aba, setAba] = useState<Aba>('pessoas');
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Funcionários" subtitle="Cadastro da equipe (dados, cargo, salário, escala), as escalas de trabalho e as regras do ponto. O salário cadastrado vira conta a pagar em Ponto › Mês e folha." />
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {([['pessoas', 'Equipe'], ['escalas', 'Escalas'], ['ponto', 'Regras do ponto']] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === k ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {aba === 'pessoas' ? <Pessoas /> : aba === 'escalas' ? <Escalas /> : <RegrasPonto />}
    </div>
  );
}

function Pessoas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rh', 'funcionarios'], queryFn: () => api<Employee[]>('/hr/employees') });
  const [form, setForm] = useState<Form | null>(null);
  const [inativos, setInativos] = useState(false);
  const lista = (q.data ?? []).filter((e) => inativos || e.active);
  const editar = (e: Employee) => setForm({ id: e.id, name: e.name, cpf: e.cpf ?? '', role: e.role ?? '', phone: e.phone ?? '', email: e.email ?? '', birthDate: e.birthDate ?? '', admission: e.admission, dismissal: e.dismissal ?? '', contract: e.contract, salary: e.salary ? String(e.salary).replace('.', ',') : '', payDay: String(e.payDay), pixKey: e.pixKey ?? '', storeId: e.storeId ?? '', userId: e.userId ?? '', scheduleId: e.scheduleId ?? '', clocks: e.clocks, pin: '', notes: e.notes ?? '', active: e.active, hasPin: e.hasPin });
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="text-sm text-ink-soft">{lista.filter((e) => e.active).length} ativo(s) · folha de {formatMoney(lista.filter((e) => e.active).reduce((s, e) => s + e.salary, 0))}/mês</span>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar desligados</label>
        <button className="btn-primary" onClick={() => setForm(vazio)}>Novo funcionário</button>
      </div>
      <ErrorBox error={q.error} />
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : !lista.length ? <Empty>Nenhum funcionário cadastrado.</Empty> : (
          <table className="table">
            <thead><tr><th>Nome</th><th>Cargo</th><th>Vínculo</th><th>Admissão</th><th>Escala</th><th>Ponto</th><th className="text-right">Salário</th><th /></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className={e.active ? '' : 'opacity-60'}>
                  <td><div className="font-medium">{e.name}</div><div className="text-xs text-ink-soft">{[e.storeName, e.phone, e.userName && `login: ${e.userName}`].filter(Boolean).join(' · ')}</div></td>
                  <td>{e.role ?? '—'}</td>
                  <td>{CONTRACT_TYPES[e.contract]}</td>
                  <td className="tabular-nums">{formatDay(e.admission)}{e.dismissal && <div className="text-xs text-red-700">desligado {formatDay(e.dismissal)}</div>}</td>
                  <td>{e.scheduleName ?? <span className="text-amber-700">sem escala</span>}</td>
                  <td className="text-sm">{!e.clocks ? 'não bate' : e.userId && e.hasPin ? 'login e PIN' : e.userId ? 'pelo login' : e.hasPin ? 'PIN na loja' : <span className="text-amber-700">falta PIN ou login</span>}</td>
                  <td className="text-right tabular-nums">{e.salary ? formatMoney(e.salary) : '—'}</td>
                  <td className="text-right"><button className="text-sm text-brand" onClick={() => editar(e)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {form && <EditarPessoa form={form} onClose={() => setForm(null)} onDone={() => { setForm(null); qc.invalidateQueries({ queryKey: ['rh'] }); }} />}
    </>
  );
}

function EditarPessoa({ form, onClose, onDone }: { form: Form; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState(form);
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const escalas = useQuery({ queryKey: ['rh', 'escalas'], queryFn: () => api<WorkSchedule[]>('/hr/schedules') });
  const users = useQuery({ queryKey: ['users', 'rh'], queryFn: () => api<Array<{ id: string; name: string; active: boolean }>>('/users'), enabled: can('user.manage') });
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const salvar = useMutation({
    mutationFn: () => api(f.id ? `/hr/employees/${f.id}` : '/hr/employees', { method: f.id ? 'PUT' : 'POST', json: { name: f.name, cpf: f.cpf || null, role: f.role || null, phone: f.phone || null, email: f.email || null, birthDate: f.birthDate || null, admission: f.admission, dismissal: f.dismissal || null, contract: f.contract, salary: f.salary || '0', payDay: f.payDay, pixKey: f.pixKey || null, storeId: f.storeId || null, userId: f.userId || null, scheduleId: f.scheduleId || null, clocks: f.clocks, pin: f.pin || null, notes: f.notes || null, active: f.active } }),
    onSuccess: onDone,
  });
  return (
    <Drawer title={f.id ? 'Editar funcionário' : 'Novo funcionário'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome completo"><input className="input" value={f.name} onChange={set('name')} autoFocus /></Field>
          <Field label="CPF"><input className="input" inputMode="numeric" value={f.cpf} onChange={set('cpf')} /></Field>
          <Field label="Cargo"><input className="input" value={f.role} onChange={set('role')} placeholder="Ex.: Atendente" /></Field>
          <Field label="Vínculo"><select className="input" value={f.contract} onChange={set('contract')}>{Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Celular"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input className="input" value={f.email} onChange={set('email')} /></Field>
          <Field label="Nascimento"><input type="date" className="input" value={f.birthDate} onChange={set('birthDate')} /></Field>
          <Field label="Loja"><select className="input" value={f.storeId} onChange={set('storeId')}><option value="">Todas</option>{stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Admissão"><input type="date" className="input" value={f.admission} onChange={set('admission')} /></Field>
          <Field label="Desligamento"><input type="date" className="input" value={f.dismissal} onChange={set('dismissal')} /></Field>
          <Field label="Salário (R$)"><input className="input tabular-nums" inputMode="decimal" value={f.salary} onChange={set('salary')} placeholder="0,00" /></Field>
          <Field label="Dia do pagamento"><input className="input w-24" type="number" min={1} max={31} value={f.payDay} onChange={set('payDay')} /></Field>
          <Field label="Chave Pix"><input className="input" value={f.pixKey} onChange={set('pixKey')} /></Field>
          <Field label="Escala de trabalho"><select className="input" value={f.scheduleId} onChange={set('scheduleId')}><option value="">Sem escala</option>{escalas.data?.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field>
        </div>
        <div className="space-y-3 rounded-lg bg-cream p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.clocks} onChange={(e) => setF({ ...f, clocks: e.target.checked })} /> Bate ponto</label>
          {f.clocks && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Login no sistema" hint="Com login, a pessoa bate o ponto no próprio celular.">
                <select className="input" value={f.userId} onChange={set('userId')} disabled={!can('user.manage')}><option value="">Sem login</option>{users.data?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              </Field>
              <Field label="PIN do ponto" hint={f.hasPin ? 'Já tem PIN. Preencha só para trocar.' : '4 a 6 números, para bater no aparelho da loja.'}>
                <input className="input w-32 tabular-nums" inputMode="numeric" maxLength={6} value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} placeholder={f.hasPin ? '••••' : ''} />
              </Field>
            </div>
          )}
        </div>
        <Field label="Observações"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo</label>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || f.name.trim().length < 3} onClick={() => salvar.mutate()}>Salvar</button>
      </div>
    </Drawer>
  );
}

const comercial: Shift = { entrada: '08:00', saidaIntervalo: '12:00', voltaIntervalo: '13:00', saida: '17:00' };

function Escalas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rh', 'escalas'], queryFn: () => api<WorkSchedule[]>('/hr/schedules') });
  const [f, setF] = useState<(Omit<WorkSchedule, 'id'> & { id: string | null }) | null>(null);
  const salvar = useMutation({ mutationFn: () => api(f!.id ? `/hr/schedules/${f!.id}` : '/hr/schedules', { method: f!.id ? 'PUT' : 'POST', json: { name: f!.name, days: f!.days, tolerancePunch: f!.tolerancePunch, toleranceDay: f!.toleranceDay, active: f!.active } }), onSuccess: () => { setF(null); qc.invalidateQueries({ queryKey: ['rh'] }); } });
  const resumo = (e: WorkSchedule) => DIAS.map((d, i) => (e.days[i] ? `${d.slice(0, 3)} ${e.days[i]!.entrada}–${e.days[i]!.saida}` : null)).filter(Boolean).join(' · ');
  const mudar = (i: number, campo: keyof Shift, v: string) => setF({ ...f!, days: f!.days.map((t, n) => (n === i && t ? { ...t, [campo]: v || null } : t)) });
  return (
    <>
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setF({ id: null, name: '', days: [null, comercial, comercial, comercial, comercial, comercial, { entrada: '08:00', saida: '12:00' }], tolerancePunch: 5, toleranceDay: 10, active: true })}>Nova escala</button></div>
      <ErrorBox error={q.error} />
      <div className="space-y-2">
        {q.isLoading ? <Loading /> : !q.data?.length ? <div className="card"><Empty>Nenhuma escala. Crie a primeira (ex.: "Comercial" ou "Turno da tarde") e ligue aos funcionários.</Empty></div> : q.data.map((e) => (
          <div key={e.id} className={`card flex items-center gap-3 p-4 ${e.active ? '' : 'opacity-60'}`}>
            <div className="flex-1"><b>{e.name}</b><div className="text-sm text-ink-soft">{resumo(e)}</div></div>
            <button className="text-sm text-brand" onClick={() => setF({ ...e })}>Editar</button>
          </div>
        ))}
      </div>
      {f && (
        <Drawer title={f.id ? 'Editar escala' : 'Nova escala'} onClose={() => setF(null)} wide>
          <div className="space-y-4">
            <Field label="Nome"><input className="input max-w-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Comercial" autoFocus /></Field>
            <table className="table">
              <thead><tr><th>Dia</th><th>Trabalha</th><th>Entrada</th><th>Sai p/ intervalo</th><th>Volta</th><th>Saída</th></tr></thead>
              <tbody>
                {DIAS.map((d, i) => {
                  const t = f.days[i];
                  return (
                    <tr key={d}>
                      <td>{d}</td>
                      <td><input type="checkbox" aria-label={`Trabalha ${d}`} checked={!!t} onChange={(e) => setF({ ...f, days: f.days.map((x, n) => (n === i ? (e.target.checked ? comercial : null) : x)) })} /></td>
                      {(['entrada', 'saidaIntervalo', 'voltaIntervalo', 'saida'] as const).map((c) => <td key={c}>{t && <input type="time" className="input w-28" aria-label={`${c} ${d}`} value={t[c] ?? ''} onChange={(e) => mudar(i, c, e.target.value)} />}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tolerância por batida (min)" hint="CLT: até 5 minutos."><input type="number" className="input w-24" min={0} max={30} value={f.tolerancePunch} onChange={(e) => setF({ ...f, tolerancePunch: Number(e.target.value) })} /></Field>
              <Field label="Tolerância no dia (min)" hint="CLT: até 10 minutos."><input type="number" className="input w-24" min={0} max={60} value={f.toleranceDay} onChange={(e) => setF({ ...f, toleranceDay: Number(e.target.value) })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativa</label>
            <ErrorBox error={salvar.error} />
            <button className="btn-primary w-full" disabled={salvar.isPending || f.name.trim().length < 2} onClick={() => salvar.mutate()}>Salvar</button>
          </div>
        </Drawer>
      )}
    </>
  );
}

interface Local { id: string; name: string; latitude: number; longitude: number; radiusM: number; active: boolean }

function RegrasPonto() {
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['rh', 'config'], queryFn: () => api<HrConfig>('/hr/config') });
  const locais = useQuery({ queryKey: ['rh', 'locais'], queryFn: () => api<Local[]>('/hr/places') });
  const ano = Number(todayBR().slice(0, 4));
  const feriados = useQuery({ queryKey: ['rh', 'feriados', ano], queryFn: () => api<Array<{ id: string | null; date: string; name: string; national: boolean }>>(`/hr/holidays?year=${ano}`) });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['rh'] });
  const salvarCfg = useMutation({ mutationFn: (d: HrConfig) => api('/hr/config', { method: 'PUT', json: d }), onSuccess: atualizar });
  const [local, setLocal] = useState({ name: '', latitude: '', longitude: '', radiusM: '150' });
  const [erroGps, setErroGps] = useState<string | null>(null);
  const salvarLocal = useMutation({ mutationFn: () => api('/hr/places', { method: 'POST', json: { name: local.name, latitude: Number(local.latitude), longitude: Number(local.longitude), radiusM: Number(local.radiusM) } }), onSuccess: () => { setLocal({ name: '', latitude: '', longitude: '', radiusM: '150' }); atualizar(); } });
  const mudarLocal = useMutation({ mutationFn: (l: Local) => api(`/hr/places/${l.id}`, { method: 'PUT', json: { name: l.name, latitude: l.latitude, longitude: l.longitude, radiusM: l.radiusM, active: !l.active } }), onSuccess: atualizar });
  const [fer, setFer] = useState({ date: '', name: '' });
  const salvarFer = useMutation({ mutationFn: () => api('/hr/holidays', { method: 'POST', json: fer }), onSuccess: () => { setFer({ date: '', name: '' }); atualizar(); } });
  const apagarFer = useMutation({ mutationFn: (id: string) => api(`/hr/holidays/${id}`, { method: 'DELETE' }), onSuccess: atualizar });
  const aqui = () => navigator.geolocation?.getCurrentPosition((p) => { setErroGps(null); setLocal((l) => ({ ...l, latitude: p.coords.latitude.toFixed(6), longitude: p.coords.longitude.toFixed(6) })); }, () => setErroGps('Não consegui pegar a localização. Libere no navegador.'), { enableHighAccuracy: true, timeout: 10000 });
  if (cfg.isLoading) return <Loading />;
  const c = cfg.data ?? { photo: false, fence: 'avisar' as const };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-4 p-5">
        <h2 className="font-display text-lg text-ink">Como o ponto é batido</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.photo} onChange={(e) => salvarCfg.mutate({ ...c, photo: e.target.checked })} /> Exigir foto em cada batida</label>
        <Field label="Fora do local de trabalho (GPS)">
          <select className="input max-w-sm" value={c.fence} onChange={(e) => salvarCfg.mutate({ ...c, fence: e.target.value as HrConfig['fence'] })}>
            <option value="avisar">Deixa bater e marca “fora do local”</option>
            <option value="bloquear">Não deixa bater</option>
            <option value="desligada">Não conferir a localização</option>
          </select>
        </Field>
        <p className="text-xs text-ink-soft">Cada batida grava a hora do servidor, um número sequencial e um código que encadeia com a batida anterior: ela nunca é alterada. Correção é sempre um ajuste com motivo, que aparece no espelho.</p>
        <ErrorBox error={salvarCfg.error} />
        <h3 className="pt-2 font-medium text-ink">Locais de trabalho</h3>
        {locais.data?.map((l) => (
          <div key={l.id} className={`flex items-center gap-2 text-sm ${l.active ? '' : 'opacity-50'}`}>
            <span className="flex-1">{l.name} <span className="text-ink-soft">· raio de {l.radiusM} m</span></span>
            <button className="text-ink-soft hover:text-ink" onClick={() => mudarLocal.mutate(l)}>{l.active ? 'Desativar' : 'Ativar'}</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <input className="input col-span-2" placeholder="Nome (ex.: Loja Centro)" value={local.name} onChange={(e) => setLocal({ ...local, name: e.target.value })} />
          <input className="input" placeholder="Latitude" value={local.latitude} onChange={(e) => setLocal({ ...local, latitude: e.target.value })} />
          <input className="input" placeholder="Longitude" value={local.longitude} onChange={(e) => setLocal({ ...local, longitude: e.target.value })} />
          <input className="input" type="number" placeholder="Raio (m)" value={local.radiusM} onChange={(e) => setLocal({ ...local, radiusM: e.target.value })} />
          <button className="btn-ghost" onClick={aqui}>Usar onde estou agora</button>
          <button className="btn-primary col-span-2" disabled={salvarLocal.isPending || !local.name.trim() || !local.latitude || !local.longitude} onClick={() => salvarLocal.mutate()}>Adicionar local</button>
        </div>
        {erroGps && <p className="text-sm text-red-700">{erroGps}</p>}
        <ErrorBox error={salvarLocal.error} />
      </div>
      <div className="card space-y-3 p-5">
        <h2 className="font-display text-lg text-ink">Feriados de {ano}</h2>
        <p className="text-xs text-ink-soft">Os nacionais já vêm. Cadastre os estaduais e municipais: trabalhar em feriado conta como hora extra a 100%.</p>
        <div className="flex gap-2">
          <input type="date" className="input w-40" value={fer.date} onChange={(e) => setFer({ ...fer, date: e.target.value })} />
          <input className="input" placeholder="Nome do feriado" value={fer.name} onChange={(e) => setFer({ ...fer, name: e.target.value })} />
          <button className="btn-primary" disabled={!fer.date || fer.name.trim().length < 2 || salvarFer.isPending} onClick={() => salvarFer.mutate()}>Adicionar</button>
        </div>
        <ErrorBox error={salvarFer.error} />
        <div className="max-h-96 space-y-1 overflow-y-auto text-sm">
          {feriados.data?.map((f) => (
            <div key={f.date + f.name} className="flex items-center gap-2">
              <span className="w-24 tabular-nums">{formatDay(f.date)}</span>
              <span className="flex-1">{f.name}</span>
              {f.national ? <span className="text-xs text-ink-soft">nacional</span> : <button className="text-xs text-ink-soft hover:text-red-600" onClick={() => f.id && apagarFer.mutate(f.id)}>remover</button>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
