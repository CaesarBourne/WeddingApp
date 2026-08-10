import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodItem } from './entities/food-item.entity';
import { FoodOrder } from './entities/food-order.entity';
import { FoodSettings } from './entities/food-settings.entity';
import { FoodController } from './food.controller';
import { FoodService } from './food.service';

@Module({
  imports: [TypeOrmModule.forFeature([FoodItem, FoodOrder, FoodSettings])],
  controllers: [FoodController],
  providers: [FoodService],
  exports: [FoodService],
})
export class FoodModule {}
