import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';
/** Restricts a route to the given admin roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
