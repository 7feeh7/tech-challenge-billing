import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
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
import { PerfilUsuario } from '@/modules/auth/perfil-usuario';
import type { PendenciaEstornoGateway } from '../../../application/ports/pendencia-estorno.gateway';
import { PENDENCIA_ESTORNO_GATEWAY } from '../../../application/ports/tokens';
import { ResolverPendenciaEstornoUseCase } from '../../../application/use-cases/resolver-pendencia-estorno.use-case';
import { ResolverPendenciaEstornoDto } from '../dto/resolver-pendencia-estorno.dto';

@ApiTags('Pendências de estorno')
@ApiBearerAuth()
@Controller('pendencias-estorno')
export class PendenciasEstornoController {
  constructor(
    @Inject(PENDENCIA_ESTORNO_GATEWAY)
    private readonly pendencias: PendenciaEstornoGateway,
    private readonly resolverPendencia: ResolverPendenciaEstornoUseCase,
  ) {}

  @Get()
  @Roles(PerfilUsuario.ADMINISTRADOR)
  @ApiOperation({ summary: 'Listar pendências de estorno abertas' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({ status: 200, description: 'Lista paginada de pendências.' })
  async listar(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return await this.pendencias.listarAbertas(page, limit);
  }

  @Post(':id/resolucao')
  @Roles(PerfilUsuario.ADMINISTRADOR)
  @ApiOperation({ summary: 'Resolver pendência de estorno (administrador)' })
  @ApiResponse({ status: 200, description: 'Pendência resolvida.' })
  async resolver(
    @Param('id') id: string,
    @Body() dto: ResolverPendenciaEstornoDto,
    @Req() req: RequisicaoAutenticada,
  ): Promise<void> {
    if (!req.user || isTokenCliente(req.user)) {
      throw new Error('Usuário interno obrigatório para resolução.');
    }

    await this.resolverPendencia.execute({
      pendenciaId: id,
      responsavelId: req.user.sub,
      decisao: dto.decisao,
      valorEstornadoCentavos: dto.valorEstornadoCentavos,
      justificativa: dto.justificativa,
    });
  }
}
