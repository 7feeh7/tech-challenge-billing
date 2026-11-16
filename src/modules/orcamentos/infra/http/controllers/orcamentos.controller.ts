import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  OwnershipResource,
  RequireOwnership,
} from '@/modules/auth/decorators/ownership.decorator';
import { Roles } from '@/modules/auth/decorators/roles.decorator';
import {
  isTokenCliente,
  type RequisicaoAutenticada,
} from '@/modules/auth/jwt-payload';
import { PerfilCliente } from '@/modules/auth/perfil-autorizacao';
import { PerfilUsuario } from '@/modules/auth/perfil-usuario';
import { BuscarOrcamentoUseCase } from '@/modules/orcamentos/application/use-cases/buscar-orcamento.use-case';
import { ListarOrcamentosUseCase } from '@/modules/orcamentos/application/use-cases/listar-orcamentos.use-case';
import { RejeitarOrcamentoUseCase } from '@/modules/orcamentos/application/use-cases/rejeitar-orcamento.use-case';
import { RejeitarOrcamentoDto } from '../dtos/rejeitar-orcamento.dto';

@ApiTags('Orçamentos')
@ApiBearerAuth()
@Controller('orcamentos')
export class OrcamentosController {
  constructor(
    private readonly listarOrcamentos: ListarOrcamentosUseCase,
    private readonly buscarOrcamento: BuscarOrcamentoUseCase,
    private readonly rejeitarOrcamento: RejeitarOrcamentoUseCase,
  ) {}

  @Get()
  @Roles(PerfilUsuario.ADMINISTRADOR, PerfilUsuario.ATENDENTE, PerfilCliente)
  @ApiOperation({ summary: 'Listar orçamentos' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({
    name: 'ordemServicoId',
    required: false,
    description: 'Filtrar por OS',
    format: 'uuid',
  })
  @ApiResponse({ status: 200, description: 'Lista paginada de orçamentos.' })
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('ordemServicoId') ordemServicoId: string | undefined,
    @Req() req: RequisicaoAutenticada,
  ) {
    const clienteId =
      req.user && isTokenCliente(req.user) ? req.user.sub : undefined;

    return await this.listarOrcamentos.execute(page, limit, {
      ordemServicoId,
      clienteId,
    });
  }

  @Get(':id')
  @Roles(PerfilUsuario.ADMINISTRADOR, PerfilUsuario.ATENDENTE, PerfilCliente)
  @RequireOwnership(OwnershipResource.ORCAMENTO)
  @ApiOperation({ summary: 'Consultar um orçamento pelo ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Orçamento encontrado.' })
  @ApiResponse({ status: 404, description: 'Orçamento não encontrado.' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return await this.buscarOrcamento.execute(id);
  }

  @Post(':id/rejeicao')
  @HttpCode(HttpStatus.OK)
  @Roles(PerfilUsuario.ADMINISTRADOR, PerfilUsuario.ATENDENTE, PerfilCliente)
  @RequireOwnership(OwnershipResource.ORCAMENTO)
  @ApiOperation({ summary: 'Rejeitar um orçamento' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Orçamento rejeitado.' })
  @ApiResponse({ status: 404, description: 'Orçamento não encontrado.' })
  @ApiResponse({
    status: 409,
    description: 'Situação do orçamento não permite rejeição.',
  })
  async rejeicao(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejeitarOrcamentoDto,
  ) {
    return await this.rejeitarOrcamento.execute(id, dto);
  }
}
