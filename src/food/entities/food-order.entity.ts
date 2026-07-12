import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { FoodItem } from './food-item.entity';

@Entity('food_orders')
export class FoodOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  userId: string;

  @ManyToOne(() => User, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', nullable: true })
  seatNumber: string | null;

  @Column({ type: 'varchar' })
  foodItemId: string;

  @ManyToOne(() => FoodItem, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'foodItemId' })
  foodItem: FoodItem;

  @CreateDateColumn()
  createdAt: Date;
}
