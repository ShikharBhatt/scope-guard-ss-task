import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TargetRuleDto } from './target-rule.dto';

export class CreateEngagementDto {
  @ApiProperty({
    description: 'Human-readable name for the security engagement or pentest',
    example: 'Q4 Financial Portal Pentest',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'List of target scope rules (ALLOW / DENY)',
    type: [TargetRuleDto],
    example: [
      { target: 'app.dev.example.com', effect: 'ALLOW' },
      { target: 'https://api.example.com:443/v1', effect: 'ALLOW' },
      { target: 'internal.corp', effect: 'DENY' },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TargetRuleDto)
  targets: TargetRuleDto[];
}
