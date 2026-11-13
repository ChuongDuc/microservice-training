import { WithAuthUser } from '../identity/authenticated-payload.dto';
import { PaginationDto } from '../pagination.dto';

/** Phân trang cho `notification.find_all` (`?page=&limit=`). */
export class ListNotificationsDto extends PaginationDto {}

/** Payload `notification.find_all`: `{ user, data }` (danh tính người gọi từ Gateway). */
export class ListNotificationsPayloadDto extends WithAuthUser(
  ListNotificationsDto,
) {}
