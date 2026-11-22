import { z } from 'zod';

/** Funcionários e controle de ponto. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM');
const dinheiro = z.preprocess((v) => (typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v || 0) : v), z.number().min(0).max(1_000_000));

export const CONTRACT_TYPES = { clt: 'CLT', estagio: 'Estágio', pj: 'PJ', autonomo: 'Autônomo / diarista', socio: 'Sócio (pró-labore)' } as const;
export type ContractType = keyof typeof CONTRACT_TYPES;

export const OCCURRENCE_TYPES: Record<string, { name: string; excused: boolean }> = {
  atestado: { name: 'Atestado médico', excused: true },
  ferias: { name: 'Férias', excused: true },
  folga: { name: 'Folga / compensação', excused: true },
  falta_justificada: { name: 'Falta justificada (abonada)', excused: true },
  licenca: { name: 'Licença (maternidade, paternidade, luto…)', excused: true },
  afastamento: { name: 'Afastamento (INSS)', excused: true },
  falta: { name: 'Falta sem justificativa', excused: false },
  suspensao: { name: 'Suspensão', excused: false },
};

export interface Shift {
  entrada: string;
  saidaIntervalo?: string | null;
  voltaIntervalo?: string | null;
  saida: string;
}

export const shiftSchema = z.object({ entrada: hora, saidaIntervalo: hora.nullish(), voltaIntervalo: hora.nullish(), saida: hora });
export const scheduleSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome à escala').max(60),
  /** 7 posições, domingo a sábado; null = folga. */
  days: z.array(shiftSchema.nullable()).length(7),
  tolerancePunch: z.number().int().min(0).max(30).default(5),
  toleranceDay: z.number().int().min(0).max(60).default(10),
  active: z.boolean().default(true),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export interface WorkSchedule extends ScheduleInput {
  id: string;
}

export const employeeSchema = z.object({
  name: z.string().trim().min(3, 'Informe o nome completo').max(100),
  cpf: z.string().trim().max(14).nullish(),
  role: z.string().trim().max(60).nullish(),
  phone: z.string().trim().max(20).nullish(),
  email: z.string().trim().max(120).nullish(),
  birthDate: isoDate.nullish(),
  admission: isoDate,
  dismissal: isoDate.nullish(),
  contract: z.enum(['clt', 'estagio', 'pj', 'autonomo', 'socio']).default('clt'),
  salary: dinheiro.default(0),
  payDay: z.coerce.number().int().min(1).max(31).default(5),
  pixKey: z.string().trim().max(120).nullish(),
  storeId: z.string().uuid().nullish(),
  userId: z.string().uuid().nullish(),
  scheduleId: z.string().uuid().nullish(),
  clocks: z.boolean().default(true),
  /** PIN de 4 a 6 números para bater o ponto no aparelho da loja. Vazio = não muda. */
  pin: z.string().regex(/^\d{4,6}$/, 'PIN de 4 a 6 números').nullish(),
  notes: z.string().trim().max(1000).nullish(),
  active: z.boolean().default(true),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export interface Employee extends Omit<EmployeeInput, 'pin'> {
  id: string;
  storeName: string | null;
  userName: string | null;
  scheduleName: string | null;
  hasPin: boolean;
}

export const punchSchema = z.object({
  /** Aparelho da loja: quem está batendo e o PIN. Sem isso, bate para o próprio usuário. */
  employeeId: z.string().uuid().optional(),
  pin: z.string().max(6).optional(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  accuracy: z.number().min(0).max(100000).nullish(),
  /** Foto em JPEG (base64), até ~300 KB. */
  photo: z.string().max(450_000).nullish(),
});
export type PunchInput = z.infer<typeof punchSchema>;

export interface PunchReceipt {
  id: string;
  employee: string;
  at: string;
  nsr: number;
  hash: string;
  outside: boolean | null;
  place: string | null;
  /** Batidas de hoje (HH:MM), já com esta. */
  today: string[];
}

export const adjustmentSchema = z
  .object({
    employeeId: z.string().uuid(),
    type: z.enum(['inclusao', 'desconsiderar']),
    recordId: z.string().uuid().optional(),
    date: isoDate.optional(),
    time: hora.optional(),
    reason: z.string().trim().min(5, 'Explique o motivo do ajuste').max(300),
  })
  .refine((d) => (d.type === 'inclusao' ? !!d.date && !!d.time : !!d.recordId), 'Informe a data e a hora (inclusão) ou a batida (desconsiderar)');
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const occurrenceSchema = z
  .object({ employeeId: z.string().uuid(), type: z.string().max(30), from: isoDate, to: isoDate, note: z.string().trim().max(300).nullish() })
  .refine((d) => d.from <= d.to, 'A data final é antes da inicial');
export type OccurrenceInput = z.infer<typeof occurrenceSchema>;

export const clockPlaceSchema = z.object({ name: z.string().trim().min(2).max(60), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), radiusM: z.number().int().min(30).max(5000).default(150), active: z.boolean().default(true) });
export type ClockPlaceInput = z.infer<typeof clockPlaceSchema>;

export const hrConfigSchema = z.object({
  /** Foto obrigatória na batida. */
  photo: z.boolean().default(false),
  /** Fora do local cadastrado: só avisa, bloqueia, ou não confere. */
  fence: z.enum(['avisar', 'bloquear', 'desligada']).default('avisar'),
});
export type HrConfig = z.infer<typeof hrConfigSchema>;

export const holidaySchema = z.object({ date: isoDate, name: z.string().trim().min(2).max(60) });
export const payrollSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês no formato AAAA-MM'), employeeIds: z.array(z.string().uuid()).max(500).optional() });

export interface MirrorDay {
  date: string;
  weekday: number;
  punches: Array<{ id: string | null; adjustmentId?: string | null; time: string; origin: 'original' | 'incluida'; ignored?: boolean; reason?: string | null; outside?: boolean | null; hasPhoto?: boolean }>;
  occurrence: string | null;
  holiday: string | null;
  /** Minutos. */
  expected: number;
  worked: number;
  extra: number;
  missing: number;
  late: number;
  absent: boolean;
  pending: boolean;
  warnings: string[];
}

export interface Mirror {
  employee: { id: string; name: string; cpf: string | null; role: string | null; admission: string };
  schedule: { id: string; name: string } | null;
  month: string;
  days: MirrorDay[];
  totals: { expected: number; worked: number; extra: number; missing: number; late: number; absences: number; pending: number; balance: number };
  closing: { closedAt: string; ackAt: string | null } | null;
}

export interface ClockToday {
  id: string;
  name: string;
  role: string | null;
  shift: Shift | null;
  status: string;
  punches: Array<{ time: string; outside: boolean | null }>;
}
