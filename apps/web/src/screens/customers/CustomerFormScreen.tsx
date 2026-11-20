import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  GENDERS,
  UFS,
  customerSchema,
  formatCep,
  formatCpf,
  formatPhone,
  onlyDigits,
  type Customer,
  type CustomerForm,
  type LookupRow,
  type Operation,
  type Store,
} from '@mercearia/contracts';
import { api } from '../../lib/api';
import { ErrorBox, Field, Loading, PageHeader } from '../../components/ui';

type Form = Record<keyof CustomerForm, string | boolean>;

const EMPTY: Form = {
  kind: 'pf', name: '', nickname: '', document: '', rg: '', birthDate: '', gender: '', phone: '', phone2: '', email: '',
  allowWhatsapp: true, allowEmail: true, zip: '', street: '', number: '', complement: '', district: '', city: '', state: '',
  motherName: '', fatherName: '', guardianName: '', profession: '', originId: '', insurancePlanId: '', operationId: '',
  storeId: '', preferredSellerId: '', notes: '', active: true,
};

function fromCustomer(c: Customer): Form {
  const f = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as Array<keyof Form>) {
    const v = c[key as keyof Customer];
    f[key] = typeof v === 'boolean' ? v : v == null ? '' : String(v);
  }
  f.document = c.document ? formatCpf(c.document) : '';
  f.phone = c.phone ? formatPhone(c.phone) : '';
  f.phone2 = c.phone2 ? formatPhone(c.phone2) : '';
  f.zip = c.zip ? formatCep(c.zip) : '';
  return f;
}

interface Duplicate {
  id: string;
  name: string;
  matchedBy: 'document' | 'phone';
}

/** Cadastro e edição do cliente. */
export function CustomerFormScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const editing = Boolean(id);

  const current = useQuery({ queryKey: ['customer', id], queryFn: () => api<Customer>(`/customers/${id}`), enabled: editing });
  const origins = useQuery({ queryKey: ['/customer-origins'], queryFn: () => api<LookupRow[]>('/customer-origins') });
  const plans = useQuery({ queryKey: ['/insurance-plans'], queryFn: () => api<LookupRow[]>('/insurance-plans') });
  const operations = useQuery({ queryKey: ['operations'], queryFn: () => api<Operation[]>('/operations') });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/stores') });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<Array<{ id: string; name: string }>>('/team') });

  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState<unknown>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [cepStatus, setCepStatus] = useState<string>('');

  useEffect(() => {
    if (current.data && !loaded) {
      setForm(fromCustomer(current.data));
      setLoaded(true);
    }
  }, [current.data, loaded]);

  const set = (key: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (key: keyof Form) => (e: { target: { checked: boolean } }) => setForm((f) => ({ ...f, [key]: e.target.checked }));

  /** Ao sair do CPF ou do telefone: já tem alguém com esse dado? */
  async function checkDuplicates() {
    const doc = onlyDigits(String(form.document));
    const tel = onlyDigits(String(form.phone));
    if (doc.length < 11 && tel.length < 10) return setDuplicates([]);
    const params = new URLSearchParams({ document: doc, phone: tel, ...(id ? { except: id } : {}) });
    try {
      setDuplicates(await api<Duplicate[]>(`/customers/lookup?${params}`));
    } catch {
      /* aviso é ajuda, não bloqueio */
    }
  }

  /** CEP preenche rua, bairro, cidade e UF (ViaCEP, serviço público e gratuito). */
  async function fillFromCep() {
    const cep = onlyDigits(String(form.zip));
    if (cep.length !== 8) return;
    setCepStatus('Buscando endereço…');
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await r.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (data.erro) return setCepStatus('CEP não encontrado');
      setForm((f) => ({
        ...f,
        street: f.street || data.logradouro || '',
        district: f.district || data.bairro || '',
        city: data.localidade || f.city,
        state: data.uf || f.state,
      }));
      setCepStatus('');
    } catch {
      setCepStatus('Não deu para buscar o CEP agora; preencha à mão.');
    }
  }

  const save = useMutation({
    mutationFn: (body: unknown) => api<Customer>(editing ? `/customers/${id}` : '/customers', { method: editing ? 'PUT' : 'POST', json: body }),
    onSuccess: (c) => {
      void client.invalidateQueries({ queryKey: ['customers'] });
      void client.invalidateQueries({ queryKey: ['customer-timeline', c.id] });
      client.setQueryData(['customer', c.id], c);
      navigate(`/clientes/${c.id}`);
    },
    onError: setError,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
    const parsed = customerSchema.safeParse(payload);
    if (!parsed.success) {
      setError(new Error(parsed.error.issues[0]?.message));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  }

  if (editing && (current.isLoading || !loaded)) return <Loading />;

  const isPj = form.kind === 'pj';

  return (
    <form onSubmit={submit} className="max-w-4xl space-y-5">
      <PageHeader
        title={editing ? `Editar ${current.data?.name ?? 'cliente'}` : 'Novo cliente'}
        action={
          <div className="flex gap-2">
            <Link className="btn-ghost" to={editing ? `/clientes/${id}` : '/clientes'}>
              Cancelar
            </Link>
            <button className="btn-primary" disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        }
      />
      <ErrorBox error={error} />

      <Section title="Identificação">
        <Field label="Tipo">
          <select className="input" value={String(form.kind)} onChange={set('kind')}>
            <option value="pf">Pessoa física</option>
            <option value="pj">Pessoa jurídica</option>
          </select>
        </Field>
        <Field label={isPj ? 'Razão social' : 'Nome completo'}>
          <input className="input" value={String(form.name)} onChange={set('name')} autoFocus={!editing} />
        </Field>
        <Field label={isPj ? 'CNPJ' : 'CPF'}>
          <input className="input" inputMode="numeric" value={String(form.document)} onChange={set('document')} onBlur={checkDuplicates} />
        </Field>
        <Field label={isPj ? 'Nome fantasia' : 'Apelido / como gosta de ser chamado'}>
          <input className="input" value={String(form.nickname)} onChange={set('nickname')} />
        </Field>
        {!isPj && (
          <>
            <Field label="Data de nascimento">
              <input className="input" type="date" value={String(form.birthDate)} onChange={set('birthDate')} />
            </Field>
            <Field label="Sexo">
              <select className="input" value={String(form.gender)} onChange={set('gender')}>
                <option value="">—</option>
                {Object.entries(GENDERS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="RG">
              <input className="input" value={String(form.rg)} onChange={set('rg')} />
            </Field>
            <Field label="Profissão">
              <input className="input" value={String(form.profession)} onChange={set('profession')} />
            </Field>
          </>
        )}
      </Section>

      {/* Entre o CPF e o WhatsApp: aparece perto de onde a pessoa está digitando. */}
      {duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Parece que este cliente já está cadastrado:</p>
          <ul className="mt-1 list-disc pl-5">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link className="underline" to={`/clientes/${d.id}`}>
                  {d.name}
                </Link>{' '}
                (mesmo {d.matchedBy === 'document' ? 'CPF/CNPJ' : 'telefone'})
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Contato">
        <Field label="WhatsApp" hint="Com DDD. É por ele que o cliente recebe os avisos da O.S.">
          <input className="input" inputMode="tel" value={String(form.phone)} onChange={set('phone')} onBlur={checkDuplicates} />
        </Field>
        <Field label="Outro telefone">
          <input className="input" inputMode="tel" value={String(form.phone2)} onChange={set('phone2')} />
        </Field>
        <Field label="E-mail">
          <input className="input" type="email" value={String(form.email)} onChange={set('email')} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(form.allowWhatsapp)} onChange={toggle('allowWhatsapp')} />
            Aceita receber mensagens no WhatsApp
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(form.allowEmail)} onChange={toggle('allowEmail')} />
            Aceita receber e-mail
          </label>
        </div>
      </Section>

      <Section title="Endereço">
        <Field label="CEP" hint={cepStatus || undefined}>
          <input className="input" inputMode="numeric" value={String(form.zip)} onChange={set('zip')} onBlur={fillFromCep} />
        </Field>
        <Field label="Rua">
          <input className="input" value={String(form.street)} onChange={set('street')} />
        </Field>
        <Field label="Número">
          <input className="input" value={String(form.number)} onChange={set('number')} />
        </Field>
        <Field label="Complemento">
          <input className="input" value={String(form.complement)} onChange={set('complement')} />
        </Field>
        <Field label="Bairro">
          <input className="input" value={String(form.district)} onChange={set('district')} />
        </Field>
        <Field label="Cidade">
          <input className="input" value={String(form.city)} onChange={set('city')} />
        </Field>
        <Field label="UF">
          <select className="input" value={String(form.state)} onChange={set('state')}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {!isPj && (
        <Section title="Família e responsável">
          <Field label="Nome da mãe">
            <input className="input" value={String(form.motherName)} onChange={set('motherName')} />
          </Field>
          <Field label="Nome do pai">
            <input className="input" value={String(form.fatherName)} onChange={set('fatherName')} />
          </Field>
          <Field label="Responsável" hint="Para menor de idade: quem assina e paga.">
            <input className="input" value={String(form.guardianName)} onChange={set('guardianName')} />
          </Field>
        </Section>
      )}

      <Section title="Relacionamento">
        <Field label="Origem">
          <select className="input" value={String(form.originId)} onChange={set('originId')}>
            <option value="">—</option>
            {origins.data?.filter((o) => o.active || o.id === form.originId).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Operação" hint="Por qual frente do grupo o cliente chegou.">
          <select className="input" value={String(form.operationId)} onChange={set('operationId')}>
            <option value="">—</option>
            {operations.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Loja">
          <select className="input" value={String(form.storeId)} onChange={set('storeId')}>
            <option value="">—</option>
            {stores.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Convênio">
          <select className="input" value={String(form.insurancePlanId)} onChange={set('insurancePlanId')}>
            <option value="">—</option>
            {plans.data?.filter((p) => p.active || p.id === form.insurancePlanId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vendedor(a) de preferência">
          <select className="input" value={String(form.preferredSellerId)} onChange={set('preferredSellerId')}>
            <option value="">—</option>
            {team.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        {editing && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={Boolean(form.active)} onChange={toggle('active')} />
            Cliente ativo
          </label>
        )}
      </Section>

      <div className="card p-5">
        <Field label="Observações">
          <textarea className="input" rows={3} value={String(form.notes)} onChange={set('notes')} />
        </Field>
      </div>

      <div className="flex justify-end gap-2 pb-10">
        <Link className="btn-ghost" to={editing ? `/clientes/${id}` : '/clientes'}>
          Cancelar
        </Link>
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="card p-5">
      <legend className="sr-only">{title}</legend>
      <p className="mb-4 text-sm font-semibold text-ink">{title}</p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
