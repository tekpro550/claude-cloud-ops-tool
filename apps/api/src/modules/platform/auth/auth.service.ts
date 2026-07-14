import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { signJwt } from './jwt';

@Injectable()
export class AuthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  login(tenantId: string, email: string, password: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [user] = await queryRunner.query(
        `SELECT * FROM users WHERE email = $1`,
        [email],
      );
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const token = signJwt({
        sub: user.id,
        tenantId,
        email: user.email,
        role: user.role,
        kind: 'agent',
      });
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    });
  }

  me(tenantId: string, userId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [user] = await queryRunner.query(
        `SELECT id, email, name, role FROM users WHERE id = $1`,
        [userId],
      );
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      return user;
    });
  }
}
