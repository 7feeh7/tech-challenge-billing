import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class DadosNotificacaoDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class NotificacaoMercadoPagoDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsNumber()
  id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DadosNotificacaoDto)
  @IsObject()
  data?: DadosNotificacaoDto;
}
