import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { requireContext, type RequestContext } from '../tenancy/request-context';

export const PUBLIC_KEY = 'auth:public';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Rota aberta (login, health). Tudo o mais exige token. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Exige permissão do papel do usuário, verificada no servidor (todas as listadas). */
export const RequiresPermission = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Contexto da requisição (organização, usuário, lojas, permissões) — sempre do token. */
export const Ctx = createParamDecorator((_: unknown, __: ExecutionContext): RequestContext => requireContext());
