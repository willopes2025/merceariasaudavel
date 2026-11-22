import type { RequestContext } from '../../common/tenancy/request-context';

/** Quem está falando com o Assistente (com as permissões de agora). */
export interface AssistantUser {
  id: string;
  nome: string;
  email: string;
  grupo: string;
  permissoes: string[];
  /** Contexto da requisição: tenant, lojas e permissões (as mesmas das telas). */
  ctx: RequestContext;
}

export const can = (u: AssistantUser, perm: string) => u.permissoes.includes('*') || u.permissoes.includes(perm);
