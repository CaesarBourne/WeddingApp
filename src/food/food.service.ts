import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { Repository } from 'typeorm';
import { FoodItem } from './entities/food-item.entity';
import { FoodOrder } from './entities/food-order.entity';

export interface OrderNotification {
  orderId: string;
  guestName: string;
  seatNumber: string | null;
  foodItemName: string;
  category: 'food' | 'drink';
  orderedAt: string;
}

@Injectable()
export class FoodService {
  private readonly orderSubject = new Subject<OrderNotification>();

  constructor(
    @InjectRepository(FoodItem) private readonly itemRepo: Repository<FoodItem>,
    @InjectRepository(FoodOrder) private readonly orderRepo: Repository<FoodOrder>,
  ) {}

  getOrderStream(): Observable<OrderNotification> {
    return this.orderSubject.asObservable();
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  async findAllItems(): Promise<FoodItem[]> {
    return this.itemRepo.find({ order: { category: 'ASC', name: 'ASC' } });
  }

  async findItemById(id: string): Promise<FoodItem> {
    const item = await this.itemRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Food item not found.');
    return item;
  }

  async createItem(data: {
    name: string;
    description?: string;
    category: 'food' | 'drink';
    totalPlates: number;
  }): Promise<FoodItem> {
    const item = this.itemRepo.create({ ...data, availablePlates: data.totalPlates });
    return this.itemRepo.save(item);
  }

  async updateItem(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      totalPlates: number;
      availablePlates: number;
      isAvailable: boolean;
    }>,
  ): Promise<FoodItem> {
    const item = await this.findItemById(id);
    Object.assign(item, data);
    return this.itemRepo.save(item);
  }

  async setImage(id: string, imagePath: string): Promise<void> {
    await this.itemRepo.update(id, { imagePath });
  }

  async deleteItem(id: string): Promise<void> {
    const item = await this.findItemById(id);
    await this.itemRepo.remove(item);
  }

  // ── Orders ─────────────────────────────────────────────────────────────────

  async placeOrder(
    userId: string,
    seatNumber: string | null,
    foodItemId: string,
    guestName: string,
  ): Promise<FoodOrder> {
    const item = await this.findItemById(foodItemId);
    if (!item.isAvailable) throw new BadRequestException('This item is no longer available.');
    if (item.availablePlates <= 0) throw new BadRequestException('No more plates available for this item.');

    // One order per category per user
    const existing = await this.orderRepo
      .createQueryBuilder('o')
      .innerJoin('o.foodItem', 'fi')
      .where('o.userId = :userId', { userId })
      .andWhere('fi.category = :category', { category: item.category })
      .getOne();
    if (existing) {
      throw new BadRequestException(
        `You have already chosen a ${item.category} option. Contact the event team if you need to change it.`,
      );
    }

    item.availablePlates -= 1;
    await this.itemRepo.save(item);

    const order = this.orderRepo.create({ userId, seatNumber, foodItemId });
    const saved = await this.orderRepo.save(order);

    this.orderSubject.next({
      orderId: saved.id,
      guestName,
      seatNumber,
      foodItemName: item.name,
      category: item.category,
      orderedAt: saved.createdAt.toISOString(),
    });

    return saved;
  }

  async findOrdersByUser(userId: string): Promise<FoodOrder[]> {
    return this.orderRepo.find({
      where: { userId },
      relations: ['foodItem'],
      order: { createdAt: 'DESC' },
    });
  }

  async findAllOrders(): Promise<FoodOrder[]> {
    return this.orderRepo.find({
      relations: ['user', 'foodItem'],
      order: { createdAt: 'DESC' },
    });
  }
}
