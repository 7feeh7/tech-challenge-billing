import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import {
  isTokenCliente,
  type RequisicaoAutenticada,
} from '@/modules/auth/jwt-payload';
import { PerfilCliente } from '@/modules/auth/perfil-autorizacao';
import { PerfilUsuario } from '@/modules/auth/perfil-usuario';
import { ListarCobrancasUseCase } from '@/modules/cobrancas/application/use-cases/listar-cobrancas.use-case';

@ApiTags('Cobranças')
@ApiBearerAuth()
@Controller('cobrancas')
export class CobrancasController {
  constructor(private readonly listarCobrancas: ListarCobrancasUseCase) {}

  @Get()
  @Roles(PerfilUsuario.ADMINISTRADOR, PerfilUsuario.ATENDENTE, PerfilCliente)
  @ApiOperation({ summary: 'Listar cobranças por OS' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({
    name: 'ordemServicoId',
    required: false,
    description: 'Filtrar por OS',
    format: 'uuid',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de cobranças.' })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('ordemServicoId') ordemServicoId: string | undefined,
    @Req() req: RequisicaoAutenticada,
  ) {
    const clienteId =
      req.user && isTokenCliente(req.user) ? req.user.sub : undefined;

    return await this.listarCobrancas.execute(page, limit, {
      ordemServicoId,
      clienteId,
    });
  }
}
