import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Stores who uploaded each Google Photos media item. One row per photo. */
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

  @CreateDateColumn()
  uploadedAt: Date;
}
