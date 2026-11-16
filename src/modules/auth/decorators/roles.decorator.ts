import { SetMetadata } from '@nestjs/common';
import type { PerfilAutorizacao } from '../perfil-autorizacao';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: PerfilAutorizacao[]) =>
  SetMetadata(ROLES_KEY, roles);
