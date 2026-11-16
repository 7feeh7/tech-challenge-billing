import { PerfilUsuario } from './perfil-usuario';

export const PerfilCliente = 'CLIENTE' as const;

export type PerfilAutorizacao = PerfilUsuario | typeof PerfilCliente;

export function isPerfilCliente(
  perfil: PerfilAutorizacao,
): perfil is typeof PerfilCliente {
  return perfil === PerfilCliente;
}
