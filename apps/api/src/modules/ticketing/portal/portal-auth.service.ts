import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { signJwt } from '../../platform/auth/jwt';
import { isEmailValid } from '../contact-email-validation';
import { PortalLoginDto, PortalRegisterDto } from './portal-auth.dto';

function toAuthResult(
  contact: { id: string; name: string; email: string },
  tenantId: string,
) {
  return {
    token: signJwt({
      sub: contact.id,
      tenantId,
      email: contact.email,
      kind: 'contact',
    }),
    contact: { id: contact.id, name: contact.name, email: contact.email },
  };
}

@Injectable()
export class PortalAuthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  register(tenantId: string, dto: PortalRegisterDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id, name, email, password_hash FROM contacts WHERE email = $1`,
        [dto.email],
      );

      const passwordHash = await bcrypt.hash(dto.password, 10);

      // A guest may already have a contact record from a prior ticket
      // submission (matched by email, same as email intake). Registering
      // "claims" that existing contact rather than creating a duplicate --
      // this is the reason the portal's registration flow exists at all,
      // per the Module 1 doc.
      if (existing) {
        if (existing.password_hash) {
          throw new ConflictException(
            'An account with this email already exists. Log in instead.',
          );
        }
        // UPDATE ... RETURNING returns a [rows, rowCount] tuple via
        // TypeORM's postgres driver, unlike INSERT/SELECT which return the
        // rows array directly -- unwrap accordingly.
        const [updatedRows] = await queryRunner.query(
          `UPDATE contacts SET password_hash = $1, name = $2 WHERE id = $3 RETURNING id, name, email`,
          [passwordHash, dto.name, existing.id],
        );
        return toAuthResult(updatedRows[0], tenantId);
      }

      const [created] = await queryRunner.query(
        `INSERT INTO contacts (tenant_id, name, email, password_hash, email_valid)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email`,
        [tenantId, dto.name, dto.email, passwordHash, isEmailValid(dto.email)],
      );
      return toAuthResult(created, tenantId);
    });
  }

  login(tenantId: string, dto: PortalLoginDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [contact] = await queryRunner.query(
        `SELECT id, name, email, password_hash FROM contacts WHERE email = $1`,
        [dto.email],
      );
      if (
        !contact?.password_hash ||
        !(await bcrypt.compare(dto.password, contact.password_hash))
      ) {
        throw new UnauthorizedException('Invalid email or password');
      }
      return toAuthResult(contact, tenantId);
    });
  }

  me(tenantId: string, contactId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [contact] = await queryRunner.query(
        `SELECT id, name, email FROM contacts WHERE id = $1`,
        [contactId],
      );
      if (!contact) {
        throw new UnauthorizedException('Contact not found');
      }
      return contact;
    });
  }
}
