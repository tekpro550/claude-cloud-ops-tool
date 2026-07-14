import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';

/** Shared by every sub-resource nested under /tickets/:id (todos, time logs, ...). */
export async function assertTicketExists(
  queryRunner: QueryRunner,
  ticketId: string,
): Promise<void> {
  const [ticket] = await queryRunner.query(
    `SELECT id FROM tickets WHERE id = $1`,
    [ticketId],
  );
  if (!ticket) {
    throw new NotFoundException(`Ticket ${ticketId} not found`);
  }
}
