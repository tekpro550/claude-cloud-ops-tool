import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { assertTicketExists } from './assert-ticket-exists';
import { CreateTicketTodoDto, UpdateTicketTodoDto } from './ticket-todos.dto';

@Injectable()
export class TicketTodosService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(tenantId: string, ticketId: string, dto: CreateTicketTodoDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await assertTicketExists(queryRunner, ticketId);
      const [todo] = await queryRunner.query(
        `INSERT INTO ticket_todos (tenant_id, ticket_id, body) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, ticketId, dto.body],
      );
      return todo;
    });
  }

  list(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await assertTicketExists(queryRunner, ticketId);
      return queryRunner.query(
        `SELECT * FROM ticket_todos WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      );
    });
  }

  async update(
    tenantId: string,
    ticketId: string,
    todoId: string,
    dto: UpdateTicketTodoDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM ticket_todos WHERE id = $1 AND ticket_id = $2`,
        [todoId, ticketId],
      );
      if (!existing) {
        throw new NotFoundException(
          `To-do ${todoId} not found on ticket ${ticketId}`,
        );
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.body !== undefined) assign('body', dto.body);
      if (dto.isDone !== undefined) {
        assign('is_done', dto.isDone);
        assign('done_at', dto.isDone ? new Date() : null);
      }

      if (sets.length === 0) {
        const [todo] = await queryRunner.query(
          `SELECT * FROM ticket_todos WHERE id = $1`,
          [todoId],
        );
        return todo;
      }

      params.push(todoId);
      const [rows] = await queryRunner.query(
        `UPDATE ticket_todos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(
    tenantId: string,
    ticketId: string,
    todoId: string,
  ): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM ticket_todos WHERE id = $1 AND ticket_id = $2 RETURNING id`,
        [todoId, ticketId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(
          `To-do ${todoId} not found on ticket ${ticketId}`,
        );
      }
    });
  }
}
