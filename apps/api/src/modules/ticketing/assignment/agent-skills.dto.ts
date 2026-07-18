import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class AddAgentSkillDto {
  @IsUUID()
  agentId: string;

  @IsString()
  @IsNotEmpty()
  skill: string;
}
