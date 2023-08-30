import { RequestTypeDto } from "../../../../libs/common/src";

export interface IBatchAnnouncerJobData {
  batchId: string;
  schemaId: number;
  announcements: RequestTypeDto[];
}
