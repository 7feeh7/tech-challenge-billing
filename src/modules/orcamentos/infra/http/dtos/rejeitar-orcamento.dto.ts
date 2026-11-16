import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejeitarOrcamentoDto {
  @ApiProperty({
    example: 'Cliente não aprovou o valor',
    description: 'Motivo da rejeição do orçamento',
  })
  @IsString({ message: 'O motivo deve ser texto.' })
  @IsNotEmpty({ message: 'O motivo da rejeição é obrigatório.' })
  @MaxLength(500, { message: 'O motivo deve ter no máximo 500 caracteres.' })
  motivo!: string;
}
