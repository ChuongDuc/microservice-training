import { Injectable } from '@nestjs/common';

@Injectable()
export class TaskServiceService {
  getHello(): string {
    return 'Hello World!';
  }
}
