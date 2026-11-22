import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IMPORT_COLUMNS, type ImportResult } from '@mercearia/contracts';
import { api } from '../../lib/api';
import { ErrorBox, PageHeader } from '../../components/ui';
import { parseCsv } from './csv';

type Tipo = keyof typeof IMPORT_COLUMNS;
const EXEMPLO: Record<Tipo, string> = {
  produtos: 'nome;codigo;codigo_barras;categoria;preco;preco_membro;custo;estoque;ncm;unidade\nWhey Protein 900g;WHEY900;7891234567895;Suplementos;189,90;169,90;110,00;12;21061000;UN\n',
  clientes: 'nome;telefone;email;cpf;nascimento;membro\nMaria da Silva;(27) 99999-1234;maria@exemplo.com;;15/03/1990;sim\n',
};

/** Importação de produtos e clientes por planilha (CSV): confere antes, grava depois. */
export function ImportScreen() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>('produtos');
  const [linhas, setLinhas] = useState<Array<Record<string, string>>>([]);
  const [nome, setNome] = useState('');
  const [resultado, setResultado] = useState<ImportResult | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const enviar = useMutation({
    mutationFn: (dryRun: boolean) => api<ImportResult>('/import', { method: 'POST', json: { kind: tipo, rows: linhas, dryRun } }),
    onSuccess: (r) => { setResultado(r); if (!r.dryRun) qc.invalidateQueries(); },
  });
  const ler = async (f: File) => {
    // Planilha do Excel em CSV costuma vir em Latin-1: se o UTF-8 sair quebrado, lê de novo.
    const buf = await f.arrayBuffer();
    let texto = new TextDecoder('utf-8').decode(buf);
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf);
    setLinhas(parseCsv(texto));
    setNome(f.name);
    setResultado(null);
  };
  const baixarModelo = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + EXEMPLO[tipo]], { type: 'text/csv;charset=utf-8' }));
    a.download = `modelo-${tipo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const colunas = linhas[0] ? Object.keys(linhas[0]) : [];
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Importar planilha" subtitle="Traga produtos ou clientes de outro sistema. Salve a planilha como CSV, confira aqui e só então grave." />
      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {(['produtos', 'clientes'] as Tipo[]).map((t) => <button key={t} className={`px-4 py-2 text-sm capitalize ${tipo === t ? 'bg-brand text-white' : 'bg-white text-ink'}`} onClick={() => { setTipo(t); setLinhas([]); setResultado(null); setNome(''); }}>{t}</button>)}
          </div>
          <button className="btn-ghost" onClick={baixarModelo}>Baixar modelo</button>
          <input ref={arquivo} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); e.target.value = ''; }} />
          <button className="btn-primary" onClick={() => arquivo.current?.click()}>Escolher arquivo CSV</button>
          {nome && <span className="text-sm text-ink-soft">{nome} · {linhas.length} linhas</span>}
        </div>
        <p className="text-sm text-ink-soft">
          Colunas aceitas: <b>{IMPORT_COLUMNS[tipo].join(', ')}</b>. Só "nome" é obrigatória.{' '}
          {tipo === 'produtos' ? 'Produto que já existe (mesmo código ou código de barras) tem só nome, preço, custo e categoria atualizados; o estoque da planilha entra apenas em produto novo. Categoria que não existe é criada.' : 'Cliente com celular ou CPF já cadastrado é pulado. Para virar membro precisa de celular.'}
        </p>
      </div>
      <ErrorBox error={enviar.error} />
      {linhas.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table text-sm">
            <thead><tr><th>#</th>{colunas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{linhas.slice(0, 8).map((l, i) => <tr key={i}><td className="text-ink-soft">{i + 2}</td>{colunas.map((c) => <td key={c}>{l[c]}</td>)}</tr>)}</tbody>
          </table>
          {linhas.length > 8 && <div className="p-3 text-sm text-ink-soft">… e mais {linhas.length - 8} linhas.</div>}
          <div className="flex flex-wrap gap-3 border-t border-slate-200 p-4">
            <button className="btn-ghost" disabled={enviar.isPending} onClick={() => enviar.mutate(true)}>1. Conferir</button>
            <button className="btn-primary" disabled={enviar.isPending || !resultado?.dryRun} onClick={() => window.confirm(`Gravar ${resultado!.created} novos e atualizar ${resultado!.updated}?`) && enviar.mutate(false)}>2. Gravar</button>
            {enviar.isPending && <span className="self-center text-sm text-ink-soft">Processando…</span>}
          </div>
        </div>
      )}
      {resultado && (
        <div className="card space-y-2 p-4">
          <div className={`font-medium ${resultado.dryRun ? 'text-ink' : 'text-emerald-700'}`}>
            {resultado.dryRun ? 'Conferência' : 'Gravado'}: {resultado.created} {resultado.dryRun ? 'serão criados' : 'criados'}, {resultado.updated} {resultado.dryRun ? 'serão atualizados' : 'atualizados'}, {resultado.errors.length} com problema.
          </div>
          {resultado.errors.length > 0 && (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm text-red-700">
              {resultado.errors.map((e, i) => <li key={i}>Linha {e.line}: {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
