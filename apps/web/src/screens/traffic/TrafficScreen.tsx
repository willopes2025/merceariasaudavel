import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, formatMoney, todayBR, type Store, type TrafficReport } from '@mercearia/contracts';
import { api, can } from '../../lib/api';
import { Drawer, Empty, ErrorBox, Field, Loading, PageHeader } from '../../components/ui';
import { formatDateTime, formatDay, pct } from '../../components/format';

/** Fluxo de pessoas e conversão do balcão: quantas entraram, quantas compraram e em que horas a loja enche. */
export function TrafficScreen() {
  const qc = useQueryClient();
  const hoje = todayBR();
  const [de, setDe] = useState(addDays(hoje, -6));
  const [ate, setAte] = useState(hoje);
  const [digitar, setDigitar] = useState(false);
  const q = useQuery({ queryKey: ['fluxo-pessoas', de, ate], queryFn: () => api<TrafficReport>(`/traffic/report?from=${de}&to=${ate}`), enabled: de <= ate, refetchInterval: 60_000 });
  const d = q.data;
  const maior = Math.max(1, ...(d?.hours.map((h) => h.entries) ?? [1]));
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader
        title="Câmeras: fluxo e conversão"
        subtitle="Quantas pessoas entraram na loja, quantas compraram no balcão e os horários de pico. Contagem anônima: o sistema recebe só números, nunca imagem nem rosto."
        action={can('goal.manage') ? <button className="btn-primary" onClick={() => setDigitar(true)}>Digitar contagem</button> : undefined}
      />
      <ErrorBox error={q.error} />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="De"><input type="date" className="input w-40" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></Field>
        <Field label="Até"><input type="date" className="input w-40" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></Field>
      </div>
      {q.isLoading ? <Loading /> : d && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cartao rotulo="Pessoas que entraram" valor={d.totals.entries.toLocaleString('pt-BR')} />
            <Cartao rotulo="Vendas no balcão" valor={d.totals.sales.toLocaleString('pt-BR')} detalhe={d.totals.ticket ? `ticket médio ${formatMoney(d.totals.ticket)}` : undefined} />
            <Cartao rotulo="Conversão" valor={d.totals.conversion == null ? '—' : pct(d.totals.conversion)} detalhe="de cada 100 que entram, quantas compram" />
            <Cartao rotulo="Horário de pico" valor={d.peakHour == null ? '—' : `${d.peakHour}h às ${d.peakHour + 1}h`} />
          </div>
          {!d.days.length ? <div className="card"><Empty>Sem contagem no período. Ligue a câmera pelo endereço abaixo ou digite a contagem do dia.</Empty></div> : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card p-4">
                <h2 className="mb-3 font-display text-lg text-ink">Por hora (média do dia)</h2>
                <div className="space-y-1.5">
                  {d.hours.map((h) => (
                    <div key={h.hour} className="flex items-center gap-2 text-sm">
                      <span className="w-9 tabular-nums text-ink-soft">{h.hour}h</span>
                      <div className="h-5 flex-1 rounded bg-slate-100"><div className={`h-5 rounded ${h.hour === d.peakHour ? 'bg-brand' : 'bg-sun'}`} style={{ width: `${(h.entries / maior) * 100}%` }} /></div>
                      <span className="w-28 text-right tabular-nums">{Math.round(h.entries)} pessoas</span>
                      <span className="w-14 text-right tabular-nums text-ink-soft">{h.conversion == null ? '—' : pct(h.conversion)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Dia</th><th className="text-right">Pessoas</th><th className="text-right">Vendas</th><th className="text-right">Conversão</th><th className="text-right">Vendido</th></tr></thead>
                  <tbody>{d.days.map((x) => <tr key={x.day}><td>{formatDay(x.day)}</td><td className="text-right tabular-nums">{x.entries}</td><td className="text-right tabular-nums">{x.sales}</td><td className="text-right tabular-nums font-medium">{x.conversion == null ? '—' : pct(x.conversion)}</td><td className="text-right tabular-nums">{formatMoney(x.revenue)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
          <div className="card space-y-2 p-4 text-sm text-ink-soft">
            <h2 className="font-display text-lg text-ink">Ligar a câmera</h2>
            {d.webhookUrl ? (
              <>
                <p>Configure a câmera com contagem de pessoas (ou o gravador) para chamar este endereço a cada pessoa que entra. Cada chamada conta uma entrada; para mandar várias de uma vez, acrescente <code>?in=5</code>.</p>
                <code className="block break-all rounded bg-slate-100 p-2 text-ink">{d.webhookUrl}</code>
                <p>{d.lastCameraAt ? `Última contagem recebida da câmera: ${formatDateTime(d.lastCameraAt)}.` : 'Nenhuma contagem recebida da câmera ainda.'}</p>
              </>
            ) : (
              <p>A entrada automática está desligada. Para ligar, coloque uma senha em <code>TRAFFIC_SECRET</code> no arquivo <code>.env</code> do servidor e rode a atualização: o endereço para a câmera aparece aqui.</p>
            )}
            <p>A conversão compara só as vendas do <b>balcão</b> (pedido do app e do iFood não passa pela porta) e só nas horas em que houve contagem. Enquanto a câmera não estiver ligada, dá para digitar a contagem do dia.</p>
          </div>
        </>
      )}
      {digitar && <Digitar onClose={() => setDigitar(false)} onDone={() => { setDigitar(false); qc.invalidateQueries({ queryKey: ['fluxo-pessoas'] }); }} />}
    </div>
  );
}

function Cartao({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return <div className="card p-4"><div className="text-xs text-ink-soft">{rotulo}</div><div className="font-display text-2xl text-ink">{valor}</div>{detalhe && <div className="text-xs text-ink-soft">{detalhe}</div>}</div>;
}

const HORAS = Array.from({ length: 16 }, (_, i) => i + 7);

function Digitar({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const lojas = useQuery({ queryKey: ['lojas'], queryFn: () => api<Store[]>('/stores') });
  const [loja, setLoja] = useState('');
  const [dia, setDia] = useState(todayBR());
  const [v, setV] = useState<Record<number, string>>({});
  const id = loja || lojas.data?.find((s) => s.active)?.id || '';
  const atual = useQuery({ queryKey: ['fluxo-dia', id, dia], queryFn: () => api<Array<{ hour: number; entries: number }>>(`/traffic/day?storeId=${id}&day=${dia}`), enabled: !!id });
  useEffect(() => {
    if (atual.data) setV(Object.fromEntries(atual.data.map((h) => [h.hour, String(h.entries)])));
  }, [atual.data]);
  const salvar = useMutation({
    mutationFn: () => api('/traffic/manual', { method: 'PUT', json: { storeId: id, day: dia, hours: HORAS.filter((h) => (v[h] ?? '') !== '').map((h) => ({ hour: h, entries: Number(v[h]) || 0 })) } }),
    onSuccess: onDone,
  });
  const total = HORAS.reduce((s, h) => s + (Number(v[h]) || 0), 0);
  return (
    <Drawer title="Digitar contagem do dia" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loja"><select className="input" value={id} onChange={(e) => setLoja(e.target.value)}>{lojas.data?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Dia"><input type="date" className="input" value={dia} max={todayBR()} onChange={(e) => e.target.value && setDia(e.target.value)} /></Field>
        </div>
        <p className="text-sm text-ink-soft">Quantas pessoas entraram em cada hora. O que você digitar substitui o que havia nessas horas.</p>
        <div className="grid grid-cols-4 gap-2">
          {HORAS.map((h) => <label key={h} className="text-xs text-ink-soft">{h}h<input className="input mt-0.5 text-right tabular-nums" inputMode="numeric" value={v[h] ?? ''} onChange={(e) => setV({ ...v, [h]: e.target.value.replace(/\D/g, '') })} /></label>)}
        </div>
        <div className="text-sm">Total do dia: <b>{total}</b> pessoas</div>
        <ErrorBox error={atual.error ?? salvar.error} />
        <button className="btn-primary w-full" disabled={salvar.isPending || !id || !HORAS.some((h) => (v[h] ?? '') !== '')} onClick={() => salvar.mutate()}>Salvar contagem</button>
      </div>
    </Drawer>
  );
}
