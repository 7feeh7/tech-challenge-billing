import { SetMetadata } from '@nestjs/common';

export enum OwnershipResource {
  ORCAMENTO = 'ORCAMENTO',
}

export const OWNERSHIP_KEY = 'ownership';
export const RequireOwnership = (resource: OwnershipResource) =>
  SetMetadata(OWNERSHIP_KEY, resource);
