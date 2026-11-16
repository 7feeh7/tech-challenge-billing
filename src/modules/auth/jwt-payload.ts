import { PerfilCliente } from './perfil-autorizacao';
import { PerfilUsuario } from './perfil-usuario';

export interface JwtPayloadBase {
  sub: string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
  jti?: string;
}

export interface JwtPayloadInterno extends JwtPayloadBase {
  tipo?: 'INTERNO';
  email: string;
  perfil: PerfilUsuario;
}

export interface JwtPayloadCliente extends JwtPayloadBase {
  tipo: typeof PerfilCliente;
  perfil: typeof PerfilCliente;
}

export type JwtPayload = JwtPayloadInterno | JwtPayloadCliente;

export function isTokenCliente(
  payload: JwtPayload,
): payload is JwtPayloadCliente {
  return payload.tipo === PerfilCliente;
}

export interface RequisicaoAutenticada {
  headers: { authorization?: string };
  user?: JwtPayload;
  params?: Record<string, string>;
}
