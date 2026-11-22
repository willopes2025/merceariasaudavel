import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  OCCURRENCE_TYPES,
  hrConfigSchema,
  normalizeText,
  todayBR,
  type AdjustmentInput,
  type ClockPlaceInput,
  type ClockToday,
  type Employee,
  type EmployeeInput,
  type HrConfig,
  type Mirror,
  type MirrorDay,
  type OccurrenceInput,
  type PunchInput,
  type PunchReceipt,
  type ScheduleInput,
  type Shift,
  type WorkSchedule,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { LedgerService } from '../finance/ledger.service';
import { calcularDia, feriadosNacionais, somarJornada, type Turno } from './jornada';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** Data e hora de Brasília de um instante: "AAAA-MM-DDTHH:MM". */
const br = (d: Date) => new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 16);
const brDia = (d: Date) => br(d).slice(0, 10);
const brHora = (d: Date) => br(d).slice(11, 16);
const digitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');

function distancia(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function diasDoMes(mes: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new DomainError('MONTH_INVALID', 'Mês no formato AAAA-MM.');
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * Funcionários e controle de ponto (portado do RH da Aritana): cadastro, escalas, batida com hora do servidor,
 * número sequencial e hash encadeado (a batida nunca muda; correção é ajuste com motivo), GPS e foto opcionais,
 * espelho do mês, ocorrências, fechamento com ciência e geração da folha em contas a pagar.
 */
@Injectable()
export class HrService {
  /** Tentativas erradas de PIN por funcionário (trava curta contra chute). */
  private readonly erros = new Map<string, { n: number; ate: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  // ───────────── Configuração, escalas, locais, feriados ─────────────

  async config(tenantId: string): Promise<HrConfig> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId }, select: { hrConfig: true } });
    return hrConfigSchema.parse(s?.hrConfig ?? {});
  }

  async saveConfig(ctx: RequestContext, d: HrConfig) {
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, hrConfig: d }, update: { hrConfig: d } });
    return d;
  }

  async schedules(ctx: RequestContext): Promise<WorkSchedule[]> {
    const rows = await this.prisma.workSchedule.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name, days: r.days as unknown as (Shift | null)[], tolerancePunch: r.tolerancePunch, toleranceDay: r.toleranceDay, active: r.active }));
  }

  async saveSchedule(ctx: RequestContext, id: string | null, d: ScheduleInput) {
    for (const t of d.days) {
      if (!t) continue;
      if (!!t.saidaIntervalo !== !!t.voltaIntervalo) throw new DomainError('SHIFT_BREAK', 'Informe a saída e a volta do intervalo (ou deixe as duas vazias).');
    }
    const repetida = await this.prisma.workSchedule.findFirst({ where: { tenantId: ctx.tenantId, name: d.name, ...(id ? { NOT: { id } } : {}) } });
    if (repetida) throw new ConflictError('SCHEDULE_NAME', 'Já existe uma escala com esse nome.');
    const data = { name: d.name, days: d.days as unknown as Prisma.InputJsonValue, tolerancePunch: d.tolerancePunch, toleranceDay: d.toleranceDay, active: d.active };
    if (id) {
      const r = await this.prisma.workSchedule.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
      if (!r.count) throw new NotFoundError('escala', id);
    } else id = (await this.prisma.workSchedule.create({ data: { tenantId: ctx.tenantId, ...data } })).id;
    await this.audit.record(ctx, 'hr.schedule', 'work_schedule', id, { name: d.name });
    return { id };
  }

  places(ctx: RequestContext) {
    return this.prisma.clockPlace.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' }, select: { id: true, name: true, latitude: true, longitude: true, radiusM: true, active: true } });
  }

  async savePlace(ctx: RequestContext, id: string | null, d: ClockPlaceInput) {
    if (id) {
      const r = await this.prisma.clockPlace.updateMany({ where: { id, tenantId: ctx.tenantId }, data: d });
      if (!r.count) throw new NotFoundError('local', id);
    } else id = (await this.prisma.clockPlace.create({ data: { tenantId: ctx.tenantId, ...d } })).id;
    return { id };
  }

  async holidays(ctx: RequestContext, year: number) {
    const extras = await this.prisma.holiday.findMany({ where: { tenantId: ctx.tenantId, date: { gte: asDate(`${year}-01-01`), lte: asDate(`${year}-12-31`) } } });
    return [
      ...feriadosNacionais(year).filter((f) => !/facultativo/.test(f.nome)).map((f) => ({ id: null as string | null, date: f.data, name: f.nome, national: true })),
      ...extras.map((f) => ({ id: f.id as string | null, date: day(f.date)!, name: f.name, national: false })),
    ].sort((a, b) => a.date.localeCompare(b.date));
  }

  async saveHoliday(ctx: RequestContext, d: { date: string; name: string }) {
    const r = await this.prisma.holiday.upsert({ where: { tenantId_date: { tenantId: ctx.tenantId, date: asDate(d.date) } }, create: { tenantId: ctx.tenantId, date: asDate(d.date), name: d.name }, update: { name: d.name } });
    return { id: r.id };
  }

  async deleteHoliday(ctx: RequestContext, id: string) {
    await this.prisma.holiday.deleteMany({ where: { id, tenantId: ctx.tenantId } });
    return { ok: true };
  }

  // ───────────── Funcionários ─────────────

  async employees(ctx: RequestContext): Promise<Employee[]> {
    const rows = await this.prisma.employee.findMany({ where: { tenantId: ctx.tenantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    const [stores, users, escalas] = await Promise.all([
      this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.appUser.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.workSchedule.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    ]);
    const nome = (l: { id: string; name: string }[], id: string | null) => (id ? (l.find((x) => x.id === id)?.name ?? null) : null);
    return rows.map((e) => ({
      id: e.id,
      name: e.name,
      cpf: e.cpf,
      role: e.role,
      phone: e.phone,
      email: e.email,
      birthDate: day(e.birthDate),
      admission: day(e.admission)!,
      dismissal: day(e.dismissal),
      contract: e.contract as Employee['contract'],
      salary: Number(e.salary),
      payDay: e.payDay,
      pixKey: e.pixKey,
      storeId: e.storeId,
      userId: e.userId,
      scheduleId: e.scheduleId,
      clocks: e.clocks,
      notes: e.notes,
      active: e.active,
      storeName: nome(stores, e.storeId),
      userName: nome(users, e.userId),
      scheduleName: nome(escalas, e.scheduleId),
      hasPin: !!e.pinHash,
    }));
  }

  async saveEmployee(ctx: RequestContext, id: string | null, d: EmployeeInput) {
    const t = ctx.tenantId;
    const cpf = digitos(d.cpf) || null;
    if (cpf && cpf.length !== 11) throw new DomainError('CPF_INVALID', 'CPF com 11 números.');
    if (cpf && (await this.prisma.employee.count({ where: { tenantId: t, cpf, ...(id ? { NOT: { id } } : {}) } }))) throw new ConflictError('CPF_USED', 'Já existe um funcionário com esse CPF.');
    if (d.dismissal && d.dismissal < d.admission) throw new DomainError('DISMISSAL_BEFORE', 'O desligamento é antes da admissão.');
    if (d.storeId && !(await this.prisma.store.count({ where: { id: d.storeId, tenantId: t } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    if (d.scheduleId && !(await this.prisma.workSchedule.count({ where: { id: d.scheduleId, tenantId: t } }))) throw new DomainError('SCHEDULE_NOT_FOUND', 'Escala não encontrada.');
    if (d.userId) {
      if (!(await this.prisma.appUser.count({ where: { id: d.userId, tenantId: t } }))) throw new DomainError('USER_NOT_FOUND', 'Usuário não encontrado.');
      if (await this.prisma.employee.count({ where: { tenantId: t, userId: d.userId, ...(id ? { NOT: { id } } : {}) } })) throw new ConflictError('USER_LINKED', 'Esse usuário já está ligado a outro funcionário.');
    }
    const data = {
      name: d.name,
      cpf,
      role: d.role ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      birthDate: d.birthDate ? asDate(d.birthDate) : null,
      admission: asDate(d.admission),
      dismissal: d.dismissal ? asDate(d.dismissal) : null,
      contract: d.contract,
      salary: d.salary,
      payDay: d.payDay,
      pixKey: d.pixKey ?? null,
      storeId: d.storeId ?? null,
      userId: d.userId ?? null,
      scheduleId: d.scheduleId ?? null,
      clocks: d.clocks,
      notes: d.notes ?? null,
      active: d.active && !(d.dismissal && d.dismissal < todayBR()),
      ...(d.pin ? { pinHash: await argon2.hash(d.pin) } : {}),
    };
    if (id) {
      const r = await this.prisma.employee.updateMany({ where: { id, tenantId: t }, data });
      if (!r.count) throw new NotFoundError('funcionário', id);
    } else id = (await this.prisma.employee.create({ data: { tenantId: t, ...data } })).id;
    await this.audit.record(ctx, 'hr.employee', 'employee', id, { name: d.name, cargo: d.role ?? null });
    return { id };
  }

  private async employee(tenantId: string, id: string) {
    const e = await this.prisma.employee.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundError('funcionário', id);
    return e;
  }

  /** Quem bate ponto no aparelho da loja (só nome, para a lista). */
  async kiosk(ctx: RequestContext) {
    const rows = await this.prisma.employee.findMany({ where: { tenantId: ctx.tenantId, active: true, clocks: true, pinHash: { not: null }, ...(ctx.storeIds.length ? { OR: [{ storeId: null }, { storeId: { in: ctx.storeIds } }] } : {}) }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    return rows;
  }

  // ───────────── Bater o ponto ─────────────

  async punch(ctx: RequestContext, d: PunchInput, meta: { ip?: string; device?: string }): Promise<PunchReceipt> {
    const t = ctx.tenantId;
    let e: Prisma.EmployeeGetPayload<object> | null;
    let source: 'proprio' | 'loja' = 'proprio';
    if (d.employeeId) {
      e = await this.employee(t, d.employeeId);
      if (e.userId !== ctx.userId) {
        source = 'loja';
        const trava = this.erros.get(e.id);
        if (trava && trava.n >= 5 && trava.ate > Date.now()) throw new ForbiddenError('PIN_LOCKED', 'Muitas tentativas erradas. Espere 10 minutos ou peça ao gerente para trocar o PIN.');
        if (!e.pinHash) throw new DomainError('PIN_MISSING', 'Este funcionário ainda não tem PIN. O gerente cadastra em Funcionários.');
        if (!d.pin || !(await argon2.verify(e.pinHash, d.pin))) {
          this.erros.set(e.id, { n: (trava && trava.ate > Date.now() ? trava.n : 0) + 1, ate: Date.now() + 10 * 60_000 });
          throw new ForbiddenError('PIN_WRONG', 'PIN incorreto.');
        }
        this.erros.delete(e.id);
      }
    } else {
      e = await this.prisma.employee.findFirst({ where: { tenantId: t, userId: ctx.userId } });
      if (!e) throw new ForbiddenError('NO_EMPLOYEE', 'Seu acesso não está ligado a um cadastro de funcionário. Fale com o gerente.');
    }
    if (!e.active) throw new ForbiddenError('EMPLOYEE_INACTIVE', 'Cadastro desligado: o ponto não pode mais ser batido.');
    if (!e.clocks) throw new DomainError('NO_CLOCK', 'Este cadastro está marcado como sem controle de ponto.');
    const cfg = await this.config(t);
    const foto = d.photo ? Buffer.from(d.photo.replace(/^data:image\/\w+;base64,/, ''), 'base64') : null;
    if (cfg.photo && !foto) throw new DomainError('PHOTO_REQUIRED', 'Tire a foto para bater o ponto.');
    if (foto && (foto.length > 350_000 || foto[0] !== 0xff || foto[1] !== 0xd8)) throw new DomainError('PHOTO_INVALID', 'Foto inválida (JPEG de até 350 KB).');

    // Cerca pelo GPS: em qual local cadastrado a pessoa está.
    let placeId: string | null = null;
    let placeName: string | null = null;
    let outside: boolean | null = null;
    const locais = cfg.fence === 'desligada' ? [] : await this.prisma.clockPlace.findMany({ where: { tenantId: t, active: true } });
    if (locais.length) {
      if (d.latitude == null || d.longitude == null) {
        if (cfg.fence === 'bloquear') throw new DomainError('GPS_REQUIRED', 'Ative a localização do aparelho para bater o ponto.');
      } else {
        const perto = locais.map((l) => ({ l, dist: distancia({ lat: d.latitude!, lng: d.longitude! }, { lat: l.latitude, lng: l.longitude }) })).sort((a, b) => a.dist - b.dist)[0]!;
        // A precisão do GPS conta a favor (dentro de prédio o celular erra dezenas de metros).
        outside = perto.dist - Math.min(d.accuracy ?? 0, 200) > perto.l.radiusM;
        if (outside && cfg.fence === 'bloquear') throw new DomainError('OUTSIDE_PLACE', `Você está a ${perto.dist} m de ${perto.l.name}. O ponto só pode ser batido no local de trabalho.`);
        if (!outside) [placeId, placeName] = [perto.l.id, perto.l.name];
      }
    }
    const emp = e;
    const r = await this.prisma.$transaction(async (tx) => {
      // A trava da sequência vem primeiro: dois toques ao mesmo tempo entram em fila.
      await tx.$executeRaw`INSERT INTO clock_sequence (tenant_id) VALUES (${t}) ON CONFLICT DO NOTHING`;
      const [seq] = await tx.$queryRaw<Array<{ last_nsr: number; last_hash: string }>>`SELECT last_nsr, last_hash FROM clock_sequence WHERE tenant_id = ${t} FOR UPDATE`;
      const ultima = await tx.clockRecord.findFirst({ where: { employeeId: emp.id }, orderBy: { at: 'desc' }, select: { at: true } });
      const agora = new Date();
      if (ultima && agora.getTime() - ultima.at.getTime() < 60_000) throw new ConflictError('PUNCH_DUPLICATE', 'Ponto já registrado agora há pouco. Aguarde um minuto para bater de novo.');
      const nsr = (seq?.last_nsr ?? 0) + 1;
      const hash = createHash('sha256').update(`${nsr}|${agora.toISOString()}|${emp.cpf ?? emp.id}|${seq?.last_hash ?? ''}`).digest('hex');
      const rec = await tx.clockRecord.create({
        data: { tenantId: t, employeeId: emp.id, nsr, at: agora, hash, latitude: d.latitude ?? null, longitude: d.longitude ?? null, accuracyM: d.accuracy != null ? Math.round(d.accuracy) : null, placeId, outside, photo: foto ? new Uint8Array(foto) : null, source, ip: meta.ip ?? null, device: meta.device?.slice(0, 300) ?? null, userId: ctx.userId },
        select: { id: true, at: true, nsr: true, hash: true },
      });
      await tx.$executeRaw`UPDATE clock_sequence SET last_nsr = ${nsr}, last_hash = ${hash} WHERE tenant_id = ${t}`;
      return rec;
    });
    const hoje = await this.prisma.clockRecord.findMany({ where: { employeeId: emp.id, at: { gte: new Date(`${todayBR()}T00:00:00-03:00`) } }, orderBy: { at: 'asc' }, select: { at: true } });
    return { id: r.id, employee: emp.name, at: r.at.toISOString(), nsr: r.nsr, hash: r.hash, outside, place: placeName, today: hoje.map((x) => brHora(x.at)) };
  }

  /** "Meu ponto": meu cadastro, as batidas de hoje e o espelho do mês. */
  async me(ctx: RequestContext, month: string) {
    const e = await this.prisma.employee.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId } });
    const cfg = await this.config(ctx.tenantId);
    if (!e) return { employee: null, config: cfg, mirror: null };
    return { employee: { id: e.id, name: e.name, clocks: e.clocks }, config: cfg, mirror: e.clocks ? await this.mirror(ctx.tenantId, e.id, month) : null };
  }

  async ack(ctx: RequestContext, month: string) {
    const e = await this.prisma.employee.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId } });
    if (!e) throw new ForbiddenError('NO_EMPLOYEE', 'Seu acesso não está ligado a um cadastro de funcionário.');
    const r = await this.prisma.clockClosing.updateMany({ where: { employeeId: e.id, month, ackAt: null }, data: { ackAt: new Date() } });
    if (!r.count) throw new ConflictError('NOT_CLOSED', 'Este mês ainda não foi fechado (ou você já confirmou).');
    return { ok: true };
  }

  // ───────────── Espelho ─────────────

  private async feriados(tenantId: string, de: string, ate: string) {
    const extras = await this.prisma.holiday.findMany({ where: { tenantId, date: { gte: asDate(de), lte: asDate(ate) } } });
    const mapa = new Map<string, string>();
    for (const a of [...new Set([de.slice(0, 4), ate.slice(0, 4)])].map(Number)) for (const f of feriadosNacionais(a)) if (!/facultativo/.test(f.nome)) mapa.set(f.data, f.nome);
    for (const f of extras) mapa.set(day(f.date)!, f.name);
    return mapa;
  }

  /** Batidas válidas por dia (originais + incluídas, marcando as desconsideradas), com virada de meia-noite. */
  private async batidas(employeeId: string, de: string, ate: string) {
    const ini = new Date(`${de}T00:00:00-03:00`);
    const fim = new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000 + 6 * 3_600_000);
    const [originais, ajustes] = await Promise.all([
      this.prisma.clockRecord.findMany({ where: { employeeId, at: { gte: ini, lt: fim } }, orderBy: { at: 'asc' }, select: { id: true, at: true, outside: true, photo: false, nsr: true } }),
      this.prisma.clockAdjustment.findMany({ where: { employeeId } }),
    ]);
    const comFoto = new Set((await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM clock_record WHERE employee_id = ${employeeId} AND at >= ${ini} AND at < ${fim} AND photo IS NOT NULL`).map((x) => x.id));
    const ignoradas = new Map(ajustes.filter((a) => a.type === 'desconsiderar' && a.recordId).map((a) => [a.recordId!, a]));
    const lista = [
      ...originais.map((o) => ({ id: o.id as string | null, ajusteId: ignoradas.get(o.id)?.id ?? null, quando: o.at, origem: 'original' as const, ignorada: ignoradas.has(o.id), motivo: ignoradas.get(o.id)?.reason ?? null, fora: o.outside, foto: comFoto.has(o.id) })),
      ...ajustes.filter((a) => a.type === 'inclusao' && a.at && a.at >= ini && a.at < fim).map((a) => ({ id: null as string | null, ajusteId: a.id as string | null, quando: a.at!, origem: 'incluida' as const, ignorada: false, motivo: a.reason, fora: null as boolean | null, foto: false })),
    ].sort((a, b) => a.quando.getTime() - b.quando.getTime());
    const porDia = new Map<string, typeof lista>();
    for (const m of lista) {
      let d = brDia(m.quando);
      const vespera = brDia(new Date(m.quando.getTime() - 86_400_000));
      const daVespera = (porDia.get(vespera) ?? []).filter((x) => !x.ignorada);
      // Batida de madrugada que fecha um turno aberto na véspera fica na véspera.
      if (Number(brHora(m.quando).slice(0, 2)) < 6 && daVespera.length % 2 === 1 && !m.ignorada) d = vespera;
      porDia.set(d, [...(porDia.get(d) ?? []), m]);
    }
    return porDia;
  }

  async mirror(tenantId: string, employeeId: string, month: string): Promise<Mirror> {
    const f = await this.employee(tenantId, employeeId);
    const dias = diasDoMes(month);
    const [de, ate] = [dias[0]!, dias.at(-1)!];
    const escala = f.scheduleId ? await this.prisma.workSchedule.findUnique({ where: { id: f.scheduleId } }) : null;
    const turnos = (escala?.days as unknown as (Turno | null)[] | undefined) ?? [];
    const [feriados, ocorrencias, porDia, fech] = await Promise.all([
      this.feriados(tenantId, de, ate),
      this.prisma.clockOccurrence.findMany({ where: { employeeId, from: { lte: asDate(ate) }, to: { gte: asDate(de) } } }),
      this.batidas(employeeId, de, ate),
      this.prisma.clockClosing.findUnique({ where: { employeeId_month: { employeeId, month } } }),
    ]);
    const h = todayBR();
    const admissao = day(f.admission)!;
    const demissao = day(f.dismissal);
    const linhas: MirrorDay[] = [];
    const resultados = [];
    for (const data of dias) {
      const semana = new Date(`${data}T12:00:00Z`).getUTCDay();
      const fora = data < admissao || (demissao && data > demissao) || data > h;
      const turno = fora ? null : (turnos[semana] ?? null);
      const oc = ocorrencias.find((o) => day(o.from)! <= data && day(o.to)! >= data);
      const abona = !!oc && (OCCURRENCE_TYPES[oc.type]?.excused ?? false);
      const brutas = porDia.get(data) ?? [];
      const validas = brutas.filter((m) => !m.ignorada);
      const meiaNoite = new Date(`${data}T00:00:00-03:00`).getTime();
      const r = calcularDia({
        marcacoes: validas.map((m) => Math.round((m.quando.getTime() - meiaNoite) / 60000)),
        turno: data === h && validas.length < 2 ? null : turno, // hoje ainda está em andamento
        domingo: semana === 0,
        feriado: feriados.has(data),
        abonado: abona,
        toleranciaMarcacao: escala?.tolerancePunch,
        toleranciaDia: escala?.toleranceDay,
      });
      if (data === h) {
        r.falta = 0;
        r.saidaAntecipada = 0;
        r.faltaDia = false;
      }
      if (oc && !abona && turno) {
        r.falta = r.previsto;
        r.faltaDia = true;
      }
      if (brutas.some((m) => m.fora)) r.avisos.push('Batida fora do local de trabalho.');
      resultados.push(r);
      linhas.push({
        date: data,
        weekday: semana,
        punches: brutas.map((m) => ({ id: m.id, adjustmentId: m.ajusteId, time: brHora(m.quando), origin: m.origem, ignored: m.ignorada, reason: m.motivo, outside: m.fora, hasPhoto: m.foto })),
        occurrence: oc ? (OCCURRENCE_TYPES[oc.type]?.name ?? oc.type) : null,
        holiday: feriados.get(data) ?? null,
        expected: r.previsto,
        worked: r.trabalhado,
        extra: r.extra50 + r.extra100,
        missing: r.falta + r.saidaAntecipada,
        late: r.atraso,
        absent: r.faltaDia,
        pending: r.pendente,
        warnings: r.avisos,
      });
    }
    const t = somarJornada(resultados);
    return {
      employee: { id: f.id, name: f.name, cpf: f.cpf, role: f.role, admission: admissao },
      schedule: escala ? { id: escala.id, name: escala.name } : null,
      month,
      days: linhas,
      totals: { expected: t.previsto, worked: t.trabalhado, extra: t.extra50 + t.extra100, missing: t.falta + t.saidaAntecipada, late: t.atraso, absences: t.faltasDias, pending: t.pendentes, balance: t.saldo },
      closing: fech ? { closedAt: fech.closedAt.toISOString(), ackAt: fech.ackAt?.toISOString() ?? null } : null,
    };
  }

  /** Ajuste em mês já fechado: o fechamento deixa de valer (o espelho mudou). */
  private async reabrir(employeeId: string, datas: string[]) {
    await this.prisma.clockClosing.deleteMany({ where: { employeeId, month: { in: [...new Set(datas.map((d) => d.slice(0, 7)))] } } });
  }

  async adjust(ctx: RequestContext, d: AdjustmentInput) {
    const e = await this.employee(ctx.tenantId, d.employeeId);
    let at: Date | null = null;
    if (d.type === 'inclusao') {
      at = new Date(`${d.date}T${d.time}:00-03:00`);
      if (at.getTime() > Date.now()) throw new DomainError('FUTURE', 'A batida incluída não pode ser no futuro.');
      await this.reabrir(e.id, [d.date!]);
    } else {
      const rec = await this.prisma.clockRecord.findFirst({ where: { id: d.recordId, employeeId: e.id, tenantId: ctx.tenantId }, select: { at: true } });
      if (!rec) throw new NotFoundError('batida', d.recordId!);
      if (await this.prisma.clockAdjustment.count({ where: { recordId: d.recordId, type: 'desconsiderar' } })) throw new ConflictError('ALREADY_IGNORED', 'Essa batida já foi desconsiderada.');
      await this.reabrir(e.id, [brDia(rec.at)]);
    }
    const a = await this.prisma.clockAdjustment.create({ data: { tenantId: ctx.tenantId, employeeId: e.id, type: d.type, recordId: d.recordId ?? null, at, reason: d.reason, userId: ctx.userId } });
    await this.audit.record(ctx, 'hr.clock_adjust', 'employee', e.id, { tipo: d.type, motivo: d.reason, quando: at?.toISOString() ?? null });
    return { id: a.id };
  }

  async deleteAdjustment(ctx: RequestContext, id: string) {
    const a = await this.prisma.clockAdjustment.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!a) throw new NotFoundError('ajuste', id);
    const rec = a.recordId ? await this.prisma.clockRecord.findUnique({ where: { id: a.recordId }, select: { at: true } }) : null;
    await this.reabrir(a.employeeId, [brDia(a.at ?? rec?.at ?? new Date())]);
    await this.prisma.clockAdjustment.delete({ where: { id } });
    await this.audit.record(ctx, 'hr.clock_adjust_delete', 'employee', a.employeeId, { tipo: a.type });
    return { ok: true };
  }

  async occurrences(ctx: RequestContext, employeeId: string) {
    const rows = await this.prisma.clockOccurrence.findMany({ where: { tenantId: ctx.tenantId, employeeId }, orderBy: { from: 'desc' }, take: 200 });
    return rows.map((o) => ({ id: o.id, type: o.type, typeName: OCCURRENCE_TYPES[o.type]?.name ?? o.type, from: day(o.from)!, to: day(o.to)!, note: o.note }));
  }

  async addOccurrence(ctx: RequestContext, d: OccurrenceInput) {
    if (!(d.type in OCCURRENCE_TYPES)) throw new DomainError('OCCURRENCE_TYPE', 'Tipo de ocorrência inválido.');
    const e = await this.employee(ctx.tenantId, d.employeeId);
    await this.reabrir(e.id, [d.from, d.to]);
    const o = await this.prisma.clockOccurrence.create({ data: { tenantId: ctx.tenantId, employeeId: e.id, type: d.type, from: asDate(d.from), to: asDate(d.to), note: d.note ?? null, userId: ctx.userId } });
    await this.audit.record(ctx, 'hr.occurrence', 'employee', e.id, { tipo: d.type, de: d.from, ate: d.to });
    return { id: o.id };
  }

  async deleteOccurrence(ctx: RequestContext, id: string) {
    const o = await this.prisma.clockOccurrence.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!o) throw new NotFoundError('ocorrência', id);
    await this.reabrir(o.employeeId, [day(o.from)!, day(o.to)!]);
    await this.prisma.clockOccurrence.delete({ where: { id } });
    return { ok: true };
  }

  /** Fecha o mês: guarda a foto do espelho de cada um (o funcionário confirma em "Meu ponto"). */
  async close(ctx: RequestContext, month: string, employeeIds?: string[]) {
    const dias = diasDoMes(month);
    if (dias.at(-1)! >= todayBR()) throw new DomainError('MONTH_OPEN', 'Só dá para fechar um mês que já terminou.');
    const fs = await this.prisma.employee.findMany({ where: { tenantId: ctx.tenantId, clocks: true, ...(employeeIds?.length ? { id: { in: employeeIds } } : {}) } });
    const alvo = fs.filter((f) => day(f.admission)! <= dias.at(-1)! && (!f.dismissal || day(f.dismissal)! >= dias[0]!));
    const pendencias: { name: string; days: number }[] = [];
    for (const f of alvo) {
      const e = await this.mirror(ctx.tenantId, f.id, month);
      if (e.totals.pending) pendencias.push({ name: f.name, days: e.totals.pending });
      const snapshot = e as unknown as Prisma.InputJsonValue;
      await this.prisma.clockClosing.upsert({ where: { employeeId_month: { employeeId: f.id, month } }, create: { tenantId: ctx.tenantId, employeeId: f.id, month, snapshot, closedBy: ctx.userId }, update: { snapshot, closedAt: new Date(), closedBy: ctx.userId, ackAt: null } });
    }
    await this.audit.record(ctx, 'hr.clock_close', 'clock_closing', null, { month, funcionarios: alvo.length });
    return { closed: alvo.length, pending: pendencias };
  }

  /** Resumo do mês de todos (para a folha): horas, extras, faltas e se o mês está fechado e confirmado. */
  async monthSummary(ctx: RequestContext, month: string) {
    const fs = await this.prisma.employee.findMany({ where: { tenantId: ctx.tenantId, clocks: true }, orderBy: { name: 'asc' } });
    const dias = diasDoMes(month);
    const out = [];
    for (const f of fs.filter((x) => day(x.admission)! <= dias.at(-1)! && (!x.dismissal || day(x.dismissal)! >= dias[0]!))) {
      const e = await this.mirror(ctx.tenantId, f.id, month);
      out.push({ id: f.id, name: f.name, role: f.role, schedule: e.schedule?.name ?? null, totals: e.totals, closing: e.closing });
    }
    return out;
  }

  /** Quem está trabalhando agora. */
  async today(ctx: RequestContext): Promise<ClockToday[]> {
    const h = todayBR();
    const fs = await this.prisma.employee.findMany({ where: { tenantId: ctx.tenantId, active: true, clocks: true }, orderBy: { name: 'asc' } });
    const [escalas, regs, ocs] = await Promise.all([
      this.prisma.workSchedule.findMany({ where: { tenantId: ctx.tenantId } }),
      this.prisma.clockRecord.findMany({ where: { tenantId: ctx.tenantId, at: { gte: new Date(`${h}T00:00:00-03:00`) } }, orderBy: { at: 'asc' }, select: { employeeId: true, at: true, outside: true } }),
      this.prisma.clockOccurrence.findMany({ where: { tenantId: ctx.tenantId, from: { lte: asDate(h) }, to: { gte: asDate(h) } } }),
    ]);
    const semana = new Date(`${h}T12:00:00Z`).getUTCDay();
    const agora = brHora(new Date());
    const agoraMin = Number(agora.slice(0, 2)) * 60 + Number(agora.slice(3));
    return fs.map((f) => {
      const minhas = regs.filter((r) => r.employeeId === f.id);
      const turno = ((escalas.find((e) => e.id === f.scheduleId)?.days as unknown as (Shift | null)[] | undefined) ?? [])[semana] ?? null;
      const oc = ocs.find((o) => o.employeeId === f.id);
      const entrada = turno ? Number(turno.entrada.slice(0, 2)) * 60 + Number(turno.entrada.slice(3)) : null;
      const status = oc ? (OCCURRENCE_TYPES[oc.type]?.name ?? oc.type) : minhas.length ? (minhas.length % 2 === 1 ? 'trabalhando' : 'saiu') : turno && entrada !== null && agoraMin > entrada + 10 ? 'atrasado' : turno ? 'ainda não chegou' : 'folga';
      return { id: f.id, name: f.name, role: f.role, shift: turno, status, punches: minhas.map((m) => ({ time: brHora(m.at), outside: m.outside })) };
    });
  }

  async photo(ctx: RequestContext, recordId: string) {
    const r = await this.prisma.clockRecord.findFirst({ where: { id: recordId, tenantId: ctx.tenantId }, select: { photo: true } });
    if (!r?.photo) throw new NotFoundError('foto', recordId);
    return Buffer.from(r.photo);
  }

  // ───────────── Folha em contas a pagar ─────────────

  /** Lança o salário do mês de cada funcionário em contas a pagar (não repete quem já foi lançado). */
  async payroll(ctx: RequestContext, month: string, employeeIds?: string[]) {
    const dias = diasDoMes(month);
    const t = ctx.tenantId;
    const fs = await this.prisma.employee.findMany({ where: { tenantId: t, active: true, salary: { gt: 0 }, ...(employeeIds?.length ? { id: { in: employeeIds } } : {}) } });
    const [salarios, prolabore] = await Promise.all([this.ledger.byCode(t, '5.1.1'), this.ledger.byCode(t, '5.1.2')]);
    const competencia = asDate(dias.at(-1)!);
    const [a, m] = month.split('-').map(Number) as [number, number];
    let criadas = 0;
    let total = 0;
    for (const f of fs.filter((x) => day(x.admission)! <= dias.at(-1)! && (!x.dismissal || day(x.dismissal)! >= dias[0]!))) {
      const ja = await this.prisma.payable.count({ where: { tenantId: t, employeeId: f.id, status: { not: 'canceled' }, competence: { gte: asDate(dias[0]!), lte: competencia }, description: { startsWith: 'Salário' } } });
      if (ja) continue;
      // Vence no dia de pagamento do mês seguinte (limitado ao último dia do mês).
      const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
      const vencimento = new Date(Date.UTC(a, m, Math.min(f.payDay, ultimo)));
      const description = `${f.contract === 'socio' ? 'Pró-labore' : 'Salário'} ${month.split('-').reverse().join('/')} · ${f.name}`;
      await this.prisma.payable.create({
        data: { tenantId: t, storeId: f.storeId, description: description.replace(/^Pró-labore/, 'Salário (pró-labore)'), supplier: f.name, category: 'folha', chartAccountId: (f.contract === 'socio' ? prolabore : salarios)?.id ?? null, employeeId: f.id, competence: competencia, amount: f.salary, dueDate: vencimento, searchText: normalizeText(`${description} ${f.name}`), createdById: ctx.userId },
      });
      criadas++;
      total += Number(f.salary);
    }
    await this.audit.record(ctx, 'hr.payroll', 'payable', null, { month, contas: criadas, total });
    return { created: criadas, total, skipped: fs.length - criadas };
  }
}
