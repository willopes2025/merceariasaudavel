import { z } from 'zod';

/** Agente de IA do atendimento no WhatsApp (guardado por empresa). */
export const waConfigSchema = z.object({
  ligado: z.boolean().default(false),
  nome: z.string().trim().min(2, 'Dê um nome ao agente').max(40).default('Sol'),
  instrucoes: z.string().max(6000).default(''),
  /** Respostas seguidas da IA sem a equipe entrar; depois disso ela chama a equipe. */
  maxRespostas: z.number().int().min(1).max(40).default(10),
  /** Quando alguém da equipe responde, a IA para de responder naquela conversa. */
  pausarQuandoEquipeResponde: z.boolean().default(true),
});
export type WaConfig = z.infer<typeof waConfigSchema>;
export const WA_PADRAO: WaConfig = waConfigSchema.parse({});
