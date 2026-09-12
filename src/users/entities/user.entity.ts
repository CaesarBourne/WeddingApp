import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { SeatGroup } from './seat-group.entity';

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

  /** Admin-controlled block. Everyone can view the gallery by default (false);
   *  set true to hide "View Gallery"/"My Photos" for this specific guest. */
  @Column({ default: false })
  photosBlocked: boolean;

  /** Legacy: path on disk to the avatar image. Local disk isn't durable across
   *  deploys — new avatars use avatarPhotoId instead. Kept for old rows. */
  @Column({ type: 'varchar', nullable: true })
  avatarPath: string | null;

  /** Google Photos media item ID for the user's avatar. Uploaded to the couple's
   *  album (durable storage) but never given a PhotoMeta row, so it never
   *  appears in the public gallery. */
  @Column({ type: 'varchar', nullable: true })
  avatarPhotoId: string | null;

  /** Seat number at the event venue — set by admin, used for food ordering.
   *  Unique so the same seat can't be double-booked across guests. */
  @Column({ type: 'varchar', nullable: true, unique: true })
  seatNumber: string | null;

  /** Named seat group (e.g. "Groomsmen") this guest belongs to — max 8 guests per group. */
  @Column({ type: 'uuid', nullable: true })
  seatGroupId: string | null;

  @ManyToOne(() => SeatGroup, (seatGroup) => seatGroup.guests, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'seatGroupId' })
  seatGroup: SeatGroup | null;

  /** Sequential guest number, assigned once at creation. Guest-role users only. */
  @Column({ type: 'int', nullable: true, unique: true })
  guestNumber: number | null;

  /** Tracks whether the guest has been admitted at the event entrance. */
  @Column({ type: 'varchar', default: 'pending' })
  admissionStatus: 'pending' | 'admitted';

  /** Timestamp of when the guest was first admitted at the entrance. */
  @Column({ nullable: true, type: 'timestamp' })
  admittedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
