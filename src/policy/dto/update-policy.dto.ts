import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TargetRuleDto } from './target-rule.dto';

export class UpdatePolicyDto {
  @ApiProperty({
    description: 'Updated or appended target scope rules for the engagement',
    type: [TargetRuleDto],
    example: [{ target: 'staging.example.com', effect: 'ALLOW' }],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TargetRuleDto)
  targets: TargetRuleDto[];
}
