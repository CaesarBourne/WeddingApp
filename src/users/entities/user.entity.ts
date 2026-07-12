import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null for guest users who authenticate via QR token instead. */
  @Column({ type: 'varchar', unique: true, nullable: true })
  email: string | null;

  /** bcrypt hash — never returned by the API. Null for guest users. */
  @Column({ type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'varchar', nullable: true })
  name?: string;

  @Column({ type: 'varchar', default: Role.ADMIN })
  role: Role;

  @Column({ default: true })
  isActive: boolean;

  /** Unique random token embedded in the guest's QR code URL. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  guestToken: string | null;

  /** JWT ID of the guest's currently active session (one-device enforcement). */
  @Column({ type: 'varchar', nullable: true })
  currentJti: string | null;

  /** Admin-controlled flag that enables the second action button on the guest welcome page. */
  @Column({ default: false })
  buttonEnabled: boolean;

  /** Path on disk to the user's profile avatar image (relative to process.cwd()). */
  @Column({ type: 'varchar', nullable: true })
  avatarPath: string | null;

  /** Seat number at the event venue — set by admin, used for food ordering. */
  @Column({ type: 'varchar', nullable: true })
  seatNumber: string | null;

  /** Tracks whether the guest has been admitted at the event entrance. */
  @Column({ type: 'varchar', default: 'pending' })
  admissionStatus: 'pending' | 'admitted';

  /** Timestamp of when the guest was first admitted at the entrance. */
  @Column({ nullable: true, type: 'datetime' })
  admittedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
