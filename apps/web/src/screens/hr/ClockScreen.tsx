import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OCCURRENCE_TYPES, formatMoney, todayBR, type ClockToday, type Employee, type Mirror, type MirrorDay, type PunchReceipt } from '@mercearia/contracts';
import { api, can, session } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDay } from '../../components/format';

const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const hm = (min: number) => `${min < 0 ? '−' : ''}${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, '0')}`;
const mesAnterior = () => { const d = new Date(`${todayBR().slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const COR: Record<string, string> = { trabalhando: 'bg-emerald-50 text-emerald-700', saiu: 'bg-slate-100 text-slate-600', atrasado: 'bg-red-50 text-red-700', 'ainda não chegou': 'bg-amber-50 text-amber-700', folga: 'bg-slate-100 text-slate-500' };

// ───────────── Bater o ponto (todo mundo) ─────────────

interface Eu { employee: { id: string; name: string; clocks: boolean } | null; config: { photo: boolean; fence: string }; mirror: Mirror | null }

function posicao(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 });
  });
}

/** Tira uma foto pela câmera da frente (JPEG pequeno em base64). */
function useCamera(ligada: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ligada) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 } }).then((s) => { stream = s; if (video.current) { video.current.srcObject = s; void video.current.play(); } }).catch(() => setErro('Não consegui abrir a câmera. Libere o acesso no navegador.'));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [ligada]);
  const tirar = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    const lado = Math.min(v.videoWidth, v.videoHeight, 360);
    c.width = c.height = lado;
    c.getContext('2d')!.drawImage(v, (v.videoWidth - lado) / 2, (v.videoHeight - lado) / 2, lado, lado, 0, 0, lado, lado);
    return c.toDataURL('image/jpeg', 0.7);
  };
  return { video, tirar, erro };
}

export function PunchScreen() {
  const qc = useQueryClient();
  const mes = todayBR().slice(0, 7);
  const eu = useQuery({ queryKey: ['ponto', 'eu', mes], queryFn: () => api<Eu>(`/hr/clock/me?month=${mes}`) });
  const loja = useQuery({ queryKey: ['ponto', 'loja'], queryFn: () => api<Array<{ id: string; name: string }>>('/hr/clock/kiosk') });
  const [quem, setQuem] = useState('');
  const [pin, setPin] = useState('');
  const [recibo, setRecibo] = useState<PunchReceipt | null>(null);
  const [agora, setAgora] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 1000); return () => clearInterval(t); }, []);
  const comFoto = !!eu.data?.config.photo;
  const cam = useCamera(comFoto);
  const bater = useMutation({
    mutationFn: async (d: { employeeId?: string; pin?: string }) => {
      const foto = comFoto ? cam.tirar() : null;
      if (comFoto && !foto) throw new Error('A câmera ainda não abriu. Espere um instante e tente de novo.');
      const p = eu.data?.config.fence === 'desligada' ? null : await posicao();
      return api<PunchReceipt>('/hr/clock/punch', { method: 'POST', json: { ...d, ...(p ?? {}), photo: foto } });
    },
    onSuccess: (r) => { setRecibo(r); setPin(''); setQuem(''); qc.invalidateQueries({ queryKey: ['ponto'] }); },
  });
  const meu = eu.data?.employee;
  const hoje = eu.data?.mirror?.days.find((d) => d.date === todayBR());
  const fechado = eu.data?.mirror?.closing;
  const ciente = useMutation({ mutationFn: (m: string) => api(`/hr/clock/me/${m}/ack`, { method: 'POST' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ponto'] }) });
  const anterior = useQuery({ queryKey: ['ponto', 'eu', mesAnterior()], queryFn: () => api<Eu>(`/hr/clock/me?month=${mesAnterior()}`), enabled: !!meu });
  const pendente = anterior.data?.mirror?.closing && !anterior.data.mirror.closing.ackAt ? anterior.data.mirror : null;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Bater ponto" subtitle={`Você está como ${session.user()?.name ?? ''}. A hora que vale é a do sistema.`} />
      <div className="card space-y-4 p-6 text-center">
        <div className="font-display text-5xl tabular-nums text-ink">{agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</div>
        <div className="text-sm text-ink-soft">{agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'long' })}</div>
        {comFoto && <video ref={cam.video} muted playsInline className="mx-auto h-40 w-40 rounded-full bg-slate-200 object-cover" />}
        {cam.erro && <p className="text-sm text-red-700">{cam.erro}</p>}
        {recibo && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
            <b>Ponto registrado: {recibo.employee} às {new Date(recibo.at).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</b>
            <div>Batidas de hoje: {recibo.today.join(' · ')}{recibo.outside ? ' · fora do local de trabalho' : recibo.place ? ` · ${recibo.place}` : ''}</div>
            <div className="text-xs">Comprovante nº {recibo.nsr} · código {recibo.hash.slice(0, 16)}…</div>
          </div>
        )}
        <ErrorBox error={bater.error} />
        {meu?.clocks && (
          <div className="space-y-2">
            <button className="btn-primary px-8 py-4 text-lg" disabled={bater.isPending} onClick={() => bater.mutate({})}>{bater.isPending ? 'Registrando…' : `Bater meu ponto (${meu.name.split(' ')[0]})`}</button>
            {hoje && <div className="text-sm text-ink-soft">Hoje: {hoje.punches.filter((p) => !p.ignored).map((p) => p.time).join(' · ') || 'nenhuma batida ainda'}</div>}
          </div>
        )}
        {(loja.data?.length ?? 0) > 0 && (
          <div className="space-y-2 border-t border-slate-200 pt-4 text-left">
            <div className="text-sm font-medium text-ink">Bater com PIN (aparelho da loja)</div>
            <div className="flex flex-wrap gap-2">
              <select className="input w-auto min-w-[200px] flex-1" value={quem} onChange={(e) => setQuem(e.target.value)} aria-label="Funcionário"><option value="">Quem é você?</option>{loja.data!.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              <input className="input w-28 text-center tabular-nums" type="password" inputMode="numeric" maxLength={6} placeholder="PIN" aria-label="PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && quem && pin.length >= 4 && bater.mutate({ employeeId: quem, pin })} />
              <button className="btn-primary" disabled={!quem || pin.length < 4 || bater.isPending} onClick={() => bater.mutate({ employeeId: quem, pin })}>Bater</button>
            </div>
          </div>
        )}
        {!eu.isLoading && !meu && !(loja.data?.length) && <p className="text-sm text-ink-soft">Seu login não está ligado a um cadastro de funcionário, e ninguém tem PIN ainda. O gerente acerta isso em Funcionários.</p>}
      </div>
      {pendente && (
        <div className="card flex flex-wrap items-center gap-3 border-l-4 border-l-brand-accent p-4 text-sm">
          <span className="flex-1">O ponto de <b>{pendente.month.split('-').reverse().join('/')}</b> foi fechado: {hm(pendente.totals.worked)} trabalhadas, saldo {hm(pendente.totals.balance)}. Confira abaixo e confirme.</span>
          <button className="btn-primary" disabled={ciente.isPending} onClick={() => ciente.mutate(pendente.month)}>Li e confirmo</button>
        </div>
      )}
      {(pendente ?? eu.data?.mirror) && <Espelho m={(pendente ?? eu.data!.mirror)!} />}
      {fechado && <p className="text-xs text-ink-soft">Este mês já foi fechado em {formatDay(fechado.closedAt.slice(0, 10))}.</p>}
    </div>
  );
}

function Espelho({ m, aoAjustar, aoDesfazer }: { m: Mirror; aoAjustar?: (d: MirrorDay, recordId?: string) => void; aoDesfazer?: (id: string) => void }) {
  const hoje = todayBR();
  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-slate-200 px-4 py-3 text-sm">
        <b>{m.employee.name}</b>
        <span className="text-ink-soft">{m.month.split('-').reverse().join('/')} · {m.schedule?.name ?? 'sem escala'}</span>
        <span>Previsto {hm(m.totals.expected)}</span><span>Trabalhado {hm(m.totals.worked)}</span><span>Extras {hm(m.totals.extra)}</span><span>Atrasos {hm(m.totals.late)}</span><span>Faltas {m.totals.absences} dia(s)</span>
        <span className={m.totals.balance < 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>Saldo {hm(m.totals.balance)}</span>
        {m.totals.pending > 0 && <span className="text-amber-700">{m.totals.pending} dia(s) com batida faltando</span>}
      </div>
      <table className="table">
        <thead><tr><th>Dia</th><th>Batidas</th><th className="text-right">Previsto</th><th className="text-right">Trabalhado</th><th className="text-right">Extra</th><th className="text-right">Falta/atraso</th><th>Observações</th>{aoAjustar && <th />}</tr></thead>
        <tbody>
          {m.days.filter((d) => d.date <= hoje).map((d) => (
            <tr key={d.date} className={d.pending ? 'bg-amber-50/60' : d.absent ? 'bg-red-50/50' : d.weekday === 0 || d.holiday ? 'bg-cream/50' : ''}>
              <td className="whitespace-nowrap tabular-nums">{d.date.slice(8)}/{d.date.slice(5, 7)} <span className="text-xs text-ink-soft">{DIA[d.weekday]}</span></td>
              <td className="tabular-nums">
                {d.punches.map((p, i) => (
                  <span key={i} className={`mr-2 ${p.ignored ? 'text-ink-soft line-through' : p.origin === 'incluida' ? 'text-brand' : ''}`} title={[p.origin === 'incluida' ? 'Incluída pelo gestor' : null, p.reason, p.outside ? 'Fora do local' : null].filter(Boolean).join(' · ') || undefined}>
                    {p.time}{p.origin === 'incluida' ? '*' : ''}{p.outside ? '⚠' : ''}
                    {aoAjustar && p.id && p.origin === 'original' && !p.ignored && <button className="ml-0.5 text-xs text-ink-soft hover:text-red-600" title="Desconsiderar esta batida" onClick={() => aoAjustar(d, p.id!)}>×</button>}
                    {aoDesfazer && p.adjustmentId && <button className="ml-0.5 text-xs text-ink-soft hover:text-brand" title="Desfazer o ajuste" onClick={() => aoDesfazer(p.adjustmentId!)}>↺</button>}
                  </span>
                ))}
                {!d.punches.length && <span className="text-ink-soft">—</span>}
              </td>
              <td className="text-right tabular-nums">{d.expected ? hm(d.expected) : ''}</td>
              <td className="text-right tabular-nums">{d.worked ? hm(d.worked) : ''}</td>
              <td className="text-right tabular-nums text-emerald-700">{d.extra ? hm(d.extra) : ''}</td>
              <td className="text-right tabular-nums text-red-700">{d.missing + d.late ? hm(d.missing + d.late) : ''}</td>
              <td className="text-xs text-ink-soft">{[d.holiday, d.occurrence, d.absent ? 'Falta' : null, d.pending ? 'Falta uma batida' : null, ...d.warnings].filter(Boolean).join(' · ')}</td>
              {aoAjustar && <td className="text-right"><button className="text-xs text-brand" onClick={() => aoAjustar(d)}>+ batida</button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-ink-soft">* batida incluída pelo gestor (com motivo) · riscada = desconsiderada · ⚠ fora do local</p>
    </div>
  );
}

// ───────────── Gestão do ponto ─────────────

type Aba = 'hoje' | 'espelho' | 'mes';

export function ClockScreen() {
  const [aba, setAba] = useState<Aba>('hoje');
  const [func, setFunc] = useState('');
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Ponto" subtitle="Quem está trabalhando agora, o espelho de cada pessoa (com ajustes e ocorrências) e o fechamento do mês com a folha." />
      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {([['hoje', 'Hoje'], ['espelho', 'Espelho'], ['mes', 'Mês e folha']] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${aba === k ? 'border-brand text-brand' : 'border-transparent text-ink-soft hover:text-ink'}`}>{t}</button>
        ))}
      </div>
      {aba === 'hoje' ? <Hoje abrir={(id) => { setFunc(id); setAba('espelho'); }} /> : aba === 'espelho' ? <EspelhoGestao func={func} setFunc={setFunc} /> : <Mes abrir={(id) => { setFunc(id); setAba('espelho'); }} />}
    </div>
  );
}

function Hoje({ abrir }: { abrir: (id: string) => void }) {
  const q = useQuery({ queryKey: ['rh', 'hoje'], queryFn: () => api<ClockToday[]>('/hr/clock/today'), refetchInterval: 30_000 });
  if (q.isLoading) return <Loading />;
  if (!q.data?.length) return <div className="card"><Empty>Ninguém bate ponto ainda. Cadastre a equipe em Funcionários.</Empty></div>;
  const conta = (s: string) => q.data!.filter((x) => x.status === s).length;
  return (
    <>
      <div className="flex flex-wrap gap-4 text-sm"><span><b>{conta('trabalhando')}</b> trabalhando</span><span><b>{conta('atrasado')}</b> atrasado(s)</span><span><b>{conta('ainda não chegou')}</b> ainda não chegaram</span><span><b>{conta('saiu')}</b> já saíram</span></div>
      <ErrorBox error={q.error} />
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Funcionário</th><th>Turno de hoje</th><th>Batidas</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {q.data.map((e) => (
              <tr key={e.id}>
                <td><div className="font-medium">{e.name}</div><div className="text-xs text-ink-soft">{e.role}</div></td>
                <td className="tabular-nums">{e.shift ? `${e.shift.entrada} – ${e.shift.saida}` : 'folga'}</td>
                <td className="tabular-nums">{e.punches.map((p) => `${p.time}${p.outside ? '⚠' : ''}`).join(' · ') || '—'}</td>
                <td><span className={`badge ${COR[e.status] ?? 'bg-sky-50 text-sky-700'}`}>{e.status}</span></td>
                <td className="text-right"><button className="text-sm text-brand" onClick={() => abrir(e.id)}>Espelho</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function EspelhoGestao({ func, setFunc }: { func: string; setFunc: (id: string) => void }) {
  const qc = useQueryClient();
  const [mes, setMes] = useState(todayBR().slice(0, 7));
  const fs = useQuery({ queryKey: ['rh', 'funcionarios'], queryFn: () => api<Employee[]>('/hr/employees') });
  const id = func || fs.data?.find((e) => e.clocks && e.active)?.id || '';
  const m = useQuery({ queryKey: ['rh', 'espelho', id, mes], queryFn: () => api<Mirror>(`/hr/clock/mirror/${id}?month=${mes}`), enabled: !!id });
  const ocs = useQuery({ queryKey: ['rh', 'ocorrencias', id], queryFn: () => api<Array<{ id: string; typeName: string; from: string; to: string; note: string | null }>>(`/hr/clock/occurrences/${id}`), enabled: !!id });
  const [ajuste, setAjuste] = useState<{ d: MirrorDay; recordId?: string } | null>(null);
  const [oc, setOc] = useState(false);
  const atualizar = () => qc.invalidateQueries({ queryKey: ['rh'] });
  const desfazer = useMutation({ mutationFn: (aid: string) => api(`/hr/clock/adjustments/${aid}`, { method: 'DELETE' }), onSuccess: atualizar });
  const apagarOc = useMutation({ mutationFn: (oid: string) => api(`/hr/clock/occurrences/${oid}`, { method: 'DELETE' }), onSuccess: atualizar });
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Funcionário"><select className="input w-64" value={id} onChange={(e) => setFunc(e.target.value)}>{fs.data?.filter((e) => e.clocks).map((e) => <option key={e.id} value={e.id}>{e.name}{e.active ? '' : ' (desligado)'}</option>)}</select></Field>
        <Field label="Mês"><input type="month" className="input w-40" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Field>
        <button className="btn-ghost mb-0.5" disabled={!id} onClick={() => setOc(true)}>Atestado, férias, falta…</button>
        <button className="btn-ghost mb-0.5" onClick={() => window.print()}>Imprimir</button>
      </div>
      <ErrorBox error={m.error ?? desfazer.error ?? apagarOc.error} />
      {m.data?.closing && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">Mês fechado em {formatDay(m.data.closing.closedAt.slice(0, 10))} · {m.data.closing.ackAt ? `funcionário confirmou em ${formatDay(m.data.closing.ackAt.slice(0, 10))}` : 'aguardando o funcionário confirmar'}. Um ajuste reabre o mês.</div>}
      {!id ? <div className="card"><Empty>Cadastre funcionários que batem ponto.</Empty></div> : m.isLoading ? <Loading /> : m.data && <Espelho m={m.data} aoAjustar={(d, recordId) => setAjuste({ d, recordId })} aoDesfazer={(aid) => desfazer.mutate(aid)} />}
      {(ocs.data?.length ?? 0) > 0 && (
        <div className="card p-4 text-sm">
          <b>Ocorrências</b>
          {ocs.data!.map((o) => (
            <div key={o.id} className="flex items-center gap-2 border-b border-slate-100 py-1 last:border-0">
              <span className="flex-1">{o.typeName} · {formatDay(o.from)}{o.to !== o.from ? ` a ${formatDay(o.to)}` : ''}{o.note ? ` · ${o.note}` : ''}</span>
              <button className="text-xs text-ink-soft hover:text-red-600" onClick={() => window.confirm('Remover esta ocorrência?') && apagarOc.mutate(o.id)}>remover</button>
            </div>
          ))}
        </div>
      )}
      {ajuste && <Ajuste employeeId={id} d={ajuste.d} recordId={ajuste.recordId} onClose={() => setAjuste(null)} onDone={() => { setAjuste(null); atualizar(); }} />}
      {oc && <Ocorrencia employeeId={id} onClose={() => setOc(false)} onDone={() => { setOc(false); atualizar(); }} />}
    </>
  );
}

function Ajuste({ employeeId, d, recordId, onClose, onDone }: { employeeId: string; d: MirrorDay; recordId?: string; onClose: () => void; onDone: () => void }) {
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const salvar = useMutation({ mutationFn: () => api('/hr/clock/adjustments', { method: 'POST', json: recordId ? { employeeId, type: 'desconsiderar', recordId, reason } : { employeeId, type: 'inclusao', date: d.date, time, reason } }), onSuccess: onDone });
  return (
    <Drawer title={recordId ? 'Desconsiderar batida' : `Incluir batida em ${formatDay(d.date)}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">{recordId ? 'A batida original continua guardada; ela só deixa de contar no espelho.' : 'Use quando a pessoa esqueceu de bater. A batida aparece marcada como incluída.'}</p>
        {!recordId && <Field label="Hora"><input type="time" className="input w-32" value={time} onChange={(e) => setTime(e.target.value)} autoFocus /></Field>}
        <Field label="Motivo (aparece no espelho)"><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: esqueceu de bater a volta do almoço" /></Field>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || reason.trim().length < 5 || (!recordId && !time)} onClick={() => salvar.mutate()}>Salvar ajuste</button>
      </div>
    </Drawer>
  );
}

function Ocorrencia({ employeeId, onClose, onDone }: { employeeId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ type: 'atestado', from: todayBR(), to: todayBR(), note: '' });
  const salvar = useMutation({ mutationFn: () => api('/hr/clock/occurrences', { method: 'POST', json: { employeeId, ...f, note: f.note || null } }), onSuccess: onDone });
  return (
    <Drawer title="Nova ocorrência" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Tipo"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(OCCURRENCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v.name}{v.excused ? '' : ' (desconta)'}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="De"><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></Field>
          <Field label="Até"><input type="date" className="input" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <Field label="Observação"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <ErrorBox error={salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending} onClick={() => salvar.mutate()}>Salvar</button>
      </div>
    </Drawer>
  );
}

interface Linha { id: string; name: string; role: string | null; schedule: string | null; totals: Mirror['totals']; closing: Mirror['closing'] }

function Mes({ abrir }: { abrir: (id: string) => void }) {
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesAnterior());
  const q = useQuery({ queryKey: ['rh', 'mes', mes], queryFn: () => api<Linha[]>(`/hr/clock/summary?month=${mes}`) });
  const [msg, setMsg] = useState<string | null>(null);
  const fechar = useMutation({ mutationFn: () => api<{ closed: number; pending: Array<{ name: string; days: number }> }>('/hr/clock/close', { method: 'POST', json: { month: mes } }), onSuccess: (r) => { setMsg(`${r.closed} espelho(s) fechado(s).${r.pending.length ? ` Atenção: ${r.pending.map((p) => `${p.name} (${p.days} dia(s) com batida faltando)`).join(', ')}.` : ''} Cada pessoa confirma em Bater ponto.`); qc.invalidateQueries({ queryKey: ['rh'] }); } });
  const folha = useMutation({ mutationFn: () => api<{ created: number; total: number; skipped: number }>('/hr/payroll', { method: 'POST', json: { month: mes } }), onSuccess: (r) => { setMsg(r.created ? `${r.created} salário(s) lançado(s) em contas a pagar: ${formatMoney(r.total)}.` : 'Os salários deste mês já estavam lançados.'); qc.invalidateQueries({ queryKey: ['payables'] }); } });
  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Mês"><input type="month" className="input w-40" value={mes} onChange={(e) => { if (e.target.value) { setMes(e.target.value); setMsg(null); } }} /></Field>
        <button className="btn-primary mb-0.5" disabled={fechar.isPending} onClick={() => window.confirm(`Fechar o ponto de ${mes.split('-').reverse().join('/')}? Cada funcionário vai conferir e confirmar o espelho.`) && fechar.mutate()}>Fechar o mês</button>
        {can('finance.manage') && <button className="btn-ghost mb-0.5" disabled={folha.isPending} onClick={() => folha.mutate()} title="Cria uma conta a pagar por funcionário, com o salário cadastrado">Lançar salários em contas a pagar</button>}
      </div>
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status">{msg}</div>}
      <ErrorBox error={q.error ?? fechar.error ?? folha.error} />
      <div className="card overflow-x-auto">
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Ninguém com ponto neste mês.</Empty> : (
          <table className="table">
            <thead><tr><th>Funcionário</th><th className="text-right">Previsto</th><th className="text-right">Trabalhado</th><th className="text-right">Extras</th><th className="text-right">Atrasos</th><th className="text-right">Faltas</th><th className="text-right">Saldo</th><th>Fechamento</th><th /></tr></thead>
            <tbody>
              {q.data.map((l) => (
                <tr key={l.id}>
                  <td><div className="font-medium">{l.name}</div><div className="text-xs text-ink-soft">{[l.role, l.schedule].filter(Boolean).join(' · ')}</div></td>
                  <td className="text-right tabular-nums">{hm(l.totals.expected)}</td>
                  <td className="text-right tabular-nums">{hm(l.totals.worked)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{l.totals.extra ? hm(l.totals.extra) : ''}</td>
                  <td className="text-right tabular-nums">{l.totals.late ? hm(l.totals.late) : ''}</td>
                  <td className="text-right tabular-nums">{l.totals.absences || ''}</td>
                  <td className={`text-right tabular-nums font-medium ${l.totals.balance < 0 ? 'text-red-700' : ''}`}>{hm(l.totals.balance)}</td>
                  <td className="text-sm">{l.totals.pending ? <span className="text-amber-700">{l.totals.pending} dia(s) pendente(s)</span> : l.closing ? (l.closing.ackAt ? 'Fechado e confirmado' : 'Fechado, falta confirmar') : 'Aberto'}</td>
                  <td className="text-right"><button className="text-sm text-brand" onClick={() => abrir(l.id)}>Espelho</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-ink-soft">O sistema calcula as horas pelas regras da CLT (tolerância de 5 min por batida e 10 no dia, extra a 100% em domingo fora da escala e feriado). O cálculo da folha (INSS, FGTS, adicionais) continua com a contabilidade: mande este resumo para ela.</p>
    </>
  );
}
