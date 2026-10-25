import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TargetRuleDto {
  @ApiProperty({
    description: 'Target hostname or destination URL (e.g., app.dev.example.com, https://api.corp.internal:443)',
    example: 'app.dev.example.com',
  })
  @IsString()
  @IsNotEmpty()
  target: string;

  @ApiProperty({
    description: 'Rule effect (ALLOW or DENY). Note: DENY takes absolute precedence over ALLOW.',
    enum: ['ALLOW', 'DENY'],
    example: 'ALLOW',
  })
  @IsString()
  @IsIn(['ALLOW', 'DENY'], { message: 'Effect must be either ALLOW or DENY' })
  effect: 'ALLOW' | 'DENY';
}
