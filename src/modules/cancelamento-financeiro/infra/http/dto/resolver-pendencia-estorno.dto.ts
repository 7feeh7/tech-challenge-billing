import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import type { DecisaoPendenciaRegistro } from '../../../application/ports/pendencia-estorno.gateway';

export class ResolverPendenciaEstornoDto {
  @ApiProperty({
    enum: ['ESTORNO_INTEGRAL', 'ESTORNO_PARCIAL', 'SEM_ESTORNO'],
  })
  @IsEnum(['ESTORNO_INTEGRAL', 'ESTORNO_PARCIAL', 'SEM_ESTORNO'])
  decisao!: DecisaoPendenciaRegistro;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  valorEstornadoCentavos?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  justificativa?: string;
}

export class PendenciaEstornoParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}
