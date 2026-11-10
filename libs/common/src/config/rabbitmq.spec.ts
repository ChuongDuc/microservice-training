import { Transport } from '@nestjs/microservices';
import {
  deadLetterQueue,
  DEFAULT_NOTIFICATIONS_QUEUE,
  notificationsConsumerOptions,
  notificationsQueue,
  notificationsQueueOptions,
  notificationsRmqOptions,
  rabbitmqUrl,
} from './rabbitmq';

describe('rabbitmqUrl', () => {
  it('mặc định guest/guest@localhost:5672', () => {
    expect(rabbitmqUrl({})).toBe('amqp://guest:guest@localhost:5672');
  });

  it('đọc từ env, encode user/password có ký tự đặc biệt', () => {
    expect(
      rabbitmqUrl({
        RABBITMQ_USER: 'app',
        RABBITMQ_PASSWORD: 'p@ss/w:rd',
        RABBITMQ_HOST: 'rabbitmq',
        RABBITMQ_PORT: '5673',
      }),
    ).toBe('amqp://app:p%40ss%2Fw%3Ard@rabbitmq:5673');
  });

  it('biến rỗng -> dùng mặc định', () => {
    expect(rabbitmqUrl({ RABBITMQ_HOST: '', RABBITMQ_PORT: '' })).toBe(
      'amqp://guest:guest@localhost:5672',
    );
  });
});

describe('notificationsQueue', () => {
  it('mặc định notifications_queue, ghi đè bằng RABBITMQ_QUEUE', () => {
    expect(notificationsQueue({})).toBe(DEFAULT_NOTIFICATIONS_QUEUE);
    expect(notificationsQueue({ RABBITMQ_QUEUE: 'q' })).toBe('q');
  });
});

describe('notificationsRmqOptions / notificationsConsumerOptions', () => {
  const queueOptions = {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: 'notifications_queue.dlq',
  };

  it('deadLetterQueue: <queue>.dlq', () => {
    expect(deadLetterQueue('q')).toBe('q.dlq');
  });

  it('phía phát: queue durable + DLQ, message persistent', () => {
    expect(notificationsRmqOptions({})).toEqual({
      transport: Transport.RMQ,
      options: {
        urls: ['amqp://guest:guest@localhost:5672'],
        queue: 'notifications_queue',
        queueOptions,
        persistent: true,
      },
    });
  });

  it('phía nhận: cùng queueOptions với phía phát, ack thủ công + prefetch, không mang option của phía phát', () => {
    const producer = notificationsRmqOptions({}, 'q');
    const consumer = notificationsConsumerOptions({}, 'q');
    expect(consumer.options?.queueOptions).toEqual(
      producer.options?.queueOptions,
    );
    expect(consumer.options).toEqual({
      urls: ['amqp://guest:guest@localhost:5672'],
      queue: 'q',
      queueOptions: notificationsQueueOptions('q'),
      noAck: false,
      prefetchCount: expect.any(Number),
    });
  });
});
