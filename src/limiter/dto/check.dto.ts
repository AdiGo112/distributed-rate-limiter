import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PLAN_NAMES, type PlanName } from '../../config/plans.js';

export class CheckDto {
  @IsString() @Length(1, 128) key!: string;
  @IsOptional() @IsIn(PLAN_NAMES) plan?: PlanName;
  @IsOptional() @IsInt() @Min(1) @Max(1000) cost?: number;
}
