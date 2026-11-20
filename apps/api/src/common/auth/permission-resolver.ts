/**
 * Quem diz, a cada requisição, o que um usuário pode agora.
 *
 * O token guarda as permissões do momento do login e vale um turno inteiro.
 * Sem esta conferência, tirar um acesso (ou desativar a pessoa) só valeria no
 * próximo login. A implementação fica no módulo de acesso, com cache curto.
 */
export abstract class PermissionResolver {
  abstract resolve(userId: string, tenantId: string): Promise<{ active: boolean; permissions: string[]; storeIds: string[] }>;
}
