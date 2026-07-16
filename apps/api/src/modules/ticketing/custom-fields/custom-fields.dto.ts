import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const FIELD_TYPES = ['text', 'number', 'dropdown', 'checkbox', 'date'] as const;

export class CreateCustomFieldDto {
  // Slug used as the jsonb key -- lowercase letters, numbers, underscores.
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key must be a lowercase slug (letters, numbers, underscores)',
  })
  @MaxLength(64)
  key: string;

  @IsString()
  @MaxLength(128)
  label: string;

  @IsIn(FIELD_TYPES)
  fieldType: (typeof FIELD_TYPES)[number];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  position?: number;
}

export class UpdateCustomFieldDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  position?: number;
}
