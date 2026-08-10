import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Single-row table: global switch for whether guests can place food/drink orders. */
@Entity('food_settings')
export class FoodSettings {
  @PrimaryColumn({ type: 'varchar', default: 'singleton' })
  id: string;

  @Column({ type: 'boolean', default: false })
  orderingEnabled: boolean;
}
