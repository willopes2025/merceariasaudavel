import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PermissionResolver } from '../../common/auth/permission-resolver';
import { expiresIn, jwtSecret } from '../../common/auth/token-payload';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: jwtSecret(),
      // Um turno de trabalho, como no Soul ERP.
      signOptions: { expiresIn: expiresIn(process.env.JWT_ACCESS_TTL, '12h') },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, AccessService, UsersService, { provide: PermissionResolver, useExisting: AccessService }],
  exports: [AccessService, PermissionResolver],
})
export class IamModule {}
