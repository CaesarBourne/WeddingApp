import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { FoodOrder } from './food-order.entity';

@Entity('food_items')
export class FoodItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true })
  imagePath: string | null;

  @Column({ type: 'varchar', default: 'food' })
  category: 'food' | 'drink';

  @Column({ type: 'int', default: 0 })
  totalPlates: number;

  @Column({ type: 'int', default: 0 })
  availablePlates: number;

  @Column({ default: true })
  isAvailable: boolean;

  @OneToMany('FoodOrder', 'foodItem')
  orders: FoodOrder[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
