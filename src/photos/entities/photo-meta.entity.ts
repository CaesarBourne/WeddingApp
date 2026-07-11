import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type PhotoStatus = 'pending' | 'approved' | 'rejected';
export type PhotoSource = 'guest' | 'couple';

/** Stores who uploaded each Google Photos media item + its moderation state. One row per photo. */
@Entity('photo_meta')
export class PhotoMeta {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  googlePhotoId: string;

  @Column({ type: 'varchar', nullable: true })
  uploaderId: string | null;

  @Column({ type: 'varchar', nullable: true })
  uploaderName: string | null;

  // Media metadata captured at upload time so the public gallery can be served
  // as a pure DB read (no Google batchGet per list). Images themselves load via
  // /photos/:id/raw, which resolves fresh URLs on demand. Null for legacy rows.
  @Column({ type: 'varchar', nullable: true })
  filename: string | null;

  @Column({ type: 'varchar', nullable: true })
  mimeType: string | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'varchar', nullable: true })
  creationTime: string | null;

  /**
   * Moderation state. Album membership is the source of truth for public
   * visibility (only 'approved' items are added to the wedding album); this
   * column drives the admin moderation queue and the approve/reject transitions.
   *
   * Defaults to 'approved' so a schema sync over existing rows (which are all
   * already in the album) marks them approved with no manual backfill. Guest
   * uploads explicitly set 'pending' at insert time.
   */
  @Index('idx_photo_meta_status')
  @Column({ type: 'varchar', default: 'approved' })
  status: PhotoStatus;

  /** 'couple' for admin/couple uploads (crown badge, sorts first); 'guest' otherwise. */
  @Column({ type: 'varchar', default: 'guest' })
  source: PhotoSource;

  /** Display-only: hide the uploader's name publicly. Attribution is still stored. */
  @Column({ default: false })
  isAnonymous: boolean;

  @CreateDateColumn()
  uploadedAt: Date;
}
