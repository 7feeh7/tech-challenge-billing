import { isPerfilCliente, PerfilCliente } from './perfil-autorizacao';
import { PerfilUsuario } from './perfil-usuario';

describe('perfil-autorizacao', () => {
  it('identifica perfil cliente', () => {
    expect(isPerfilCliente(PerfilCliente)).toBe(true);
    expect(isPerfilCliente(PerfilUsuario.ADMINISTRADOR)).toBe(false);
  });
});