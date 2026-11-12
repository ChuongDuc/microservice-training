import {
  deadLetterQueue,
  notificationsQueue,
  rabbitmqEnv,
  rabbitmqUrl,
} from '@app/common';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

/**
 * Khai báo dead-letter queue trước khi bắt đầu nhận event. Queue chính chỉ trỏ tới DLQ
 * qua routing key; nếu DLQ chưa tồn tại thì RabbitMQ lặng lẽ xoá message bị nack thay
 * vì giữ lại. Nest chỉ khai báo queue chính, nên DLQ khai báo riêng ở đây.
 *
 * onModuleInit chạy trong app.listen() trước khi server RMQ kết nối và nhận message.
 */
@Injectable()
export class DeadLetterQueueSetup implements OnModuleInit {
  private readonly logger = new Logger(DeadLetterQueueSetup.name);

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const env = rabbitmqEnv(this.config);
    const dlq = deadLetterQueue(notificationsQueue(env));

    const connection = await amqp.connect(rabbitmqUrl(env));
    try {
      const channel = await connection.createChannel();
      await channel.assertQueue(dlq, { durable: true });
      this.logger.log(`Dead-letter queue sẵn sàng: ${dlq}`);
    } finally {
      await connection.close();
    }
  }
}
