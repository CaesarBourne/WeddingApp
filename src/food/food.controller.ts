import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Res,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Observable, map } from 'rxjs';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { FoodService } from './food.service';

export class CreateFoodItemDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsOptional() description?: string;
  @IsEnum(['food', 'drink']) category: 'food' | 'drink';
  @IsInt() @Min(1) @Max(10000) totalPlates: number;
}

export class UpdateFoodItemDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() description?: string | null;
  @IsInt() @Min(0) @Max(10000) @IsOptional() totalPlates?: number;
  @IsInt() @Min(0) @Max(10000) @IsOptional() availablePlates?: number;
  @IsOptional() isAvailable?: boolean;
}

export class PlaceOrderDto {
  @IsUUID() foodItemId: string;
}

const FOOD_IMAGES_DIR = path.resolve(process.cwd(), 'data', 'food-images');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EXT_MAP: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

@ApiTags('food')
@ApiBearerAuth()
@Controller('food')
export class FoodController {
  constructor(private readonly food: FoodService) {}

  // ── Public item list + images ──────────────────────────────────────────────

  @Public()
  @Get('items')
  @ApiOperation({ summary: 'Get all food/drink items (public).' })
  async findAllItems() {
    const items = await this.food.findAllItems();
    return items.map((i) => this.toItemDto(i));
  }

  @Public()
  @Get('items/:id/image')
  @ApiOperation({ summary: 'Serve a food item image (public).' })
  async getImage(@Param('id') id: string, @Res() res: Response) {
    const item = await this.food.findItemById(id);
    if (!item.imagePath || !fs.existsSync(item.imagePath)) {
      return res.status(404).json({ message: 'No image for this item.' });
    }
    const ext = path.extname(item.imagePath).toLowerCase();
    const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    res.set('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(fs.readFileSync(item.imagePath));
  }

  // ── Admin item management ──────────────────────────────────────────────────

  @Post('items')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a food or drink item (admin+).' })
  async createItem(@Body() dto: CreateFoodItemDto) {
    const item = await this.food.createItem(dto);
    return this.toItemDto(item);
  }

  @Patch('items/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a food or drink item (admin+).' })
  async updateItem(@Param('id') id: string, @Body() dto: UpdateFoodItemDto) {
    const item = await this.food.updateItem(id, dto);
    return this.toItemDto(item);
  }

  @Post('items/:id/image')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload an image for a food item (admin+).' })
  async uploadImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new ForbiddenException('No file uploaded.');
    if (!ALLOWED_MIME.has(file.mimetype)) throw new ForbiddenException('Only JPEG, PNG, WebP images are allowed.');
    fs.mkdirSync(FOOD_IMAGES_DIR, { recursive: true });
    const ext = EXT_MAP[file.mimetype] ?? '.jpg';
    const filePath = path.join(FOOD_IMAGES_DIR, `${id}${ext}`);
    fs.writeFileSync(filePath, file.buffer);
    await this.food.setImage(id, filePath);
    return { imageUrl: `/food/items/${id}/image` };
  }

  @Delete('items/:id')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a food or drink item (admin+).' })
  async deleteItem(@Param('id') id: string) {
    await this.food.deleteItem(id);
    return { deleted: true };
  }

  // ── Guest ordering ─────────────────────────────────────────────────────────

  @Post('orders')
  @ApiOperation({ summary: 'Place a food/drink order (any authenticated user).' })
  async placeOrder(@CurrentUser() user: AuthUser, @Body() dto: PlaceOrderDto) {
    const order = await this.food.placeOrder(
      user.sub,
      user.seatNumber ?? null,
      dto.foodItemId,
      user.name ?? 'Guest',
    );
    return { id: order.id, foodItemId: order.foodItemId, createdAt: order.createdAt };
  }

  @Get('orders/mine')
  @ApiOperation({ summary: 'Get the current user\'s orders.' })
  async myOrders(@CurrentUser() user: AuthUser) {
    const orders = await this.food.findOrdersByUser(user.sub);
    return orders.map((o) => this.toOrderDto(o));
  }

  // ── Admin order view + SSE ─────────────────────────────────────────────────

  @Get('orders')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all orders (admin+).' })
  async allOrders() {
    const orders = await this.food.findAllOrders();
    return orders.map((o) => this.toOrderDto(o));
  }

  @Sse('events')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'SSE stream of new order notifications (admin+).' })
  events(): Observable<MessageEvent> {
    return this.food.getOrderStream().pipe(
      map((notification) => ({ data: notification }) as MessageEvent),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toItemDto(i: import('./entities/food-item.entity').FoodItem) {
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      category: i.category,
      totalPlates: i.totalPlates,
      availablePlates: i.availablePlates,
      isAvailable: i.isAvailable,
      imageUrl: i.imagePath ? `/food/items/${i.id}/image` : null,
      createdAt: i.createdAt,
    };
  }

  private toOrderDto(o: import('./entities/food-order.entity').FoodOrder) {
    return {
      id: o.id,
      userId: o.userId,
      guestName: o.user?.name ?? null,
      seatNumber: o.seatNumber,
      foodItemId: o.foodItemId,
      foodItemName: o.foodItem?.name ?? null,
      category: o.foodItem?.category ?? null,
      createdAt: o.createdAt,
    };
  }
}
