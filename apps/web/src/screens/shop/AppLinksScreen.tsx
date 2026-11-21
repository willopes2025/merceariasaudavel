import { useState } from 'react';
import { PageHeader } from '../../components/ui';
import { Qr } from '../../shop/parts';

const LINKS = [
  {
    key: 'app',
    title: 'App da cliente (clube)',
    path: '/app',
    where: 'Balcão, caixa, sacola, Instagram e WhatsApp.',
    how: 'A cliente faz o cadastro em 30 segundos, vira membro e passa a ter o cartão com QR no celular. No Android aparece o botão "Instalar"; no iPhone, Compartilhar › Adicionar à Tela de Início.',
  },
  {
    key: 'cardapio',
    title: 'Cardápio com preços',
    path: '/cardapio',
    where: 'Mesas, vitrine, adesivo na porta.',
    how: 'Mostra o preço normal e o de membro lado a lado, com busca e categorias. Não pede login.',
  },
  {
    key: 'totem',
    title: 'Totem / tablet da loja',
    path: '/cardapio?totem=1',
    where: 'Tablet ou TV de toque no salão (navegador em tela cheia).',
    how: 'Letras grandes, QR para virar membro sempre à vista e volta ao começo depois de 90 segundos sem toque.',
  },
] as const;

/** Links públicos do app e do cardápio, com QR pronto para imprimir. */
export function AppLinksScreen() {
  const origin = window.location.origin;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt('Copie o link:', url);
    }
  };
  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="App e cardápio"
        subtitle="Ser membro = ter o app. Imprima os QR e espalhe pela loja."
        action={
          <button className="btn-ghost print:hidden" onClick={() => window.print()}>
            Imprimir QR
          </button>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {LINKS.map((l) => {
          const url = `${origin}${l.path}`;
          return (
            <section key={l.key} className="card flex flex-col items-center p-5 text-center break-inside-avoid">
              <h2 className="font-semibold">{l.title}</h2>
              <Qr value={url} size={180} className="my-3" />
              <p className="break-all font-mono text-xs text-ink-soft">{url.replace(/^https?:\/\//, '')}</p>
              <p className="mt-3 text-sm text-ink">{l.how}</p>
              <p className="mt-2 text-xs text-ink-soft">Onde usar: {l.where}</p>
              <div className="mt-4 flex gap-2 print:hidden">
                <button className="btn-ghost" onClick={() => copy(l.key, url)}>
                  {copied === l.key ? 'Copiado!' : 'Copiar link'}
                </button>
                <a className="btn-ghost" href={l.path} target="_blank" rel="noreferrer">
                  Abrir
                </a>
              </div>
            </section>
          );
        })}
      </div>
      <section className="card p-5 text-sm print:hidden">
        <h2 className="mb-2 font-semibold">Como funciona no caixa</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          <li>No PDV, busque a cliente pelo celular, CPF ou pelo código de 6 letras do cartão do app: o preço de membro entra na hora.</li>
          <li>Cliente que já comprava na loja e quer o app: abra a ficha dela em Clientes e toque em <b className="text-ink">Liberar app (gerar código)</b>. Ela entra com o celular + esse código e cria o PIN.</li>
          <li>Esqueceu o PIN? Mesmo caminho: <b className="text-ink">Gerar código novo</b>.</li>
          <li>Para o produto aparecer bonito no app, preencha descrição e foto no cadastro do produto. Insumos nunca aparecem.</li>
        </ul>
      </section>
    </div>
  );
}
